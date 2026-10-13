import { useState } from "react";
import { formText } from "./form";
import { Banner } from "./ui/banner";
import { Button } from "./ui/button";
import { TextField } from "./ui/field";
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
      {error && !fieldErrors.password ? <Banner tone="danger">{error}</Banner> : null}
      <TextField
        id="password"
        name="password"
        type="password"
        label="New password (at least 12 characters)"
        autoComplete="new-password"
        minLength={12}
        required
        error={fieldErrors.password ?? fieldErrors.token}
      />
      <TextField
        id="confirm"
        name="confirm"
        type="password"
        label="Confirm the new password"
        autoComplete="new-password"
        required
        error={mismatch ? "The passwords don't match." : undefined}
      />
      <Button type="submit" variant="primary" block loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
