import { useState } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DownloadDebugInfo } from "@/hooks/useDownload";
import type { UploadDebugInfo } from "@/hooks/useUpload";

interface Props {
  download?: DownloadDebugInfo | null;
  upload?: UploadDebugInfo | null;
}

interface RowProps {
  label: string;
  value: string;
  highlight?: boolean;
}

function Row({ label, value, highlight }: RowProps) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${highlight ? "text-amber-500 dark:text-amber-400" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export function DebugPanel({ download, upload }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!download && !upload) return null;

  const tierLabel = (tier: DownloadDebugInfo["tier"]) => {
    if (tier === "sw") return t("debug.tierSw");
    if (tier === "file-picker") return t("debug.tierFilePicker");
    return t("debug.tierBlob");
  };

  const swPathLabel = (swPath: DownloadDebugInfo["swPath"]) => {
    if (swPath === "worker") return t("debug.swPathWorker");
    if (swPath === "stream") return t("debug.swPathStream");
    return "-";
  };

  const transportLabel = (info: UploadDebugInfo) => {
    if (info.transport === "ws") return t("debug.transportWs");
    if (info.wsFailed) return t("debug.wsFailed");
    return t("debug.transportHttp");
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Info className="size-3.5" />
        {t("debug.title")}
      </button>

      {open && (
        <div className="mt-2 rounded-md border bg-muted/40 p-3 space-y-2">
          {download && (
            <>
              <p className="text-xs font-medium">{t("debug.download")}</p>
              <Row label={t("debug.downloadTier")} value={tierLabel(download.tier)} />
              {download.tier === "sw" && (
                <Row
                  label={t("debug.swPath")}
                  value={swPathLabel(download.swPath)}
                />
              )}
              <Row label={t("debug.browser")} value={download.browser} />
              <Row
                label={t("debug.devToolsDetected")}
                value={download.devToolsDetected ? t("debug.yes") : t("debug.no")}
                highlight={download.devToolsDetected}
              />
            </>
          )}

          {upload && (
            <>
              <p className="text-xs font-medium">{t("debug.upload")}</p>
              <Row label={t("debug.uploadTransport")} value={transportLabel(upload)} />
              <Row label={t("debug.browser")} value={upload.browser} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
