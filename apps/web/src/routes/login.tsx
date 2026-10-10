import type { auth } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "../api/client";
import type { ErrorCopy } from "../api/error-copy";
import { institutionQuery } from "../api/institution";
import { signedIn } from "../api/session";
import { AuthLayout } from "../components/app/auth-layout";
import { formText } from "../components/form";
import { GOOGLE_ERRORS, GoogleButton } from "../components/google";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Divider } from "../components/ui/divider";
import { TextField } from "../components/ui/field";
import { useSubmit } from "../components/use-submit";

/**
 * Sign in (docs/ui-design-handoff.md §11.1): Google first, because students need it to join
 * live classes; email and password are the fallback.
 */
export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { busy, problem, run } = useSubmit();
  const search = useSearch({ from: "/login" });
  const institution = useQuery(institutionQuery);
  const googleProblem: ErrorCopy | null = search.error
    ? { title: GOOGLE_ERRORS[search.error] ?? "Sign-in didn't complete. Please try again." }
    : null;
  const shown = problem ?? googleProblem;

  return (
    <AuthLayout
      title="Sign in"
      showTitle={false}
      intro="Live classes, recordings and results in one place."
    >
      {institution.data?.googleSignIn ? (
        <>
          <GoogleButton
            href="/api/v1/auth/google/start?intent=signin"
            label="Continue with Google"
          />
          <Divider label="or use your email" />
        </>
      ) : null}
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
        {shown ? (
          <Banner tone="danger" title={shown.title}>
            {shown.body}
          </Banner>
        ) : null}
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          required
        />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" variant="secondary" block loading={busy}>
          Sign in with email
        </Button>
        <Button asChild variant="quiet" block>
          <Link to="/forgot">Forgot password?</Link>
        </Button>
      </form>
      <p className="glim-identity-band rounded-md px-4 py-3 text-body-sm">
        Students: sign in with the Gmail account you gave the school. You need it to join live
        classes.
      </p>
    </AuthLayout>
  );
}
