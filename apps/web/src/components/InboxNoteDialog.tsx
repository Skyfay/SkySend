import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Copy, FileDown, ShieldQuestion, Trash2 } from "lucide-react";
import { noteToText, type ReadBlock } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NoteBlocks } from "@/components/NoteBlocks";
import { copyText } from "@/lib/clipboard";

/** A note opened from the inbox. Its plaintext lives here and nowhere else. */
export interface OpenedNote {
  blocks: ReadBlock[];
  unreadable: boolean;
}

interface InboxNoteDialogProps {
  note: OpenedNote | null;
  onClose: () => void;
  /** Deletes the note on the server, after asking. */
  onDelete: () => void;
}

/** Saves the note as a text file, straight from memory. */
function saveText(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "note.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A note a sender put into the inbox, shown with the renderers that are safe for any note.
 * A sender wrote it, so it carries the same warning as every upload.
 */
export function InboxNoteDialog({ note, onClose, onDelete }: InboxNoteDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = note ? noteToText(note.blocks) : "";

  const copy = async () => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={note !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("inbox.note")}</DialogTitle>
          <DialogDescription className="flex items-start gap-1.5">
            <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" />
            {t("inbox.unverifiedHint")}
          </DialogDescription>
        </DialogHeader>
        {note && (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="max-h-[60vh]">
            <div className="space-y-3 pr-3">
              {note.unreadable && (
                <p className="flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-[13px] text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("noteView.unreadable")}
                </p>
              )}
              <NoteBlocks blocks={note.blocks} />
            </div>
          </ScrollArea>
        )}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" className="text-destructive-text" onClick={onDelete}>
            <Trash2 />
            {t("common.delete")}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => saveText(text)} disabled={!text}>
              <FileDown />
              {t("inbox.saveText")}
            </Button>
            <Button onClick={() => void copy()} disabled={!text}>
              {copied ? <Check /> : <Copy />}
              {copied ? t("common.copied") : t("noteView.copyAll")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
