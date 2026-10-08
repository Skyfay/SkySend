import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  File,
  Globe,
  HardDrive,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DownloadDebugInfo } from "@/hooks/useDownload";
import type { UploadDebugInfo } from "@/hooks/useUpload";
import { cn, formatBytes } from "@/lib/utils";

interface DebugPanelProps {
  downloadInfo?: DownloadDebugInfo | null;
  uploadInfo?: UploadDebugInfo | null;
}

/** One value in the tiles. `live` marks the path that is in use with a dot. */
interface Fact {
  icon: LucideIcon;
  label: string;
  value: string;
  live?: boolean;
  note?: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** How long after the first event, in the unit that reads best. */
function sinceStart(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)} ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `+${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/**
 * What an upload or a download used, for a bug report: a row that sums it up and opens the
 * details, the paths as tiles, and the timeline. It holds no key and no file name.
 */
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

  const facts: Fact[] = [];
  const summary: string[] = [];
  let alert: string | null = null;

  if (downloadInfo) {
    const method = downloadInfo.tier
      ? {
          sw: t("debug.tierSw"),
          "file-picker": t("debug.tierFilePicker"),
          blob: t("debug.tierBlob"),
        }[downloadInfo.tier]
      : "–";
    facts.push({ icon: Zap, label: t("debug.tier"), value: method, live: !!downloadInfo.tier });
    if (downloadInfo.swPath) {
      facts.push({ icon: ArrowRight, label: t("debug.swPath"), value: t("debug.swPathStream") });
    }
    facts.push({ icon: Globe, label: t("debug.browser"), value: downloadInfo.browser });
    if (downloadInfo.fileSize != null) {
      facts.push({
        icon: File,
        label: t("debug.fileSize"),
        value: formatBytes(downloadInfo.fileSize),
      });
    }
    summary.push(method, downloadInfo.browser);
    if (downloadInfo.devtools) alert = t("debug.devtoolsOpen");
  }

  if (uploadInfo) {
    const transport =
      uploadInfo.transport === "ws"
        ? t("debug.transportWs")
        : uploadInfo.transport === "http"
          ? t("debug.transportHttp")
          : "–";
    facts.push({
      icon: Zap,
      label: t("debug.transport"),
      value: transport,
      live: uploadInfo.transport !== null && !uploadInfo.fallback,
      note: uploadInfo.fallback ? t("debug.fallbackWsFailed") : undefined,
    });
    summary.push(transport);
    if (uploadInfo.storage) {
      const storage =
        uploadInfo.storage === "s3" ? t("debug.storageS3") : t("debug.storageFilesystem");
      facts.push({ icon: HardDrive, label: t("debug.storage"), value: storage });
      summary.push(storage);
    }
    facts.push({ icon: Globe, label: t("debug.browser"), value: uploadInfo.browser });
    summary.push(uploadInfo.browser);
    if (uploadInfo.fallback) alert = t("debug.fallbackWsFailed");
  }

  const events = [...(downloadInfo?.events ?? []), ...(uploadInfo?.events ?? [])].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const start = events.length > 0 ? new Date(events[0]!.time).getTime() : 0;

  return (
    <div className="space-y-2.5 border-t border-border pt-4">
      <Button
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="h-auto min-h-12 w-full justify-start gap-3 rounded-[14px] px-2 py-2 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-muted-foreground">
          <Activity />
        </span>
        <span>{t("debug.title")}</span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-normal text-muted-foreground">
          <span className="truncate">{summary.join(" · ")}</span>
          {alert && (
            <span className="flex shrink-0 items-center gap-1.5 text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              {alert}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="text-muted-foreground" />
        ) : (
          <ChevronDown className="text-muted-foreground" />
        )}
      </Button>

      {open && (
        <div className="space-y-5 rounded-[20px] border border-border bg-well p-4 sm:p-[18px]">
          <div className={cn("grid grid-cols-2 gap-2.5", facts.length === 3 && "sm:grid-cols-3")}>
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="min-w-0 rounded-[14px] border border-border bg-card px-3.5 py-3 shadow-chip"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <fact.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{fact.label}</span>
                </span>
                <span className="mt-1.5 flex items-center gap-2 text-sm font-medium tabular-nums">
                  {fact.live && (
                    <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-primary ring-[3px] ring-primary-soft" />
                  )}
                  <span className="truncate">{fact.value}</span>
                </span>
                {fact.note && <span className="mt-1 block text-xs text-warning">{fact.note}</span>}
              </div>
            ))}
          </div>

          {downloadInfo?.devtools && (
            <div className="flex gap-3 rounded-[14px] border border-warning/25 bg-warning-soft px-3.5 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="space-y-0.5 text-[13px] leading-relaxed">
                <p className="font-medium text-warning">{t("debug.devtoolsWarningTitle")}</p>
                <p className="text-foreground/80">{t("debug.devtoolsWarningText")}</p>
              </div>
            </div>
          )}

          {events.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">{t("debug.timeline")}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t("debug.started", { time: formatTime(events[0]!.time) })}
                </span>
              </div>
              <div className="relative">
                <span className="absolute bottom-2 left-1 top-2 w-px bg-border" />
                <ol className="space-y-3.5 pl-[22px]">
                  {events.map((event, i) => {
                    const last = i === events.length - 1;
                    return (
                      <li key={i} className="relative flex items-center gap-3 text-[13px]">
                        <span
                          className={cn(
                            "absolute -left-[22px] top-1 h-[9px] w-[9px] rounded-full ring-[3px] ring-well",
                            last
                              ? "bg-primary shadow-[0_0_0_6px_var(--color-primary-soft)]"
                              : "bg-input",
                          )}
                        />
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                          {event.message}
                          {event.detail && (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                                last
                                  ? "bg-primary-soft text-primary-text"
                                  : "bg-secondary text-muted-foreground",
                              )}
                            >
                              {event.detail}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {sinceStart(new Date(event.time).getTime() - start)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-muted-foreground">{t("debug.note")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="shrink-0 self-start sm:self-auto"
            >
              {copied ? <Check className="text-primary-text" /> : <Copy />}
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
