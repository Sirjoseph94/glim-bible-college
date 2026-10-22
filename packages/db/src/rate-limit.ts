import type pg from "pg";

/**
 * `rl_acquire` (TRD §6.7) as a function the Google quota limiter takes: 0 when the tokens were
 * taken, else the milliseconds to wait. Each call is its own short transaction on the pool.
 */
export function bucketAcquire(pool: pg.Pool) {
  return async (key: string, capacity: number, refillPerSecond: number, cost = 1) => {
    const { rows } = await pool.query<{ wait: number }>(
      "SELECT rl_acquire($1, $2, $3, $4) AS wait",
      [key, capacity, refillPerSecond, cost],
    );
    return rows[0]?.wait ?? 0;
  };
}
