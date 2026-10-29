-- TRD §6.7, §11.7: token buckets for the Google quota limiter. UNLOGGED: losing them in a crash
-- only means buckets start full again.
CREATE UNLOGGED TABLE rate_limit_buckets (
  key text PRIMARY KEY,
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Takes p_cost tokens from bucket p_key (capacity p_capacity, refilled at p_refill_per_sec).
-- Returns 0 when taken, else how many milliseconds to wait before asking again.
CREATE FUNCTION rl_acquire(p_key text, p_capacity int, p_refill_per_sec numeric, p_cost int DEFAULT 1)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_tokens double precision;
  v_updated timestamptz;
BEGIN
  INSERT INTO rate_limit_buckets (key, tokens, updated_at) VALUES (p_key, p_capacity, clock_timestamp())
    ON CONFLICT (key) DO NOTHING;
  SELECT tokens, updated_at INTO v_tokens, v_updated FROM rate_limit_buckets WHERE key = p_key FOR UPDATE;
  v_tokens := LEAST(p_capacity::double precision,
    v_tokens + extract(epoch FROM clock_timestamp() - v_updated) * p_refill_per_sec::double precision);
  IF v_tokens >= p_cost THEN
    UPDATE rate_limit_buckets SET tokens = v_tokens - p_cost, updated_at = clock_timestamp() WHERE key = p_key;
    RETURN 0;
  END IF;
  UPDATE rate_limit_buckets SET tokens = v_tokens, updated_at = clock_timestamp() WHERE key = p_key;
  RETURN ceil((p_cost - v_tokens) / p_refill_per_sec::double precision * 1000)::int;
END;
$$;
