import { cn } from "../../design/cn";

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function firstLetter(word: string): string {
  for (const { segment } of graphemes.segment(word.normalize("NFC")))
    return segment.toLocaleUpperCase("en");
  return "";
}

/**
 * Up to two initials from a display name: first and last name. A letter keeps its combining
 * marks (Ụ̀, Ọ́), so Yoruba, Igbo and Hausa names aren't cut mid-letter.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return "";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return firstLetter(first) + (last === undefined ? "" : firstLetter(last));
}

/** A 36px initials circle (§7.2, §9.21); no photos. The name is always written next to it. */
export function Avatar({ name, current = false }: { name: string; current?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-pill text-meta font-bold",
        current ? "bg-brand-soft text-brand" : "bg-surface-sunken text-ink-muted",
      )}
    >
      {initials(name)}
    </span>
  );
}
