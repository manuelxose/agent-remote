import type { WhatsAppMessageLocator } from "./protocol.js";

export class DomWhatsAppMessageLocator implements WhatsAppMessageLocator {
  constructor(private readonly root: Document | HTMLElement) {}

  findByMessageId(id: string): HTMLElement | undefined {
    const normalized = id.trim();
    if (!normalized) return undefined;
    const escaped = globalThis.CSS?.escape?.(normalized);
    if (escaped) {
      const exact = this.unique(this.root.querySelectorAll<HTMLElement>(`[data-id="${escaped}"]`));
      if (exact) return exact;
    }
    const dataId = this.matching("[data-id]", element => element.getAttribute("data-id")?.trim() === normalized);
    if (dataId) return dataId;
    return this.matching("[aria-label], [data-testid]", element =>
      [element.getAttribute("aria-label"), element.getAttribute("data-testid")].some(value => containsExactId(value, normalized))
    );
  }

  private matching(selector: string, matches: (element: HTMLElement) => boolean): HTMLElement | undefined {
    return this.unique([...this.root.querySelectorAll<HTMLElement>(selector)].filter(matches));
  }

  private unique(elements: Iterable<HTMLElement>): HTMLElement | undefined {
    const matches = [...elements];
    return matches.length === 1 ? matches[0] : undefined;
  }
}

export function conversationIdForElement(element: HTMLElement): string | undefined {
  const explicit = element.dataset.conversationId?.trim();
  if (explicit) return explicit;
  const dataId = element.getAttribute("data-id");
  if (!dataId) return undefined;
  try {
    const values: unknown = JSON.parse(dataId);
    if (!Array.isArray(values)) return undefined;
    const conversations = values.filter((value): value is string => typeof value === "string" && /@(s\.whatsapp\.net|g\.us)$/.test(value));
    return conversations.length === 1 ? conversations[0] : undefined;
  } catch { return undefined; }
}

function containsExactId(value: string | null, id: string): boolean {
  if (!value) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(value);
}
