/** Messages for the `?error=` codes the Google callback sends back (contracts: GOOGLE_FAILURES). */
export const GOOGLE_ERRORS: Record<string, string> = {
  GOOGLE_UNAVAILABLE:
    "Sign-in with Google isn't available right now. Use your email and password, or try again later.",
  GOOGLE_SIGN_IN_FAILED: "Signing in with Google didn't complete. Please try again.",
  GOOGLE_EMAIL_UNVERIFIED:
    "Google hasn't verified that email address yet. Verify it with Google, then try again.",
  ACCOUNT_NOT_FOUND:
    "There's no GLIM account for that Google account. Staff accounts are created by the System Admin.",
  GOOGLE_DOMAIN_NOT_ALLOWED: "Staff must sign in with their GLIM Google Workspace account.",
  GOOGLE_ALREADY_LINKED:
    "That Google account is already linked to another GLIM account, or yours already has one.",
};

/**
 * Google's own sign-in button (decision UI-Q11): Google's light theme in light mode and its dark
 * theme in dark mode, with the standard four-colour "G". Google's branding rules don't allow a
 * brand-coloured fill, so this is a documented exception to the design system (glim-google-button).
 */
export function GoogleButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="glim-google-button flex h-control w-full items-center justify-center gap-3 rounded-md px-4 text-body font-medium"
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
        <path
          // eslint-disable-next-line glim/design-tokens -- design-exception: Google's four-colour G mark (UI-Q11)
          fill="#EA4335"
          d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z"
        />
        <path
          // eslint-disable-next-line glim/design-tokens -- design-exception: Google's four-colour G mark (UI-Q11)
          fill="#4285F4"
          d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z"
        />
        <path
          // eslint-disable-next-line glim/design-tokens -- design-exception: Google's four-colour G mark (UI-Q11)
          fill="#FBBC05"
          d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"
        />
        <path
          // eslint-disable-next-line glim/design-tokens -- design-exception: Google's four-colour G mark (UI-Q11)
          fill="#34A853"
          d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"
        />
      </svg>
      {label}
    </a>
  );
}
