import { Link } from "@tanstack/react-router";

/** Here rather than in routes/legal.tsx so the landing page can name the college without the texts. */
export const LEGAL_NAME = "GLIM Bible College";
export const LEGAL_CONTACT = "online@glimbiblecollege.com";

const LINK = "inline-flex min-h-tap items-center text-body-sm text-brand underline";

/**
 * Links to the privacy policy, terms of service and contact page. Kept apart from routes/legal.tsx so pages in
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
      <li>
        <Link to="/contact" className={LINK}>
          Contact
        </Link>
      </li>
    </ul>
  );
}
