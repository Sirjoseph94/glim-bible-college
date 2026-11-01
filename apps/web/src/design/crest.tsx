import crestUrl from "../assets/crest-64.webp";

/** The source artwork is 500 × 515. */
const ASPECT = 500 / 515;

/**
 * The chip's padding and corner radius at each size (docs/ui-design-handoff.md §7.3). A
 * documented exception to tokens-only: the crest always sits on white, in both themes. Classes,
 * not a style attribute, so the chip keeps its shape on the static pages under `style-src 'self'`.
 */
const CHIP = {
  28: "p-0.5 rounded-sm",
  32: "p-0.5 rounded-sm",
  // eslint-disable-next-line glim/design-tokens -- design-exception: the crest chip (§7.3)
  36: "p-[3px] rounded-[8px]",
  // eslint-disable-next-line glim/design-tokens -- design-exception: the crest chip (§7.3)
  72: "p-1.5 rounded-[12px]",
} as const;

/** The GLIM crest: 28 in the phone top bar, 32 in the landing page's header, 36 in the desktop rail, 72 on sign-in. */
export function Crest({ size = 28 }: { size?: keyof typeof CHIP }) {
  return (
    <span className={`glim-chip inline-flex shrink-0 ${CHIP[size]}`}>
      <img src={crestUrl} alt="GLIM crest" height={size} width={Math.round(size * ASPECT)} />
    </span>
  );
}
