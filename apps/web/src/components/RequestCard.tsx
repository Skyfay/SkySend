import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Inbox, Loader2, Lock, Upload } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import type { RequestWithStatus } from "@/hooks/useFileRequests";
import { requestLinks } from "@/lib/file-request";
import { subscribeUnseen, unseenFor } from "@/lib/unseen-uploads";
import { formatTimeRemaining } from "@/lib/utils";

interface RequestCardProps {
  request: RequestWithStatus;
  onDelete: (request: RequestWithStatus) => Promise<void>;
}

/** One request on the Requests page: what arrived, how long it stays open, both links. */
export function RequestCard({ request, onDelete }: RequestCardProps) {
  const { t } = useTranslation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { uploadLink, inboxLink } = requestLinks(request);
  const inbox = request.inbox;
  const unseen = useSyncExternalStore(subscribeUnseen, () => unseenFor(request.id));

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(request);
    } catch {
      // Error handled by parent
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  let meta;
  if (request.hasPassword) {
    meta = <HistoryStat icon={Lock}>{t("requests.passwordProtected")}</HistoryStat>;
  } else if (request.loading) {
    meta = (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("common.loading")}
      </span>
    );
  } else if (inbox) {
    meta = (
      <>
        {unseen > 0 && (
          <Badge variant="accent" className="h-5 px-2">
            {t("requests.new", { count: unseen })}
          </Badge>
        )}
        <HistoryStat icon={Upload}>
          {t("requests.received", { count: inbox.usedUploads })}
        </HistoryStat>
        <HistoryStat icon={Clock}>
          {inbox.open ? formatTimeRemaining(inbox.closesAt) : t("requests.closed")}
        </HistoryStat>
      </>
    );
  } else {
    meta = <span className="rounded-full bg-muted px-2 py-0.5">{t("myUploads.unavailable")}</span>;
  }

  return (
    <>
      <HistoryRow
        tile={
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
            <Inbox className="h-4 w-4" />
          </span>
        }
        title={request.title ?? t("requests.untitled")}
        meta={meta}
        link={uploadLink}
        copyLabel={t("requests.copyUploadLink")}
        openLink={inboxLink}
        openIcon={Inbox}
        openLabel={t("request.openInbox")}
        onQr={() => setShowQrDialog(true)}
        onDelete={() => setShowDeleteDialog(true)}
      />

      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("request.uploadLink")}</DialogTitle>
            <DialogDescription>{t("request.uploadLinkHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <div className="rounded-2xl bg-white p-3 shadow-chip">
              <QRCodeSVG value={uploadLink} size={224} level="L" />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {request.hasPassword ? t("requests.forgetTitle") : t("requests.deleteTitle")}
            </DialogTitle>
            <DialogDescription>
              {request.hasPassword ? t("requests.forgetText") : t("requests.deleteText")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin" />}
              {request.hasPassword ? t("requests.forget") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
