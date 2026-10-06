import { useTranslation } from "react-i18next";
import { Download, Loader2, Check, AlertCircle, Archive, Lock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatBytes, formatTimeRemaining } from "@/lib/utils";
import { fileBadge } from "@/lib/file-badge";
import type { UploadInfo } from "@/lib/api";
import type { FileMetadata } from "@skysend/crypto";
import type { DownloadPhase } from "@/hooks/useDownload";
import { useNavigate } from "react-router";

interface DownloadCardProps {
  info: UploadInfo;
  metadata: FileMetadata | null;
  phase: DownloadPhase;
  progress: number;
  speed?: string | null;
  averageSpeed?: string | null;
  error: string | null;
  onDownload: () => void;
  onCancel?: () => void;
}

function FileRow({ name, size }: { name: string; size: number }) {
  const badge = fileBadge(name);
  return (
    <li className="flex items-center gap-3 rounded-[14px] bg-card py-2 pl-2.5 pr-3 shadow-chip">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-mono text-[10px] font-bold",
          badge.className,
        )}
      >
        {badge.label}
      </span>
      {/* Names wrap instead of truncating, so the whole name stays readable. */}
      <p className="min-w-0 flex-1 text-sm font-medium wrap-anywhere">{name}</p>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatBytes(size)}</span>
    </li>
  );
}

export function DownloadCard({
  info,
  metadata,
  phase,
  progress,
  speed,
  averageSpeed,
  error,
  onDownload,
  onCancel,
}: DownloadCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isDownloading = phase === "downloading";
  const isDone = phase === "done";
  const isError = phase === "error";

  const stats = [
    { label: t("download.size"), value: formatBytes(info.size) },
    { label: t("download.downloads"), value: `${info.downloadCount}/${info.maxDownloads}` },
    { label: t("download.expires"), value: formatTimeRemaining(info.expiresAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-[20px] bg-well p-1.5">
        {metadata?.type === "archive" ? (
          <>
            <div className="flex items-center gap-2 px-2.5 pb-2 pt-1.5 text-[13px] font-medium">
              <Archive className="h-4 w-4 text-primary-text" />
              {t("myUploads.files", { count: metadata.files.length })}
            </div>
            {/* Cap the viewport, not the root, so long lists actually scroll. */}
            <ScrollArea viewportClassName="max-h-64">
              <ul className="space-y-1.5" role="list">
                {metadata.files.map((f, i) => (
                  <FileRow key={i} name={f.name} size={f.size} />
                ))}
              </ul>
            </ScrollArea>
          </>
        ) : metadata?.type === "single" ? (
          <ul role="list">
            <FileRow name={metadata.name} size={metadata.size} />
          </ul>
        ) : (
          <div className="flex items-center gap-3 rounded-[14px] bg-card py-2 pl-2.5 pr-3 shadow-chip">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary-text">
              <Lock className="h-4 w-4" />
            </span>
            <p className="text-sm font-medium">{t("download.encryptedFile")}</p>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {stats.map(({ label, value }) => (
          <div key={label} className="min-w-0 rounded-2xl bg-well px-3 py-2.5">
            <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      {isDownloading && (
        <div className="space-y-3">
          <div className="space-y-3 rounded-2xl bg-well p-4">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary-text" />
              <span className="text-sm font-medium">{t("download.downloading")}</span>
              <span className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground">
                {speed && <span>{speed}</span>}
                <span>{progress}%</span>
              </span>
            </div>
            <Progress value={progress} aria-label={t("download.downloading")} />
          </div>
          {onCancel && (
            <Button onClick={onCancel} variant="ghost" className="w-full">
              <X />
              {t("download.cancel")}
            </Button>
          )}
        </div>
      )}

      {isDone && (
        <div className="space-y-3">
          <div className="flex items-center gap-3.5 rounded-2xl bg-primary-soft p-4" role="status">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Check className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{t("download.complete")}</p>
              {averageSpeed && <p className="font-mono text-xs text-muted-foreground">Ø {averageSpeed}</p>}
            </div>
          </div>
          <Button onClick={() => navigate("/")} variant="outline" className="w-full">
            <Plus />
            {t("share.goneAction")}
          </Button>
        </div>
      )}

      {isError && error && (
        <div className="flex items-center gap-2 rounded-2xl bg-destructive-soft p-4 text-destructive-text" role="alert">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {!isDownloading && !isDone && (
        <div className="space-y-3">
          <Button onClick={onDownload} className="w-full" size="lg">
            <Download />
            {t("download.download")}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            {t("share.decryptHint")}
          </p>
        </div>
      )}
    </div>
  );
}
