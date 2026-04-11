import { useTranslation } from "react-i18next";
import {
  Download,
  FileIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatTimeRemaining } from "@/lib/utils";
import type { UploadInfo } from "@/lib/api";
import type { FileMetadata } from "@skysend/crypto";
import type { DownloadPhase } from "@/hooks/useDownload";

interface DownloadCardProps {
  info: UploadInfo;
  metadata: FileMetadata | null;
  phase: DownloadPhase;
  progress: number;
  error: string | null;
  onDownload: () => void;
}

export function DownloadCard({
  info,
  metadata,
  phase,
  progress,
  error,
  onDownload,
}: DownloadCardProps) {
  const { t } = useTranslation();

  const isDownloading = phase === "downloading";
  const isDone = phase === "done";
  const isError = phase === "error";

  return (
    <div className="space-y-6">
      {/* File info */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("download.fileInfo")}</h2>

        <div className="space-y-2 rounded-lg bg-muted/50 p-4">
          {/* File name(s) */}
          <div className="flex items-start gap-2">
            {metadata?.type === "archive" ? (
              <Archive className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            ) : (
              <FileIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              {metadata?.type === "single" ? (
                <p className="truncate font-medium">{metadata.name}</p>
              ) : metadata?.type === "archive" ? (
                <div>
                  <p className="font-medium">
                    {t("myUploads.files", { count: metadata.files.length })}
                  </p>
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-sm text-muted-foreground">
                    {metadata.files.map((f, i) => (
                      <li key={i} className="truncate">
                        {f.name} ({formatBytes(f.size)})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground">{t("download.fileInfo")}</p>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 pt-2 text-sm sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">{t("download.size")}: </span>
              <span className="font-medium">{formatBytes(info.size)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t("download.downloads")}: </span>
              <span className="font-medium">
                {info.downloadCount}/{info.maxDownloads}
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <span className="text-muted-foreground">{t("download.expires")}: </span>
              <span className="font-medium">
                {formatTimeRemaining(info.expiresAt)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Progress */}
      {isDownloading && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium">
              {t("download.downloading")}
            </span>
            <span className="ml-auto text-sm text-muted-foreground">
              {progress}%
            </span>
          </div>
          <Progress value={progress} />
        </div>
      )}

      {/* Done */}
      {isDone && (
        <div className="flex items-center gap-2 rounded-lg bg-success/10 p-4 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">{t("download.complete")}</span>
        </div>
      )}

      {/* Error */}
      {isError && error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-destructive-foreground">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Download button */}
      {!isDownloading && !isDone && (
        <Button
          onClick={onDownload}
          className="w-full"
          size="lg"
          disabled={isDownloading}
        >
          <Download className="mr-2 h-5 w-5" />
          {t("download.download")}
        </Button>
      )}
    </div>
  );
}
