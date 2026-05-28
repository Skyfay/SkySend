import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Shield,
  AlertCircle,
  Clock,
  Ban,
  FileQuestion,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DownloadCard } from "@/components/DownloadCard";
import { PasswordPrompt } from "@/components/PasswordPrompt";
import { SafariWarning } from "@/components/SafariWarning";
import { FirefoxDevToolsWarning } from "@/components/FirefoxDevToolsWarning";
import { DebugPanel } from "@/components/DebugPanel";
import { useDownload } from "@/hooks/useDownload";
import { useFaviconProgress } from "@/hooks/useFaviconProgress";
import { hashWasmArgon2 } from "@/lib/argon2";
import { showKnownErrorToast } from "@/lib/toast";

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
      downloadHook.loadInfo(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    return (
      <ErrorDisplay
        icon={<FileQuestion className="h-8 w-8" />}
        title={t("download.notFound")}
      />
    );
  }

  if (downloadHook.phase === "loading-info") {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-8 w-56" />
          </div>
          <Skeleton className="h-4 w-72" />
        </div>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-11 w-full rounded-md" />
          </CardContent>
        </Card>
      </div>
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
      <ErrorDisplay
        icon={
          isExpired ? (
            <Clock className="h-8 w-8" />
          ) : isLimitReached ? (
            <Ban className="h-8 w-8" />
          ) : (
            <AlertCircle className="h-8 w-8" />
          )
        }
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

  const handlePasswordSubmit = (pw: string) => {
    setPasswordInput(pw);
    downloadHook.download(id, secret, pw, hashWasmArgon2);
  };

  const handleDownload = () => {
    downloadHook.download(id, secret, passwordInput, hashWasmArgon2);
  };

  return (
    <div className="space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
        <Shield className="h-7 w-7 text-primary" />
        {t("download.title")}
      </h1>

      <Card>
        <CardContent className="space-y-6 pt-6">
          {/* Password prompt */}
          {downloadHook.phase === "needs-password" && (
            <PasswordPrompt
              onSubmit={handlePasswordSubmit}
              loading={false}
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
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorDisplay({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center text-muted-foreground">
      {icon}
      <p className="text-lg font-medium">{title}</p>
    </div>
  );
}
