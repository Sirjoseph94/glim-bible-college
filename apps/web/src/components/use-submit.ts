import { useState } from "react";
import { ApiError } from "../api/client";

/** Tracks a form submission: busy state, the error message and per-field errors. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        setError(e.message);
      } else {
        setError("We couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, fieldErrors, run };
}
