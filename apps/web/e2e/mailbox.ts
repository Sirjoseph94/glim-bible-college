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
