import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import { AlertCircle, Clock, Ban, FileQuestion } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ReceiveShell } from "@/components/ReceiveShell";
import { LinkGone } from "@/components/LinkGone";
import { DownloadCard } from "@/components/DownloadCard";
import { PasswordPrompt } from "@/components/PasswordPrompt";
import { SafariWarning } from "@/components/SafariWarning";
import { FirefoxDevToolsWarning } from "@/components/FirefoxDevToolsWarning";
import { DebugPanel } from "@/components/DebugPanel";
import { useDownload } from "@/hooks/useDownload";
import { useFaviconProgress } from "@/hooks/useFaviconProgress";
import { hashWasmArgon2 } from "@/lib/argon2";
import { showKnownErrorToast, showRewrittenLinkWarning } from "@/lib/toast";
import { wasShareLinkRewritten } from "@/lib/rewritten-link";

export function DownloadPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const downloadHook = useDownload();
  useFaviconProgress(downloadHook.phase === "downloading" ? downloadHook.progress : null);
  const [passwordInput, setPasswordInput] = useState<string | undefined>();

  // Get secret from URL fragment - captured once at mount so that history.replaceState
  // clearing the hash does not reset secret to "" on the next re-render.
  const [secret] = useState<string>(() => window.location.hash.slice(1));

  useEffect(() => {
    if (id && secret) {
      downloadHook.loadInfo(id, secret);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // A rewritten link means the key reached the server in the request path.
  useEffect(() => {
    if (wasShareLinkRewritten()) {
      showRewrittenLinkWarning();
    }
  }, []);

  // Remove the key from the URL fragment once decryption starts.
  // The key is now held in memory; removing it prevents browser-history leakage.
  useEffect(() => {
    if (downloadHook.phase === "downloading") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [downloadHook.phase]);

  // Show an enriched toast for download errors (e.g. S3 CORS).
  // Only fires for errors that occur after the file info was loaded
  // (phase=error + info present = the download itself failed, not a 404/expired).
  useEffect(() => {
    if (downloadHook.phase === "error" && downloadHook.info && downloadHook.error) {
      showKnownErrorToast(downloadHook.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadHook.phase, downloadHook.error]);

  if (!id || !secret) {
    return <LinkGone icon={FileQuestion} title={t("download.notFound")} />;
  }

  const title = (
    <Trans
      i18nKey="share.receivedFile"
      components={{ a: <span data-slot="accent" className="text-primary-text" /> }}
    />
  );

  if (downloadHook.phase === "loading-info") {
    return (
      <ReceiveShell title={title}>
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-[60px] w-full rounded-[20px]" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </ReceiveShell>
    );
  }

  if (
    downloadHook.phase === "error" &&
    !downloadHook.info
  ) {
    const error = downloadHook.error ?? "";
    const isExpired = error.includes("expired");
    const isLimitReached = error.includes("limit");

    return (
      <LinkGone
        icon={isExpired ? Clock : isLimitReached ? Ban : AlertCircle}
        title={
          isExpired
            ? t("download.expired")
            : isLimitReached
              ? t("download.limitReached")
              : error.includes("not found")
                ? t("download.notFound")
                : error
        }
      />
    );
  }

  // Unlocking only verifies the password and decrypts the metadata. The transfer
  // starts with a separate click, so no download is spent on a look at the file.
  const handlePasswordSubmit = (pw: string) => {
    setPasswordInput(pw);
    downloadHook.unlock(id, secret, pw, hashWasmArgon2);
  };

  const handleDownload = () => {
    downloadHook.download(id, secret, passwordInput, hashWasmArgon2);
  };

  return (
    <ReceiveShell title={title}>
      <div className="space-y-5">
        {/* Password prompt - stays mounted during the Argon2id stretch */}
        {(downloadHook.phase === "needs-password" ||
          downloadHook.phase === "verifying-password") && (
          <PasswordPrompt
            onSubmit={handlePasswordSubmit}
            loading={downloadHook.phase === "verifying-password"}
            error={downloadHook.error}
          />
        )}

        {/* Safari large-file warning */}
        {downloadHook.phase === "safari-warning" && downloadHook.info && (
          <SafariWarning
            fileSize={downloadHook.info.size}
            onContinue={downloadHook.confirmSafariDownload}
            onDismiss={downloadHook.dismissSafariWarning}
          />
        )}

        {/* Firefox DevTools warning */}
        {downloadHook.phase === "firefox-devtools-warning" && (
          <FirefoxDevToolsWarning
            onRetry={downloadHook.retryDevToolsCheck}
            onForce={downloadHook.forceDownloadWithDevTools}
            onDismiss={downloadHook.dismissDevToolsWarning}
          />
        )}

        {/* Download card when info is available and no password needed (or already unlocked) */}
        {downloadHook.info &&
          downloadHook.phase !== "needs-password" &&
          downloadHook.phase !== "verifying-password" &&
          downloadHook.phase !== "safari-warning" &&
          downloadHook.phase !== "firefox-devtools-warning" && (
            <DownloadCard
              info={downloadHook.info}
              metadata={downloadHook.metadata}
              phase={downloadHook.phase}
              progress={downloadHook.progress}
              speed={downloadHook.speed}
              averageSpeed={downloadHook.averageSpeed}
              error={null}
              onDownload={handleDownload}
              onCancel={downloadHook.cancel}
            />
          )}

        <DebugPanel downloadInfo={downloadHook.debugInfo} />
      </div>
    </ReceiveShell>
  );
}
