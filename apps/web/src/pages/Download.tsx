import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Shield,
  AlertCircle,
  Loader2,
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
import { useDownload } from "@/hooks/useDownload";

export function DownloadPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const downloadHook = useDownload();
  const [passwordInput, setPasswordInput] = useState<string | undefined>();

  // Get secret from URL fragment
  const secret = window.location.hash.slice(1);

  useEffect(() => {
    if (id && secret) {
      downloadHook.loadInfo(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    downloadHook.download(id, secret, pw);
  };

  const handleDownload = () => {
    downloadHook.download(id, secret, passwordInput);
  };

  return (
    <div className="space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
        <Shield className="h-7 w-7 text-primary" />
        {t("download.title")}
      </h1>

      <Card className={downloadHook.phase === "done" ? "border-primary/30 bg-primary/5" : ""}>
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

          {/* Download card when info is available and no password needed (or already unlocked) */}
          {downloadHook.info &&
            downloadHook.phase !== "needs-password" &&
            downloadHook.phase !== "safari-warning" && (
              <DownloadCard
                info={downloadHook.info}
                metadata={downloadHook.metadata}
                phase={downloadHook.phase}
                progress={downloadHook.progress}
                error={downloadHook.error}
                onDownload={handleDownload}
              />
            )}
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
