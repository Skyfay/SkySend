/** The soft light behind a page's main card. It takes the accent, so CUSTOM_COLOR shows here too. */
export function Glow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-[8%] top-16 h-80 rounded-full bg-primary-glow blur-[80px]"
    />
  );
}
