import { Link } from "@tanstack/react-router";

const LINK = "inline-flex min-h-tap items-center text-body-sm text-brand underline";

/**
 * Links to the privacy policy and terms of service. Kept apart from routes/legal.tsx so pages in
 * the initial bundle (the landing page, sign-in) don't pull the full texts in with them.
 */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-5 ${className ?? ""}`}>
      <li>
        <Link to="/privacy" className={LINK}>
          Privacy policy
        </Link>
      </li>
      <li>
        <Link to="/terms" className={LINK}>
          Terms of service
        </Link>
      </li>
    </ul>
  );
}
