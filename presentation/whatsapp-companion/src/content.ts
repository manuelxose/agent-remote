import { syncAgentPresentation } from "./augment.js";
import { DomWhatsAppMessageLocator } from "./locator.js";
import type { PresentationRegistryEntry } from "./protocol.js";

// Set token before building, or edit this generated file before loading it unpacked.
const bridge = { port: 8765, token: "" };
const locator = new DomWhatsAppMessageLocator(document);
let entries: PresentationRegistryEntry[] = [];

async function refresh(): Promise<void> {
  if (!bridge.token) { entries = []; return; }
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/registry`, {
      headers: { "x-agent-remote-token": bridge.token }
    });
    if (!response.ok) throw new Error(`Presentation bridge returned ${response.status}`);
    const snapshot: unknown = await response.json();
    entries = Array.isArray(snapshot) ? snapshot as PresentationRegistryEntry[] : [];
    syncAgentPresentation(document.documentElement, entries, locator);
  } catch { entries = []; }
}

new MutationObserver(() => { syncAgentPresentation(document.documentElement, entries, locator); })
  .observe(document.documentElement, { childList: true, subtree: true });
void refresh();
setInterval(() => { void refresh(); }, 2_000);
