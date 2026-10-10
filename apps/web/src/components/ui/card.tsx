import type { ReactNode } from "react";
import { cn } from "../../design/cn";

/**
 * The class list for a card (§9.6). `interactive` is for a card that is itself one link: the
 * whole card is the target, so it holds no other buttons or links.
 */
export function cardClass({
  interactive = false,
  list = false,
}: { interactive?: boolean; list?: boolean } = {}): string {
  return cn(
    "rounded-md border border-line bg-surface-raised",
    list ? "divide-y divide-line overflow-hidden" : "p-4",
    interactive &&
      "block transition-colors duration-120 hover:border-line-strong hover:bg-surface-sunken",
  );
}

/** A raised, bordered surface. `list` holds rows edge to edge with dividers (rows pad themselves). */
export function Card({
  children,
  list = false,
  className,
}: {
  children: ReactNode;
  list?: boolean;
  className?: string;
}) {
  return <div className={cn(cardClass({ list }), className)}>{children}</div>;
}
