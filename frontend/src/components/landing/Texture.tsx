/**
 * Decorative backdrop for the black scenes.
 *
 * Purely visual: no interaction, nothing announced, and it always sits behind
 * the content, so the section it goes in needs `relative` and its content needs
 * a stacking context above `z-0`. The layers themselves are described in
 * `globals.css`.
 *
 * `full` is the hero treatment. `quiet` keeps only the grain and the edge
 * falloff, for scenes that already carry their own motion and would otherwise
 * fight the colour washes. `grain` is just the film noise, for the cardinal
 * scene, where a black vignette would muddy the brand colour.
 */
export function Texture({ variant = "full", seam = false }: { variant?: "full" | "quiet" | "grain"; seam?: boolean }) {
  return (
    <div aria-hidden className="tex">
      {variant === "full" && (
        <>
          <div className="tex-aurora absolute inset-0" />
          <div className="tex-grid" />
        </>
      )}
      <div className="tex-grain" />
      {variant !== "grain" && <div className="tex-vignette" />}
      {seam && <div className="tex-seam" />}
    </div>
  );
}
