import { useTranslation } from "react-i18next";
import { Lock, ShieldQuestion } from "lucide-react";
import { calculateEncryptedSize } from "@skysend/crypto";
import { padNote, serializeNote, type NoteBlock } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { BlockListEditor, addDraft } from "@/components/BlockListEditor";
import { BlockCards } from "@/components/NoteComposer";
import { blocksToSend, type DraftBlock } from "@/lib/note-editor";
import { cn, formatBytes } from "@/lib/utils";

interface RequestNoteFormProps {
  /** Whether the drafts follow a template, whose structure is the requester's. */
  template: boolean;
  /** Kept by the page, so a send that fails or is cancelled keeps what was typed. */
  drafts: DraftBlock[];
  onChange: (update: (current: DraftBlock[]) => DraftBlock[]) => void;
  /** The largest note the instance takes. */
  maxSize: number;
  /** The largest upload the request takes. The padded and encrypted note has to fit as well. */
  maxUploadSize: number;
  /** What the request still takes, shown beside the button. */
  limits: string;
  disabled: boolean;
  onSend: (blocks: NoteBlock[]) => void;
}

/**
 * A note for a file request: the requester's template filled in, or a note written freely.
 * The labels of a template come from the requester, so the form says that nobody checked them.
 */
export function RequestNoteForm({
  template,
  drafts,
  onChange,
  maxSize,
  maxUploadSize,
  limits,
  disabled,
  onSend,
}: RequestNoteFormProps) {
  const { t } = useTranslation();
  const toSend = blocksToSend(drafts);
  const document = toSend.length > 0 ? serializeNote(toSend) : "";
  const bytes = new TextEncoder().encode(document).length;
  const sent = document
    ? calculateEncryptedSize(new TextEncoder().encode(padNote(document)).length)
    : 0;
  const limit = Math.min(maxSize, maxUploadSize);
  const tooLarge = bytes > maxSize || sent > maxUploadSize;
  const canSend = toSend.length > 0 && !tooLarge && !disabled;

  if (!template && drafts.length === 0) {
    return (
      <BlockCards
        title={t("requestUpload.noteStart")}
        onPick={(type) => onChange((current) => addDraft(current, type))}
      />
    );
  }

  return (
    <div className="space-y-4">
      {template && (
        <p className="flex items-start gap-2 rounded-2xl border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] leading-relaxed text-warning">
          <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" />
          {t("requestUpload.noteHint")}
        </p>
      )}
      <BlockListEditor
        drafts={drafts}
        onChange={onChange}
        mode={template ? "fill" : "compose"}
        disabled={disabled}
        addon={
          <span
            className={cn(
              "ml-auto text-xs tabular-nums",
              tooLarge ? "text-destructive-text" : "text-muted-foreground",
            )}
          >
            {formatBytes(bytes)} / {formatBytes(limit)}
          </span>
        }
      />
      {tooLarge && (
        <p className="px-2 text-sm text-destructive-text" role="alert">
          {t("note.tooLarge", { size: formatBytes(limit) })}
        </p>
      )}
      <div className="flex flex-col gap-3 rounded-2xl bg-well p-3 sm:flex-row sm:items-center sm:pl-5">
        <p className="flex-1 text-[13px] leading-snug text-muted-foreground">{limits}</p>
        <Button
          size="lg"
          disabled={!canSend}
          onClick={() => onSend(toSend)}
          className="w-full sm:w-auto"
        >
          <Lock />
          {t("requestUpload.send")}
        </Button>
      </div>
    </div>
  );
}
