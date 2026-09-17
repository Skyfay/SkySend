// Applies the theme before the first paint, so a light theme does not flash dark
// while the app bundle loads. index.html loads this as a blocking classic script,
// which the CSP allows without an inline-script hash.
// The resolution order must stay in sync with src/hooks/useTheme.tsx.
(() => {
  const themes = ["dark", "light", "system"];
  const root = document.documentElement;
  // Server DEFAULT_THEME, injected into index.html when the page is served.
  let theme = root.dataset.defaultTheme;
  try {
    const stored = localStorage.getItem("skysend-theme");
    if (themes.includes(stored)) theme = stored;
  } catch {
    // Storage is blocked (private mode, strict site data settings). Keep the default.
  }
  if (!themes.includes(theme)) theme = "system";

  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#09090b" : "#ffffff");
})();
