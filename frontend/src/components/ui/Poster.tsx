/**
 * A generated typographic poster for a club or event. We have no photography,
 * so each one is drawn from its name: same seed, same poster, every time.
 * Colours are USC cardinal and gold plus the tertiary palette, which the
 * identity guide reserves for graphic elements like this.
 */

type Palette = { bg: string; shape: string; text: string };

const PALETTES: Palette[] = [
  { bg: "#990000", shape: "#7a0000", text: "#ffcc00" },
  { bg: "#ffcc00", shape: "#ffe680", text: "#990000" },
  { bg: "#000000", shape: "#990000", text: "#ffcc00" },
  { bg: "#2b5597", shape: "#ffcc00", text: "#ffffff" },
  { bg: "#f2c6a7", shape: "#f26178", text: "#000000" },
  { bg: "#dae343", shape: "#908c13", text: "#000000" },
  { bg: "#ff9015", shape: "#fde021", text: "#000000" },
  { bg: "#f26178", shape: "#f2c6a7", text: "#000000" },
  { bg: "#908c13", shape: "#dae343", text: "#000000" },
  { bg: "#6b0000", shape: "#e43d30", text: "#ffffff" },
];

function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(name: string) {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["of", "the", "and", "at", "for", "usc"].includes(w.toLowerCase()));
  if (words.length === 0) return "TC";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

type Props = {
  /** Stable id; decides colour and layout. */
  seed: string;
  /** Name the initials are drawn from. */
  name: string;
  className?: string;
};

export function Poster({ seed, name, className = "" }: Props) {
  const h = hash(seed);
  const palette = PALETTES[h % PALETTES.length];
  const layout = (h >>> 8) % 5;
  const mark = initials(name);
  const font = "var(--font-bricolage), system-ui, sans-serif";

  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Poster for ${name}`}
      className={`block rounded-xl ${className}`}
      preserveAspectRatio="xMinYMax slice"
    >
      <rect width="100" height="100" fill={palette.bg} />
      {layout === 0 && <circle cx="74" cy="26" r="34" fill={palette.shape} />}
      {layout === 1 && (
        <polygon points="0,62 100,18 100,46 0,90" fill={palette.shape} />
      )}
      {layout === 2 && <rect x="0" y="0" width="100" height="42" fill={palette.shape} />}
      {layout === 3 && (
        <>
          <circle cx="22" cy="24" r="12" fill={palette.shape} />
          <circle cx="52" cy="24" r="12" fill={palette.shape} />
          <circle cx="82" cy="24" r="12" fill={palette.shape} />
        </>
      )}
      {layout === 4 && (
        <path d="M100 0 L100 100 L30 100 Q100 70 100 0 Z" fill={palette.shape} />
      )}
      <text
        x="9"
        y="89"
        fill={palette.text}
        fontFamily={font}
        fontSize="46"
        fontWeight="800"
        letterSpacing="-2"
        style={{ fontVariationSettings: '"wdth" 80' }}
      >
        {mark}
      </text>
    </svg>
  );
}
