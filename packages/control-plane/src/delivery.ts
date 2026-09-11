import type { MessageReference, OutboundMessage } from "../../core/src/index.js";

export interface StreamingDeliveryPolicy {
  minChars: number;
  maxIntervalMs: number;
  maxMessagesPerExecution: number;
}

export class StreamDelivery {
  private buffer = "";
  private sentText = "";
  private sentCount = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private completed = false;

  constructor(
    private readonly policy: StreamingDeliveryPolicy,
    private readonly send: (message: OutboundMessage) => Promise<void> | void,
    private readonly replyTo?: MessageReference
  ) {}

  async push(delta: string): Promise<void> {
    if (this.completed || !delta) return;
    this.buffer += delta;
    if (this.buffer.length >= this.policy.minChars) await this.flush();
    else this.schedule();
  }

  async complete(finalText: string): Promise<void> {
    if (this.completed) return;
    this.completed = true;
    if (this.timer) clearTimeout(this.timer);
    const final = finalText || this.buffer;
    const remainder = this.sentCount === 0
      ? final
      : final.startsWith(this.sentText) ? final.slice(this.sentText.length) : this.buffer;
    if (remainder) await this.sendText(remainder);
    this.buffer = "";
  }

  async fail(): Promise<void> {
    this.completed = true;
    if (this.timer) clearTimeout(this.timer);
    this.buffer = "";
  }

  private schedule(): void {
    if (this.timer || this.policy.maxIntervalMs <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.policy.maxIntervalMs);
  }

  private async flush(): Promise<void> {
    if (!this.buffer || this.completed && this.sentCount > 0 || this.sentCount >= Math.max(1, this.policy.maxMessagesPerExecution - 1)) return;
    const text = this.buffer;
    this.buffer = "";
    await this.sendText(text);
  }

  private async sendText(text: string): Promise<void> {
    if (!text || this.sentCount >= this.policy.maxMessagesPerExecution) return;
    await this.send({ text, ...(this.replyTo ? { replyTo: this.replyTo } : {}) });
    this.sentCount += 1;
    this.sentText += text;
  }
}
