import { useSuspenseQuery } from "@tanstack/react-query";
import { meQuery } from "../api/session";

export function HomePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  if (me === null) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">Welcome, {me.user.displayName}</h2>
      {me.roles.staff.length > 0 ? (
        <p className="text-slate-700">
          Signed in as {me.roles.staff.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}.
        </p>
      ) : null}
    </section>
  );
}
