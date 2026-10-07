import { useEffect } from "react";
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
import { hashWasmArgon2 } from "@/lib/argon2";

/**
 * Creating a file request: the form, then the two links of the new one. The requests made
 * earlier are listed in My Links, like everything shared from this browser.
 */
export function RequestsPage() {
  const { t } = useTranslation();
  const { config, loading: configLoading } = useServerConfig();
  const { isLoggedIn, loading: authLoading } = useAuth(config);
  const creator = useCreateRequest(hashWasmArgon2);

  useEffect(() => {
    if (creator.error) toast.error(t(`request.error.${creator.error}`), { id: "request-error" });
  }, [creator.error, t]);

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
    </div>
  );
}
