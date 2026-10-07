import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Archive,
  Clock,
  Download,
  MoreHorizontal,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HistoryStat } from "@/components/HistoryRow";
import { sanitizeFilename, type OpenedUpload } from "@/lib/file-request";
import { fileBadge } from "@/lib/file-badge";
import { cn, formatBytes, formatTimeRemaining } from "@/lib/utils";

interface InboxFileRowProps {
  entry: OpenedUpload;
  /** Whether it arrived since the inbox was last open in this browser. */
  fresh: boolean;
  /** Progress in percent while a download runs. */
  progress: number | undefined;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

/**
 * One upload in an inbox. Name and size come from the sender, so the name is cleaned and
 * the row says that nobody checked who sent it.
 */
export function InboxFileRow({
  entry,
  fresh,
  progress,
  onDownload,
  onCancel,
  onDelete,
}: InboxFileRowProps) {
  const { t } = useTranslation();
  const { upload, file } = entry;
  const metadata = file?.metadata;
  const downloadsLeft = upload.maxDownloads - upload.downloadCount;

  let tile;
  let title: string;
  let detail: string | undefined;
  if (!metadata) {
    tile = (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive-soft text-destructive-text">
        <AlertTriangle className="h-4 w-4" />
      </span>
    );
    title = t("inbox.damaged");
    detail = t("inbox.damagedHint");
  } else if (metadata.type === "single") {
    const name = sanitizeFilename(metadata.name);
    const badge = fileBadge(name);
    tile = (
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold",
          badge.className,
        )}
      >
        {badge.label}
      </span>
    );
    title = name;
  } else {
    tile = (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
        <Archive className="h-4 w-4" />
      </span>
    );
    title = t("myUploads.files", { count: metadata.files.length });
    detail = metadata.files.map((f) => sanitizeFilename(f.name)).join(", ");
  }
  const size = metadata
    ? metadata.type === "single"
      ? metadata.size
      : metadata.totalSize
    : upload.size;

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        {tile}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {detail && (
            <p className="line-clamp-2 text-xs text-muted-foreground wrap-anywhere">{detail}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {fresh && (
              <Badge variant="accent" className="h-5 px-2">
                {t("inbox.new")}
              </Badge>
            )}
            <span>{formatBytes(size)}</span>
            <HistoryStat icon={Download}>
              {t("inbox.downloadsLeft", { count: downloadsLeft })}
            </HistoryStat>
            <HistoryStat icon={Clock}>
              {t("inbox.deletedIn", { time: formatTimeRemaining(upload.expiresAt) })}
            </HistoryStat>
            {metadata && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge tabIndex={0} className="h-5 cursor-default px-2">
                    <ShieldQuestion />
                    {t("inbox.unverified")}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{t("inbox.unverifiedHint")}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {progress !== undefined && <Progress value={progress} className="mt-2 h-1.5" />}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
        {progress !== undefined ? (
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X />
            {t("download.cancel")}
          </Button>
        ) : (
          metadata && (
            <Button variant="outline" size="sm" onClick={onDownload} disabled={downloadsLeft <= 0}>
              <Download />
              {t("common.download")}
            </Button>
          )
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label={t("share.moreActions")}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive-text focus:bg-destructive-soft focus:text-destructive-text"
            >
              <Trash2 />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
