import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, KeyRound, Code, Loader2, Clock, Eye, Heading, Terminal } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HistoryRow, HistoryStat } from "@/components/HistoryRow";
import { formatTimeRemaining } from "@/lib/utils";
import type { NoteWithStatus } from "@/hooks/useNoteHistory";

const CONTENT_TYPE_ICONS = {
  text: FileText,
  password: KeyRound,
  code: Code,
  markdown: Heading,
  sshkey: Terminal,
} as const;

interface NoteCardProps {
  note: NoteWithStatus;
  onDelete: (id: string, ownerToken: string) => Promise<void>;
}

export function NoteCard({ note, onDelete }: NoteCardProps) {
  const { t } = useTranslation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const shareLink = `${window.location.origin}/note/${note.id}#${note.secret}`;
  const Icon = CONTENT_TYPE_ICONS[note.contentType] ?? FileText;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(note.id, note.ownerToken);
    } catch {
      // Error handled by parent
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const info = note.info;

  return (
    <>
      <HistoryRow
        tile={
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
            <Icon className="h-4 w-4" />
          </span>
        }
        title={`${t(`tab.${note.contentType}`)} ${t("myUploads.note")}`}
        meta={
          note.loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.loading")}
            </span>
          ) : info ? (
            <>
              <HistoryStat icon={Eye}>
                {info.maxViews === 0 ? `${info.viewCount} / ∞` : `${info.viewCount}/${info.maxViews}`}
              </HistoryStat>
              <HistoryStat icon={Clock}>{formatTimeRemaining(info.expiresAt)}</HistoryStat>
            </>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5">{t("myUploads.unavailable")}</span>
          )
        }
        link={shareLink}
        openIcon={Eye}
        openLabel={t("common.view")}
        onQr={() => setShowQrDialog(true)}
        onDelete={() => setShowDeleteDialog(true)}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common.delete")}</DialogTitle>
            <DialogDescription>
              {t("myUploads.deleteNoteConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="animate-spin" />}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR code dialog */}
      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("share.qrCode")}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center">
            <div className="rounded-2xl bg-white p-3 shadow-chip">
              <QRCodeSVG value={shareLink} size={240} level="L" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
