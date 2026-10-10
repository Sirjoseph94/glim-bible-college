import { useState } from "react";
import { ApiError } from "../api/client";
import { describeError, type ErrorCopy } from "../api/error-copy";

/**
 * Tracks a form submission: busy state, the error (as the server worded it, and as §12.3 copy
 * in `problem`) and per-field errors.
 */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ErrorCopy | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setProblem(null);
    setFieldErrors({});
    try {
      await action();
    } catch (e) {
      setProblem(describeError(e));
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

  return { busy, error, problem, fieldErrors, run };
}
