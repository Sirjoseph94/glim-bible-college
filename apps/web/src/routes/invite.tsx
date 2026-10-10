import type { auth } from "@glim/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { api } from "../api/client";
import { signedIn } from "../api/session";

import { PasswordForm } from "../components/password-form";
import { AuthLayout } from "../components/app/auth-layout";

export function InvitePage() {
  const { token } = useParams({ from: "/invite/$token" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return (
    <AuthLayout title="Welcome — set your password">
      <PasswordForm
        submitLabel="Set password and sign in"
        onSubmit={async (password) => {
          const me = await api<typeof auth.acceptInvite>("POST", "/auth/invite/accept", {
            body: { token, password },
          });
          signedIn(queryClient, me);
          await navigate({ to: "/" });
        }}
      />
    </AuthLayout>
  );
}
