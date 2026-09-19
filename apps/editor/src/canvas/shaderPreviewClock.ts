/** Editor-only content time. A held OGraf Step pauses transforms while this clock keeps moving. */
export class ShaderPreviewClock {
  #elapsedMs: number;
  #anchorMs = 0;
  #running = false;
  #listeners = new Set<() => void>();

  constructor(timestampMs = 0) {
    this.#elapsedMs = Math.max(0, timestampMs);
  }

  get running(): boolean {
    return this.#running;
  }

  sample(nowMs: number): number {
    return this.#elapsedMs + (this.#running ? Math.max(0, nowMs - this.#anchorMs) : 0);
  }

  /** Starting again after a held Step preserves its elapsed content time. */
  play(nowMs: number): void {
    if (this.#running) return;
    this.#anchorMs = nowMs;
    this.#running = true;
    this.#notify();
  }

  pause(nowMs: number): void {
    this.#elapsedMs = this.sample(nowMs);
    this.#running = false;
    this.#notify();
  }

  /** Explicit seeks, including a seek to the current frame, restore deterministic sampling. */
  seek(timestampMs: number): void {
    this.#elapsedMs = Math.max(0, timestampMs);
    this.#running = false;
    this.#notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
