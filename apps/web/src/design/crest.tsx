import crestUrl from "../assets/crest-64.webp";

/** The source artwork is 500 × 515. */
const ASPECT = 500 / 515;

/**
 * The chip's padding and corner radius at each size (docs/ui-design-handoff.md §7.3). A
 * documented exception to tokens-only: the crest always sits on white, in both themes.
 */
const CHIP = {
  28: { padding: 2, borderRadius: 6 },
  36: { padding: 3, borderRadius: 8 },
  72: { padding: 6, borderRadius: 12 },
} as const;

/** The GLIM crest: 28 in the phone top bar, 36 in the desktop rail, 72 on sign-in. */
export function Crest({ size = 28 }: { size?: keyof typeof CHIP }) {
  return (
    <span className="inline-flex shrink-0 bg-white" style={CHIP[size]}>
      <img src={crestUrl} alt="GLIM crest" height={size} width={Math.round(size * ASPECT)} />
    </span>
  );
}
