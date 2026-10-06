import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Loader2, Clock, Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HistoryRow, HistoryStat } from "@/components/HistoryRow";
import { cn, formatBytes, formatTimeRemaining } from "@/lib/utils";
import { fileBadge } from "@/lib/file-badge";
import { UPLOAD_NAME_MAX_LENGTH } from "@/lib/upload-store";
import type { UploadWithStatus } from "@/hooks/useUploadHistory";

interface UploadCardProps {
  upload: UploadWithStatus;
  onDelete: (id: string, ownerToken: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}

export function UploadCard({ upload, onDelete, onRename }: UploadCardProps) {
  const { t } = useTranslation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const shareLink = `${window.location.origin}/file/${upload.id}#${upload.secret}`;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(upload.id, upload.ownerToken);
    } catch {
      // Error handled by parent
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const openRenameDialog = () => {
    setNameInput(upload.name ?? "");
    setShowRenameDialog(true);
  };

  const handleRename = async () => {
    setRenaming(true);
    try {
      await onRename(upload.id, nameInput);
      setShowRenameDialog(false);
    } catch {
      // Error handled by parent
    } finally {
      setRenaming(false);
    }
  };

  const isMulti = upload.fileNames.length > 1;
  const info = upload.info;
  const fileList = upload.fileNames.join(", ");
  // With a custom name the file names would otherwise be invisible, and a plain
  // count says nothing about a multi-file upload.
  const showFileList = Boolean(upload.name) || isMulti;

  return (
    <>
      <HistoryRow
        tile={
          isMulti ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
              <Archive className="h-4 w-4" />
            </span>
          ) : (
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold",
                fileBadge(upload.fileNames[0] ?? "").className,
              )}
            >
              {fileBadge(upload.fileNames[0] ?? "").label}
            </span>
          )
        }
        title={
          upload.name ??
          (isMulti ? t("myUploads.files", { count: upload.fileNames.length }) : upload.fileNames[0])
        }
        detail={showFileList ? fileList : undefined}
        meta={
          upload.loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.loading")}
            </span>
          ) : info ? (
            <>
              <span>{formatBytes(info.size)}</span>
              <HistoryStat icon={Download}>
                {info.downloadCount}/{info.maxDownloads}
              </HistoryStat>
              <HistoryStat icon={Clock}>{formatTimeRemaining(info.expiresAt)}</HistoryStat>
            </>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5">{t("myUploads.unavailable")}</span>
          )
        }
        link={shareLink}
        openIcon={Download}
        openLabel={t("common.download")}
        onRename={openRenameDialog}
        onQr={() => setShowQrDialog(true)}
        onDelete={() => setShowDeleteDialog(true)}
      />

      {/* Rename dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("myUploads.renameTitle")}</DialogTitle>
            <DialogDescription>
              {t("myUploads.renameDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!renaming) handleRename();
            }}
          >
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t("myUploads.renamePlaceholder")}
              maxLength={UPLOAD_NAME_MAX_LENGTH}
              aria-label={t("myUploads.renameTitle")}
              autoFocus
            />
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRenameDialog(false)}
              disabled={renaming}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={renaming}>
              {renaming && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("common.delete")}</DialogTitle>
            <DialogDescription>
              {t("myUploads.deleteConfirm")}
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
