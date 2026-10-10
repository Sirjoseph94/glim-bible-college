import type { auth } from "@glim/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { Alert, Field, formText, SubmitButton } from "../components/form";
import { useSubmit } from "../components/use-submit";
import { AuthLayout } from "../components/app/auth-layout";

export function ForgotPage() {
  const { busy, error, fieldErrors, run } = useSubmit();
  const [sent, setSent] = useState(false);

  return (
    <AuthLayout title="Reset your password">
      {sent ? (
        <Alert tone="success">
          If an account uses that email, we've sent a link to reset the password. It expires in 30
          minutes.
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const email = formText(new FormData(event.currentTarget), "email");
            void run(async () => {
              await api<typeof auth.forgotPassword>("POST", "/auth/password/forgot", {
                body: { email },
              });
              setSent(true);
            });
          }}
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field
            id="email"
            name="email"
            type="email"
            label="Email"
            autoComplete="username"
            required
            error={fieldErrors.email}
          />
          <SubmitButton busy={busy}>Email me a link</SubmitButton>
        </form>
      )}
      <p className="mt-4 text-center text-body-sm">
        <Link to="/login" className="text-brand underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
