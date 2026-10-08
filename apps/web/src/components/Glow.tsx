/**
 * The soft light behind a page's main card. It takes the accent, so CUSTOM_COLOR shows here too.
 * Its look is the `glow` class in index.css: a blur where a mouse is used, a gradient without a
 * filter on touch screens, where the blur held taps for over half a second.
 */
export function Glow() {
  return (
    <div
      aria-hidden="true"
      className="glow pointer-events-none absolute inset-x-[8%] top-16 h-80 rounded-full"
    />
  );
}
