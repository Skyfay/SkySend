import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, X, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DownloadDebugInfo } from "@/hooks/useDownload";
import type { UploadDebugInfo } from "@/hooks/useUpload";

interface DebugPanelProps {
  downloadInfo?: DownloadDebugInfo | null;
  uploadInfo?: UploadDebugInfo | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DebugPanel({ downloadInfo, uploadInfo }: DebugPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!downloadInfo && !uploadInfo) return null;

  const handleCopy = () => {
    const data: Record<string, unknown> = {};
    if (downloadInfo) data.download = downloadInfo;
    if (uploadInfo) data.upload = uploadInfo;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const tierLabel = (tier: DownloadDebugInfo["tier"]) => {
    if (tier === "sw") return t("debug.tierSw");
    if (tier === "file-picker") return t("debug.tierFilePicker");
    if (tier === "blob") return t("debug.tierBlob");
    return "–";
  };

  const transportLabel = (transport: UploadDebugInfo["transport"]) => {
    if (transport === "ws") return t("debug.transportWs");
    if (transport === "http") return t("debug.transportHttp");
    return "–";
  };

  const allEvents = [
    ...(downloadInfo?.events ?? []),
    ...(uploadInfo?.events ?? []),
  ].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="mt-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        aria-expanded={open}
        aria-label={t("debug.title")}
      >
        <Info className="h-3.5 w-3.5" />
        {t("debug.title")}
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </Button>

      {open && (
        <div className="mt-1 rounded-lg border border-border/60 bg-muted/30 p-4 text-xs">
          {/* Header row */}
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold text-foreground">{t("debug.title")}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-6 gap-1 px-2 text-xs text-muted-foreground"
              >
                {copied ? (
                  <><Check className="h-3 w-3" />{t("debug.copied")}</>
                ) : (
                  <><Copy className="h-3 w-3" />{t("debug.copy")}</>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                className="h-6 w-6 p-0 text-muted-foreground"
                aria-label={t("debug.close")}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Download section */}
          {downloadInfo && (
            <div className="mb-3">
              <p className="mb-1.5 font-medium text-foreground">{t("debug.download")}</p>
              <div className="space-y-1 text-muted-foreground">
                <DebugRow label={t("debug.tier")} value={tierLabel(downloadInfo.tier)} />
                {downloadInfo.swPath && (
                  <DebugRow label={t("debug.swPath")} value={t("debug.swPathStream")} />
                )}
                <DebugRow label={t("debug.browser")} value={downloadInfo.browser} />
                {downloadInfo.devtools && (
                  <DebugRow label={t("debug.devtools")} value={t("debug.devtoolsDetected")} />
                )}
                {downloadInfo.fileSize != null && (
                  <DebugRow label={t("debug.fileSize")} value={formatBytes(downloadInfo.fileSize)} />
                )}
              </div>
            </div>
          )}

          {/* Divider between sections */}
          {downloadInfo && uploadInfo && (
            <hr className="my-3 border-border/40" />
          )}

          {/* Upload section */}
          {uploadInfo && (
            <div className="mb-3">
              <p className="mb-1.5 font-medium text-foreground">{t("debug.upload")}</p>
              <div className="space-y-1 text-muted-foreground">
                <DebugRow label={t("debug.transport")} value={transportLabel(uploadInfo.transport)} />
                {uploadInfo.fallback && (
                  <DebugRow label={t("debug.fallback")} value={t("debug.fallbackWsFailed")} />
                )}
                <DebugRow label={t("debug.browser")} value={uploadInfo.browser} />
              </div>
            </div>
          )}

          {/* Timeline */}
          {allEvents.length > 0 && (
            <>
              <hr className="my-3 border-border/40" />
              <p className="mb-1.5 font-medium text-foreground">{t("debug.timeline")}</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {allEvents.map((ev, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 tabular-nums text-muted-foreground/60">
                      {formatTime(ev.time)}
                    </span>
                    <span>{ev.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0">{label}</span>
      <span className="font-mono text-foreground/80">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / k ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
