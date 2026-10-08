import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { BookmarkPlus, SlidersHorizontal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DefaultsSettings } from "@/components/DefaultsSettings";
import { TemplateList } from "@/components/TemplateList";
import { useServerConfig } from "@/hooks/useServerConfig";
import { peekLinkImport, setLinkImport } from "@/lib/request-templates";

/**
 * The settings of this browser: what the forms start with, and the templates of requests.
 * Everything stays in this browser and the server learns none of it. Templates have a tab of
 * their own, `?tab=templates`, where a templates link arrives as well.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { config, loading } = useServerConfig();
  const [params, setParams] = useSearchParams();
  // The export a templates link brought, to import right away.
  const [linkImport, setLinkImportShown] = useState(() => peekLinkImport() ?? undefined);
  // Leaving the page drops it, so it never comes back on a later visit.
  useEffect(() => () => setLinkImport(null), []);

  if (loading || !config) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-1/2 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-[28px]" />
      </div>
    );
  }

  const templates = config.fileRequestsEnabled;
  const tab = templates && params.get("tab") === "templates" ? "templates" : "defaults";
  const defaults = <DefaultsSettings config={config} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1
          data-slot="hero-title"
          className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px]"
        >
          {t("settings.title")}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {t("settings.intro")}
        </p>
      </header>
      {templates ? (
        <Tabs
          value={tab}
          onValueChange={(v) => setParams(v === "templates" ? { tab: v } : {}, { replace: true })}
          className="space-y-6"
        >
          <TabsList aria-label={t("settings.title")}>
            <TabsTrigger value="defaults">
              <SlidersHorizontal />
              {t("settings.tabDefaults")}
            </TabsTrigger>
            <TabsTrigger value="templates">
              <BookmarkPlus />
              {t("settings.tabTemplates")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="defaults">{defaults}</TabsContent>
          <TabsContent value="templates">
            <TemplateList
              linkImport={linkImport}
              onLinkImportDone={() => {
                setLinkImport(null);
                setLinkImportShown(undefined);
              }}
            />
          </TabsContent>
        </Tabs>
      ) : (
        defaults
      )}
    </div>
  );
}
