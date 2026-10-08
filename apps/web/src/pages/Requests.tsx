import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Glow } from "@/components/Glow";
import { SignInRequired } from "@/components/SignInRequired";
import { RequestForm } from "@/components/RequestForm";
import { RequestLinksCard } from "@/components/RequestLinksCard";
import { NotFoundPage } from "@/pages/NotFound";
import { useServerConfig } from "@/hooks/useServerConfig";
import { useAuth } from "@/hooks/useAuth";
import { useCreateRequest } from "@/hooks/useFileRequests";
import { useRequestTemplates } from "@/hooks/useRequestTemplates";
import { useRequestLimit } from "@/hooks/useRequestLimit";
import { hashWasmArgon2 } from "@/lib/argon2";
import type { NewRequestOptions } from "@/hooks/useFileRequests";
import type { RequestTemplate } from "@/lib/request-templates";

/**
 * Creating a file request: the form, then the two links of the new one. The requests made
 * earlier are listed in My Links, like everything shared from this browser. With
 * `?template=<id>` the form starts from a kept template, with `?edit=<id>` it edits one.
 */
export function RequestsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { config, loading: configLoading } = useServerConfig();
  const { isLoggedIn, loading: authLoading } = useAuth(config);
  const creator = useCreateRequest(hashWasmArgon2);
  const kept = useRequestTemplates();
  // Asked again once a request was created, which counts one, or creating failed, which may
  // be the limit another tab used up.
  const dailyLimit = useRequestLimit(
    !!config?.fileRequestsEnabled,
    `${creator.created?.request.id ?? ""}:${creator.error ?? ""}`,
  );
  const editId = params.get("edit");
  const startId = params.get("template");
  const editing = editId ? kept.templates.find((template) => template.id === editId) : undefined;
  const start = startId ? kept.templates.find((template) => template.id === startId) : undefined;

  useEffect(() => {
    if (creator.error) toast.error(t(`request.error.${creator.error}`), { id: "request-error" });
  }, [creator.error, t]);

  // A template to edit that is no longer kept here leads back to the list, not to a new request.
  const editGone = !!editId && !kept.loading && !editing;
  useEffect(() => {
    if (!editGone) return;
    toast.error(t("templates.notFound"), { id: "template-gone" });
    navigate("/settings?tab=templates", { replace: true });
  }, [editGone, navigate, t]);

  // A template counts as used once a request was created from it, not when that failed.
  const usedRef = useRef<string | null>(null);
  const create = (options: NewRequestOptions, template?: RequestTemplate) => {
    usedRef.current = template?.id ?? null;
    void creator.create(options);
  };
  const { markUsed } = kept;
  useEffect(() => {
    const used = usedRef.current;
    if (!creator.created || !used) return;
    usedRef.current = null;
    void markUsed(used).catch(() => {});
  }, [creator.created, markUsed]);

  // The form takes its template once, so it waits for the templates when one is named.
  if (configLoading || !config || ((editId || startId) && kept.loading) || editGone) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-1/2 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-[28px]" />
      </div>
    );
  }
  if (!config.fileRequestsEnabled) return <NotFoundPage />;

  const signInRequired = config.oidcProtectRequests && !isLoggedIn && !authLoading;

  let body;
  if (signInRequired) {
    body = (
      <div className="p-2">
        <SignInRequired request />
      </div>
    );
  } else if (creator.created) {
    body = (
      <RequestLinksCard
        uploadLink={creator.created.uploadLink}
        inboxLink={creator.created.inboxLink}
        hasPassword={creator.created.request.hasPassword}
        onNewRequest={creator.reset}
      />
    );
  } else {
    body = (
      <RequestForm
        key={editing?.id ?? start?.id ?? "blank"}
        config={config}
        creating={creator.creating}
        onSubmit={create}
        templates={kept.templates}
        start={start}
        editing={editing}
        onSaveTemplate={kept.save}
        dailyLimit={dailyLimit}
        onEditDone={() => navigate("/settings?tab=templates", { replace: true })}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1
          data-slot="hero-title"
          className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px]"
        >
          {editing ? t("templates.editTitle") : t("requests.title")}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {editing ? t("templates.editIntro") : t("requests.intro")}
        </p>
      </header>

      <div className="relative">
        <Glow />
        <Card data-emphasis="main" className="relative p-2">
          {body}
        </Card>
      </div>
    </div>
  );
}
