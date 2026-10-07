import { useState } from "react";
import { Navigate } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerConfig } from "@/hooks/useServerConfig";
import { readTemplatesLink, setLinkImport } from "@/lib/request-templates";
import { NotFoundPage } from "@/pages/NotFound";

/** Reads the fragment once and takes it out of the address bar and the history at once. */
function takeFragment(): string {
  const fragment = window.location.hash.slice(1);
  window.history.replaceState(window.history.state, "", window.location.pathname);
  return fragment;
}

/**
 * A templates link: the export sits in the fragment, which never reaches the server. It goes
 * on to the Templates tab of the settings in memory, which offers to import it.
 */
export function TemplatesLinkPage() {
  const { config, loading } = useServerConfig();
  const [fragment] = useState(takeFragment);

  if (loading || !config) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-1/2 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-[28px]" />
      </div>
    );
  }
  if (!config.fileRequestsEnabled) return <NotFoundPage />;

  let text = "";
  try {
    text = readTemplatesLink(fragment);
  } catch {
    // An empty export, which the import names as not readable.
  }
  setLinkImport(text);
  return <Navigate to="/settings?tab=templates" replace />;
}
