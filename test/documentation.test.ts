import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicDocs = ["README.md", ".env.example", "docs/architecture.md", "docs/whatsapp.md"];
const requiredPhrases = ["one WhatsApp account", "fromMe", "MessageOrigin", "reply", "presentation companion", "mobile"];

test("public operator documentation describes the single-number presentation runtime", async () => {
  const content = await Promise.all(publicDocs.map(path => readFile(path, "utf8")));
  const documentation = content.join("\n");

  for (const phrase of requiredPhrases) assert.match(documentation, new RegExp(phrase));
});
