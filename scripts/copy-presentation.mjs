import { cp, mkdir } from "node:fs/promises";

const output = "dist/presentation/whatsapp-companion";
await mkdir(`${output}/src`, { recursive: true });
await cp("presentation/whatsapp-companion/manifest.json", `${output}/manifest.json`);
await cp("presentation/whatsapp-companion/src/companion.css", `${output}/src/companion.css`);
