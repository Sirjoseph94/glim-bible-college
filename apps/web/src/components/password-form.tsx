import { useState } from "react";
import { Alert, Field, formText, SubmitButton } from "./form";
import { useSubmit } from "./use-submit";

/** New password + confirmation; the server enforces the policy (12+ characters, not breached). */
export function PasswordForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const { busy, error, fieldErrors, run } = useSubmit();
  const [mismatch, setMismatch] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const password = formText(form, "password");
        if (password !== formText(form, "confirm")) {
          setMismatch(true);
          return;
        }
        setMismatch(false);
        void run(() => onSubmit(password));
      }}
    >
      {error && !fieldErrors.password ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id="password"
        name="password"
        type="password"
        label="New password (at least 12 characters)"
        autoComplete="new-password"
        minLength={12}
        required
        error={fieldErrors.password ?? fieldErrors.token}
      />
      <Field
        id="confirm"
        name="confirm"
        type="password"
        label="Confirm the new password"
        autoComplete="new-password"
        required
        error={mismatch ? "The passwords don't match." : undefined}
      />
      <SubmitButton busy={busy}>{submitLabel}</SubmitButton>
    </form>
  );
}
