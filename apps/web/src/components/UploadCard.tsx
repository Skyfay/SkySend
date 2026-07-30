import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Check,
  Trash2,
  FileIcon,
  Archive,
  Loader2,
  Clock,
  Download,
  QrCode,
  Pencil,
} from "lucide-react";
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
import { formatBytes, formatTimeRemaining } from "@/lib/utils";
import { UPLOAD_NAME_MAX_LENGTH } from "@/lib/upload-store";
import type { UploadWithStatus } from "@/hooks/useUploadHistory";

interface UploadCardProps {
  upload: UploadWithStatus;
  onDelete: (id: string, ownerToken: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}

export function UploadCard({ upload, onDelete, onRename }: UploadCardProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const shareLink = `${window.location.origin}/file/${upload.id}#${upload.secret}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

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
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
        {/* Icon + file info */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
            {isMulti ? (
              <Archive className="h-5 w-5 text-muted-foreground" />
            ) : (
              <FileIcon className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {upload.name ??
                (isMulti
                  ? t("myUploads.files", { count: upload.fileNames.length })
                  : upload.fileNames[0])}
            </p>
            {showFileList && (
              <p className="truncate text-sm text-muted-foreground" title={fileList}>
                {fileList}
              </p>
            )}
            {upload.loading ? (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t("common.loading")}</span>
              </div>
            ) : info ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{formatBytes(info.size)}</span>
                <span className="flex items-center gap-1">
                  <Download className="h-3 w-3" />
                  {info.downloadCount}/{info.maxDownloads}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTimeRemaining(info.expiresAt)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("myUploads.unavailable")}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={copyLink}>
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span className="ml-1 hidden sm:inline">
              {copied ? t("common.copied") : t("myUploads.copyLink")}
            </span>
          </Button>
          <Button variant="outline" size="sm" onClick={openRenameDialog}>
            <Pencil className="h-4 w-4" />
            <span className="sr-only">{t("myUploads.rename")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowQrDialog(true)}
          >
            <QrCode className="h-4 w-4" />
            <span className="sr-only">QR</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a href={shareLink}>
              <Download className="h-4 w-4" />
              <span className="sr-only">{t("common.download")}</span>
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            className="px-2.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">{t("common.delete")}</span>
          </Button>
        </div>
      </div>

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
              {renaming && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
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
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR code dialog */}
      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>QR Code</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={shareLink} size={240} level="L" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
