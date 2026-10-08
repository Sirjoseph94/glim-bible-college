const MAILBOX = "http://localhost:4174";

/** The token from the latest invite or reset link emailed to an address. */
export async function linkToken(to: string, kind: "invite" | "reset"): Promise<string> {
  const res = await fetch(`${MAILBOX}/last?to=${encodeURIComponent(to)}`);
  if (!res.ok) throw new Error(`No email for ${to}`);
  const { text } = (await res.json()) as { text: string };
  const token = new RegExp(`/${kind}/([A-Za-z0-9_-]+)`).exec(text)?.[1];
  if (token === undefined) throw new Error(`No ${kind} link in the email to ${to}`);
  return token;
}

/** The latest email to an address, or null if none has arrived yet. */
export async function lastEmail(to: string): Promise<{ subject: string; text: string } | null> {
  const res = await fetch(`${MAILBOX}/last?to=${encodeURIComponent(to)}`);
  return res.ok ? ((await res.json()) as { subject: string; text: string }) : null;
}

/** Who the fake Google signs in next. */
export async function nextGoogleSignIn(user: {
  sub: string;
  email: string;
  name?: string;
  hd?: string;
}): Promise<void> {
  const res = await fetch(`${MAILBOX}/google/next`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error("Could not queue the Google sign-in");
}

/** What the fake YouTube says about a video from now on. */
export async function scriptYouTube(
  videoId: string,
  status: "AVAILABLE" | "PRIVATE_OR_RESTRICTED" | "NOT_FOUND",
): Promise<void> {
  const res = await fetch(`${MAILBOX}/youtube/script`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoId, status }),
  });
  if (!res.ok) throw new Error("Could not script the fake YouTube");
}
