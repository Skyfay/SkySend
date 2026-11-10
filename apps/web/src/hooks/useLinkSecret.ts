import { useEffect, useState } from "react";

/**
 * The key of a share link, read from the URL fragment at mount. The fragment stays in the
 * address bar, so a reload or a restored tab opens the link again.
 *
 * Editing the fragment by hand fires no navigation in the SPA, so a changed key reloads the
 * page and the share starts over with it instead of keeping the old one.
 */
export function useLinkSecret(): string {
  const [secret] = useState(() => window.location.hash.slice(1));

  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener("hashchange", reload);
    return () => window.removeEventListener("hashchange", reload);
  }, []);

  return secret;
}
