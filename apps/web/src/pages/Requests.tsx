import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Glow } from "@/components/Glow";
import { SignInRequired } from "@/components/SignInRequired";
import { RequestForm } from "@/components/RequestForm";
import { RequestLinksCard } from "@/components/RequestLinksCard";
import { RequestCard } from "@/components/RequestCard";
import { NotFoundPage } from "@/pages/NotFound";
import { useServerConfig } from "@/hooks/useServerConfig";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateRequest,
  useRequestHistory,
  type RequestWithStatus,
} from "@/hooks/useFileRequests";
import { hashWasmArgon2 } from "@/lib/argon2";

/**
 * File requests made in this browser: a form for a new one, its two links once created,
 * and the list of earlier ones.
 */
export function RequestsPage() {
  const { t } = useTranslation();
  const { config, loading: configLoading } = useServerConfig();
  const { isLoggedIn, loading: authLoading } = useAuth(config);
  const creator = useCreateRequest(hashWasmArgon2);
  const history = useRequestHistory();
  const { refresh } = history;

  useEffect(() => {
    if (creator.error) toast.error(t(`request.error.${creator.error}`), { id: "request-error" });
  }, [creator.error, t]);

  // A new request belongs in the list below right away.
  useEffect(() => {
    if (creator.created) refresh();
  }, [creator.created, refresh]);

  if (configLoading || !config) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-1/2 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-[28px]" />
      </div>
    );
  }
  if (!config.fileRequestsEnabled) return <NotFoundPage />;

  const signInRequired = config.oidcProtectFiles && !isLoggedIn && !authLoading;

  const handleDelete = async (request: RequestWithStatus) => {
    try {
      await history.remove(request);
      toast.success(request.hasPassword ? t("requests.forgotten") : t("requests.deleted"));
    } catch {
      toast.error(t("requests.deleteFailed"));
    }
  };

  let body;
  if (signInRequired) {
    body = (
      <div className="p-2">
        <SignInRequired />
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
    body = <RequestForm config={config} creating={creator.creating} onSubmit={creator.create} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1
          data-slot="hero-title"
          className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px]"
        >
          {t("requests.title")}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {t("requests.intro")}
        </p>
      </header>

      <div className="relative">
        <Glow />
        <Card data-emphasis="main" className="relative p-2">
          {body}
        </Card>
      </div>

      {history.requests.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">{t("requests.yours")}</h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border" role="list">
              {history.requests.map((request) => (
                <RequestCard key={request.id} request={request} onDelete={handleDelete} />
              ))}
            </ul>
          </Card>
          <p className="text-xs text-muted-foreground">{t("requests.localHint")}</p>
        </section>
      )}
    </div>
  );
}
