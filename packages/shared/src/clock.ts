/** Domain code reads time only through an injected Clock (TRD §5.1). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface Duration {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

export function durationMs(d: Duration): number {
  return (
    (d.days ?? 0) * 86_400_000 +
    (d.hours ?? 0) * 3_600_000 +
    (d.minutes ?? 0) * 60_000 +
    (d.seconds ?? 0) * 1000 +
    (d.milliseconds ?? 0)
  );
}

/** A controllable clock for tests. */
export class TestClock implements Clock {
  private current: number;

  constructor(start: string | Date = "2026-10-07T09:00:00Z") {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(to: string | Date): void {
    this.current = new Date(to).getTime();
  }

  advance(by: Duration): void {
    this.current += durationMs(by);
  }
}

/** DI token for the Clock. */
export const CLOCK = Symbol.for("glim.Clock");

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
