import type { MessageOrigin, MessageReference, OutboundMessage } from "../../core/src/index.js";

export interface StreamingDeliveryPolicy {
  progressAfterMs: number;
  progressText: string;
  maxMessagesPerExecution: number;
}

export class StreamDelivery {
  private buffer = "";
  private sentCount = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private completed = false;
  private progressSent = false;

  constructor(
    private readonly policy: StreamingDeliveryPolicy,
    private readonly send: (message: OutboundMessage) => Promise<void> | void,
    private readonly replyTo?: MessageReference
  ) {
    if (!Number.isInteger(policy.maxMessagesPerExecution) || policy.maxMessagesPerExecution < 1) {
      throw new Error("maxMessagesPerExecution must be at least 1");
    }
  }

  async push(delta: string): Promise<void> {
    if (this.completed || !delta) return;
    this.buffer += delta;
    this.scheduleProgress();
  }

  async complete(finalText: string, origin?: MessageOrigin): Promise<void> {
    if (this.completed) return;
    this.completed = true;
    this.clearTimer();
    if (finalText) await this.sendText(finalText, origin);
    this.buffer = "";
  }

  async fail(): Promise<void> {
    this.completed = true;
    this.clearTimer();
    this.buffer = "";
  }

  private scheduleProgress(): void {
    if (this.timer || this.progressSent || this.policy.progressAfterMs <= 0 || this.sentCount >= this.maxMessages() - 1) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sendProgress().catch(() => {});
    }, this.policy.progressAfterMs);
  }

  private async sendProgress(): Promise<void> {
    if (this.completed || this.progressSent || this.sentCount >= this.maxMessages() - 1) return;
    this.progressSent = true;
    await this.sendText(this.policy.progressText);
  }

  private async sendText(text: string, origin?: MessageOrigin): Promise<void> {
    if (!text || this.sentCount >= this.maxMessages()) return;
    this.sentCount += 1;
    await this.send({ text, ...(this.replyTo ? { replyTo: this.replyTo } : {}), ...(origin ? { origin } : {}) });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private maxMessages(): number {
    return this.policy.maxMessagesPerExecution;
  }
}
