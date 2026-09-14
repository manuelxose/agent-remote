import { createHash } from "node:crypto";
import type { Message } from "../../core/src/index.js";
import { normalizeHistorySearch, type HistoryChat } from "./history.js";

export interface WhatsAppExportImport {
  chat: HistoryChat;
  messages: Message[];
}

const maxImportBytes = 10 * 1024 * 1024;
const maxImportLines = 100_000;

export function parseWhatsAppExport(displayName: string, data: Buffer): WhatsAppExportImport {
  const name = displayName.trim().slice(0, 200);
  if (!name) throw new RangeError("An imported chat needs a name");
  if (data.byteLength > maxImportBytes) throw new RangeError("WhatsApp export is too large (maximum 10 MB)");

  const lines = data.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > maxImportLines) throw new RangeError("WhatsApp export has too many lines");
  const conversationId = `imported:${createHash("sha256").update(normalizeHistorySearch(name)).digest("hex").slice(0, 24)}`;
  const parsed: Array<{ timestamp: Date; senderId: string; text: string }> = [];
  let current: { timestamp: Date; senderId: string; text: string } | undefined;

  const flush = () => { if (current) parsed.push(current); current = undefined; };
  for (const line of lines) {
    const header = parseHeader(line);
    if (!header) {
      if (current && line.trim()) current.text += `\n${line}`;
      continue;
    }
    const sender = header.body.match(/^(.{1,200}?):\s([\s\S]*)$/);
    if (!sender || !sender[1].trim()) { flush(); continue; }
    flush();
    current = { timestamp: header.timestamp, senderId: sender[1].trim(), text: sender[2] };
  }
  flush();
  if (!parsed.length) throw new Error("WhatsApp export contains no parseable messages");

  const occurrences = new Map<string, number>();
  const messages = parsed.map(message => {
    const fingerprint = `${message.timestamp.toISOString()}\u0000${message.senderId}\u0000${message.text}`;
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    const id = `imported:${createHash("sha256").update(`${conversationId}\u0000${fingerprint}\u0000${occurrence}`).digest("hex").slice(0, 32)}`;
    return {
      id,
      channel: "whatsapp",
      conversationId,
      senderId: message.senderId,
      text: message.text,
      receivedAt: message.timestamp
    };
  });
  const updatedAt = messages.reduce((latest, message) => Math.max(latest, message.receivedAt.getTime()), 0);
  return {
    chat: { channel: "whatsapp", conversationId, displayName: name, kind: "unknown", updatedAt: new Date(updatedAt).toISOString() },
    messages
  };
}

function parseHeader(line: string): { timestamp: Date; body: string } | undefined {
  const bracketed = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  const plain = line.match(/^(.+?)\s+-\s+([\s\S]*)$/);
  const timestampText = bracketed?.[1] ?? plain?.[1];
  const body = bracketed?.[2] ?? plain?.[2];
  if (!timestampText || body === undefined) return undefined;
  const timestamp = parseTimestamp(timestampText);
  return timestamp ? { timestamp, body } : undefined;
}

function parseTimestamp(value: string): Date | undefined {
  const match = value.trim().match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return undefined;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3]);
  const year = match[1].length === 4 ? first : third < 100 ? 2000 + third : third;
  const month = match[1].length === 4 ? second : second;
  const day = match[1].length === 4 ? third : first;
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const secondOfMinute = Number(match[6] ?? 0);
  const meridiem = match[7]?.toUpperCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    hour = hour % 12 + (meridiem === "PM" ? 12 : 0);
  }
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, secondOfMinute));
  return timestamp.getUTCFullYear() === year && timestamp.getUTCMonth() === month - 1 && timestamp.getUTCDate() === day
    ? timestamp : undefined;
}
