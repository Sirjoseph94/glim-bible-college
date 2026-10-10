/**
 * The in-house icon set (docs/ui-design-handoff.md §7.1, Appendix D): 26 stroke icons on a 24px
 * grid, inline SVG paths in `currentColor`. No icon font, sprite request or icon library.
 */
const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  play: "M8 5v14l11-7z",
  video: "M3 7h12v10H3zM15 10l6-3v10l-6-3",
  headphones: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z",
  award: "M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM8.5 14 7 22l5-3 5 3-1.5-8",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  check: "M5 12.5 10 17l9-10",
  alert: "M12 3 2 20h20zM12 10v4M12 17v.5",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.5",
  wifiOff:
    "M3 3l18 18M8.5 12.5a5 5 0 0 1 6-.8M5 9a10 10 0 0 1 4-2.2M12 18h.01M15.5 6.7A10 10 0 0 1 19 9",
  phone:
    "M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z",
  chevronRight: "M9 5l7 7-7 7",
  chevronLeft: "M15 5l-7 7 7 7",
  upload: "M12 21V9M7 14l5-5 5 5M4 4h16",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  users:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 4 6",
  settings:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  download: "M12 3v12M7 10l5 5 5-5M4 20h16",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  signal: "M4 20v-3M9 20v-7M14 20v-11M19 20V5",
} as const;

export type IconName = keyof typeof PATHS;

/** 16 inline with small text, 20 default, 22 navigation, 30 the player's play glyph (§7.1). */
export type IconSize = 16 | 20 | 22 | 30;

/**
 * Decorative by default (the visible word next to it carries the meaning). Give `label` only
 * when the icon stands alone, and it is then announced as an image.
 */
export function Icon({
  name,
  size = 20,
  label,
}: {
  name: IconName;
  size?: IconSize;
  label?: string;
}) {
  let d: string | undefined = (PATHS as Partial<Record<string, string>>)[name];
  if (d === undefined) {
    if (import.meta.env.DEV) console.warn(`Icon: unknown name "${name}", showing "info"`);
    d = PATHS.info;
  }
  const filled = name === "play";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      <path d={d} />
    </svg>
  );
}
