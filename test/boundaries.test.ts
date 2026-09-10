import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ConfigurationRouter } from "../dist/packages/routing/src/index.js";

test("checked-in route configuration resolves the Codex conversation", () => {
  const routes = JSON.parse(readFileSync("config/routes.json", "utf8"));
  const route = new ConfigurationRouter(routes).resolve("whatsapp", "group-codex");
  assert.deepEqual(route, {
    id: "whatsapp-group-codex",
    runtime: "developer-agent",
    agent: "codex"
  });
});

test("core source has no channel or product imports", () => {
  const source = readFileSync("packages/core/src/index.ts", "utf8");
  assert.doesNotMatch(source, /whatsapp|claude|codex|copilot|talkaris/i);
});

test("WhatsApp source has no agent or chatbot product knowledge", () => {
  const source = readdirSync("channels/whatsapp/src")
    .filter(file => file.endsWith(".ts"))
    .map(file => readFileSync(`channels/whatsapp/src/${file}`, "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /claude|codex|copilot|talkaris/i);
});

test("chatbot runtime has no developer adapter or shell imports", () => {
  const source = readFileSync("runtime/chatbot/src/index.ts", "utf8");
  assert.doesNotMatch(source, /developer-agents|child_process|node:fs/);
});
