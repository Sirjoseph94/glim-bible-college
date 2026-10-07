import type { auth } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "../api/client";
import { institutionQuery } from "../api/institution";
import { signedIn } from "../api/session";
import { Alert, Card, Field, formText, SubmitButton } from "../components/form";
import { GOOGLE_ERRORS, GoogleButton } from "../components/google";
import { useSubmit } from "../components/use-submit";

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { busy, error, run } = useSubmit();
  const search = useSearch({ from: "/login" });
  const institution = useQuery(institutionQuery);

  return (
    <Card title="Sign in">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(async () => {
            const me = await api<typeof auth.login>("POST", "/auth/login", {
              body: { email: formText(form, "email"), password: formText(form, "password") },
            });
            signedIn(queryClient, me);
            await navigate({ to: "/" });
          });
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!error && search.error ? (
          <Alert tone="error">
            {GOOGLE_ERRORS[search.error] ?? "Sign-in didn't complete. Please try again."}
          </Alert>
        ) : null}
        {institution.data?.googleSignIn ? (
          <>
            <GoogleButton
              href="/api/v1/auth/google/start?intent=signin"
              label="Continue with Google"
            />
            <p className="text-center text-xs text-slate-500">
              or sign in with your email and password
            </p>
          </>
        ) : null}
        <Field
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          required
        />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
        />
        <SubmitButton busy={busy}>Sign in</SubmitButton>
        <p className="text-center text-sm">
          <Link to="/forgot" className="text-brand underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </Card>
  );
}
