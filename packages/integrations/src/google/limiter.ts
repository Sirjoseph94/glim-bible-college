import { ProviderRateLimitedError } from "../live-provider/port";

/** Takes `cost` tokens from a bucket; returns 0, or the milliseconds to wait (`rl_acquire`). */
export type BucketAcquire = (
  key: string,
  capacity: number,
  refillPerSecond: number,
  cost?: number,
) => Promise<number>;

export type QuotaKind = "create" | "write" | "read";

/** Per minute, at 80 % of Google's per-user and per-project Meet quotas (TRD §11.7). */
const PER_MINUTE: Record<QuotaKind, { user: number; project: number }> = {
  create: { user: 8, project: 80 },
  write: { user: 80, project: 800 },
  read: { user: 480, project: 4800 },
};

/**
 * The quota limiter over Postgres token buckets, shared by every worker instance. A short wait is
 * slept through; a longer one throws `ProviderRateLimitedError` so the job reschedules itself
 * rather than holding a worker.
 */
export class GoogleRateLimiter {
  constructor(
    private readonly acquire: BucketAcquire,
    private readonly options: {
      maxWaitMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {}

  async take(kind: QuotaKind, hostEmail: string): Promise<void> {
    const limits = PER_MINUTE[kind];
    const maxWait = this.options.maxWaitMs ?? 10_000;
    const sleep =
      this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let waited = 0;
    for (const [key, perMinute] of [
      [`google:${kind}:user:${hostEmail.toLowerCase()}`, limits.user],
      [`google:${kind}:project`, limits.project],
    ] as const) {
      for (;;) {
        const wait = await this.acquire(key, perMinute, perMinute / 60, 1);
        if (wait === 0) break;
        if (waited + wait > maxWait) throw new ProviderRateLimitedError(wait);
        await sleep(wait);
        waited += wait;
      }
    }
  }
}
