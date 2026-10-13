/**
 * A circuit breaker per host account (TRD §11.7): it opens after 5 consecutive failed calls
 * within 30 s, then lets one probe through every 30 s (half-open) until a call succeeds. A call
 * that fails after its retries counts once.
 */
export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly threshold = 5,
    private readonly windowMs = 30_000,
    private readonly probeAfterMs = 30_000,
  ) {}

  get state(): BreakerState {
    if (this.openedAt === null) return "CLOSED";
    return this.now() - this.openedAt >= this.probeAfterMs ? "HALF_OPEN" : "OPEN";
  }

  /** Milliseconds until a call may be tried, or 0 if it may go now (claims the probe). */
  admit(): number {
    if (this.openedAt === null) return 0;
    const wait = this.openedAt + this.probeAfterMs - this.now();
    if (wait > 0) return wait;
    if (this.probing) return this.probeAfterMs;
    this.probing = true;
    return 0;
  }

  success(): void {
    this.failures = [];
    this.openedAt = null;
    this.probing = false;
  }

  failure(): void {
    const at = this.now();
    if (this.openedAt !== null) {
      // A failed probe: stay open for another period.
      this.openedAt = at;
      this.probing = false;
      return;
    }
    this.failures = [...this.failures.filter((t) => at - t < this.windowMs), at];
    if (this.failures.length >= this.threshold) this.openedAt = at;
  }
}
