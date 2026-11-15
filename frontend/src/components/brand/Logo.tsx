import Image from "next/image";

/**
 * Brand marks.
 *
 * Two artworks exist for every mark: one drawn for light backgrounds and one for
 * dark. Rather than swapping the `src` — which flashes while the new file
 * decodes — both are always mounted and cross-faded by opacity, so a surface
 * that changes tone mid-scroll (the landing header) stays seamless.
 *
 * Neither artwork works on cardinal: both keep a cardinal arch, which vanishes
 * into the background. Those surfaces pass `plate`, which sets the logo on a
 * paper chip — cardinal on white, which the palette does allow.
 */

export type Tone = "light" | "dark";

/** The paper chip that makes the mark usable on a cardinal surface. */
const PLATE = "inline-flex items-center rounded-full bg-paper";

// The artwork is trimmed to its content, so this box is all logo and no
// transparent margin: `height` is the height you actually see.
const WORDMARK_RATIO = 1599 / 400;

export function Wordmark({
  tone,
  height = 36,
  plate = false,
  priority = false,
  className = "",
}: {
  /** The tone of the surface behind the mark, not the mark itself. */
  tone: Tone;
  /** Cap height of the artwork in CSS pixels. */
  height?: number;
  /** Set the logo on a paper chip. Required on cardinal surfaces. */
  plate?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const width = Math.round(height * WORDMARK_RATIO);
  const common = "col-start-1 row-start-1 h-full w-auto transition-opacity duration-300";

  const art = (
    <span
      className={`grid shrink-0 ${plate ? "" : className}`}
      style={{ height, width }}
      role="img"
      aria-label="TrojanConnect"
    >
      <Image
        src="/brand/wordmark-on-light.png"
        alt=""
        width={width * 2}
        height={height * 2}
        priority={priority}
        className={`${common} ${tone === "light" ? "opacity-100" : "opacity-0"}`}
      />
      <Image
        src="/brand/wordmark-on-dark.png"
        alt=""
        width={width * 2}
        height={height * 2}
        priority={priority}
        className={`${common} ${tone === "dark" ? "opacity-100" : "opacity-0"}`}
      />
    </span>
  );

  if (!plate) return art;
  return (
    <span
      className={`${PLATE} ${className}`}
      style={{ paddingBlock: Math.round(height * 0.3), paddingInline: Math.round(height * 0.5) }}
    >
      {art}
    </span>
  );
}

/** The arch-and-helmet mark on its own, for tight spaces and avatars. */
export function Mark({
  tone = "light",
  size = 32,
  priority = false,
  className = "",
}: {
  tone?: Tone;
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  const common = "col-start-1 row-start-1 size-full transition-opacity duration-300";

  return (
    <span
      className={`grid shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="TrojanConnect"
    >
      <Image
        src="/brand/mark-on-light.png"
        alt=""
        width={size * 2}
        height={size * 2}
        priority={priority}
        className={`${common} ${tone === "light" ? "opacity-100" : "opacity-0"}`}
      />
      <Image
        src="/brand/mark-on-dark.png"
        alt=""
        width={size * 2}
        height={size * 2}
        priority={priority}
        className={`${common} ${tone === "dark" ? "opacity-100" : "opacity-0"}`}
      />
    </span>
  );
}
