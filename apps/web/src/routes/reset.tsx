import type { auth } from "@glim/contracts";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { PasswordForm } from "../components/password-form";
import { AuthLayout } from "../components/app/auth-layout";

export function ResetPage() {
  const { token } = useParams({ from: "/reset/$token" });
  const [done, setDone] = useState(false);

  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <Alert tone="success">
          Your password has been changed and you've been signed out everywhere.{" "}
          <Link to="/login" className="underline">
            Sign in
          </Link>
        </Alert>
      ) : (
        <PasswordForm
          submitLabel="Change password"
          onSubmit={async (password) => {
            await api<typeof auth.resetPassword>("POST", "/auth/password/reset", {
              body: { token, password },
            });
            setDone(true);
          }}
        />
      )}
    </AuthLayout>
  );
}
