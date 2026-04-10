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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DownloadCard } from "@/components/DownloadCard";
import { PasswordPrompt } from "@/components/PasswordPrompt";
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
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("download.fileInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Password prompt */}
          {downloadHook.phase === "needs-password" && (
            <PasswordPrompt
              onSubmit={handlePasswordSubmit}
              loading={false}
              error={downloadHook.error}
            />
          )}

          {/* Download card when info is available and no password needed (or already unlocked) */}
          {downloadHook.info &&
            downloadHook.phase !== "needs-password" && (
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
