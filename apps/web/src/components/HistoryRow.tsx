import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, MoreHorizontal, Pencil, QrCode, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HistoryRowProps {
  tile: ReactNode;
  title: ReactNode;
  detail?: string;
  meta: ReactNode;
  link: string;
  openIcon: LucideIcon;
  openLabel: string;
  onRename?: () => void;
  onQr: () => void;
  onDelete: () => void;
}

/**
 * One upload or note on the My Uploads page: what it is, how much of it is left, a copy
 * button for the link, and the rarer actions in a menu.
 */
export function HistoryRow({
  tile,
  title,
  detail,
  meta,
  link,
  openIcon: OpenIcon,
  openLabel,
  onRename,
  onQr,
  onDelete,
}: HistoryRowProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        {tile}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {detail && <p className="line-clamp-2 text-xs text-muted-foreground wrap-anywhere">{detail}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {meta}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
        <Button variant="outline" size="sm" onClick={copyLink}>
          {copied ? <Check className="text-primary-text" /> : <Copy />}
          {copied ? t("common.copied") : t("myUploads.copyLink")}
        </Button>
        {/* Not modal, so a dialog opened from an item gets the focus and the pointer back. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("share.moreActions")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={link}>
                <OpenIcon />
                {openLabel}
              </a>
            </DropdownMenuItem>
            {onRename && (
              <DropdownMenuItem onSelect={onRename}>
                <Pencil />
                {t("myUploads.rename")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onQr}>
              <QrCode />
              {t("share.qrCode")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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

/** A small stat in a history row, like the time left, with its icon. */
export function HistoryStat({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}
