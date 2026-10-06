// Applies the color scheme before the first paint, so a light page does not flash dark
// while the app bundle loads. index.html loads this as a blocking classic script,
// which the CSP allows without an inline-script hash.
// The resolution order must stay in sync with src/hooks/useColorScheme.tsx.
(() => {
  const schemes = ["dark", "light", "system"];
  const root = document.documentElement;
  // The visual theme comes from the server too. A page served without the
  // placeholder filled in falls back to the default theme.
  if (!["aurora", "midnight", "graphite"].includes(root.dataset.theme)) {
    root.dataset.theme = "aurora";
  }
  // Server DEFAULT_COLOR_SCHEME, injected into index.html when the page is served.
  let scheme = root.dataset.defaultColorScheme;
  try {
    let stored = localStorage.getItem("skysend-color-scheme");
    // Before v3 the choice was stored as "skysend-theme". Carry it over once.
    const legacy = localStorage.getItem("skysend-theme");
    if (!schemes.includes(stored) && schemes.includes(legacy)) {
      localStorage.setItem("skysend-color-scheme", legacy);
      stored = legacy;
    }
    if (legacy !== null) localStorage.removeItem("skysend-theme");
    if (schemes.includes(stored)) scheme = stored;
  } catch {
    // Storage is blocked (private mode, strict site data settings). Keep the default.
  }
  if (!schemes.includes(scheme)) scheme = "system";

  const dark =
    scheme === "dark" ||
    (scheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#09090b" : "#ffffff");
})();
