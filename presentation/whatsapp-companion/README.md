# Agent Remote WhatsApp presentation companion

This opt-in browser extension only changes the local Web/Desktop presentation at `https://web.whatsapp.com`. It does not change WhatsApp transport identity, send messages, read files, invoke providers, or affect mobile clients.

1. Enable the gateway with `AGENT_REMOTE_PRESENTATION_ENABLED=true`, set a private `AGENT_REMOTE_PRESENTATION_TOKEN`, and optionally set `AGENT_REMOTE_PRESENTATION_PORT` (default `8765`).
2. Put the same port and token in `src/content.ts`, then run `npm run build`.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/presentation/whatsapp-companion`.

The companion requests only the loopback registry endpoint from WhatsApp Web and augments exact message IDs already registered by the gateway. It is best-effort: bridge or DOM errors disable that cycle and never interfere with WhatsApp. WhatsApp may show Code Verify or extension warnings because this modifies the Web/Desktop DOM; review those warnings before enabling it. Mobile WhatsApp remains unchanged.
