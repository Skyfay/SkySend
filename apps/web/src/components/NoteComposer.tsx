import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { serializeNote, type NoteBlockType } from "@skysend/note-format";
import { BLOCK_TYPES, BlockListEditor, addDraft } from "@/components/BlockListEditor";
import { ShareFooter } from "@/components/ShareFooter";
import { ShareLink } from "@/components/ShareLink";
import { ShareOptions } from "@/components/ShareOptions";
import { useNoteUpload } from "@/hooks/useNoteUpload";
import type { ServerConfig } from "@/lib/api";
import { noteStart } from "@/lib/defaults";
import { blocksToSend, emptyBlock, type DraftBlock } from "@/lib/note-editor";
import { showKnownErrorToast } from "@/lib/toast";
import { cn, formatBytes } from "@/lib/utils";

/** The start of an empty note: one card per block type. A click starts the note with it. */
export function BlockCards({
  onPick,
  title,
  hint,
}: {
  onPick: (type: NoteBlockType) => void;
  title?: string;
  hint?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-2 pb-2 pt-4 sm:px-3">
      <h2 className="text-base font-semibold tracking-tight">{title ?? t("share.what")}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{hint ?? t("note.startHint")}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-2.5">
        {BLOCK_TYPES.map(({ type, icon: Icon, label, description }) => (
          <button
            key={type}
            type="button"
            onClick={() => onPick(type)}
            className="flex flex-col items-start gap-2.5 rounded-2xl border border-border bg-well p-3.5 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-primary-line hover:shadow-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:flex-row sm:gap-3.5 sm:p-4"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text sm:h-10 sm:w-10">
              <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{t(label)}</span>
              <span className="text-xs leading-snug text-muted-foreground sm:text-[13px]">{t(description)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface NoteComposerProps {
  config: ServerConfig;
  /** The block an empty note starts with. Null shows the cards. */
  startWith: NoteBlockType | null;
}

/** The note tab: blocks of any type in any order, shared as one encrypted note. */
export function NoteComposer({ config, startWith }: NoteComposerProps) {
  const { t } = useTranslation();
  const noteHook = useNoteUpload();
  const initialBlocks = (): DraftBlock[] => (startWith ? [{ ...emptyBlock(startWith), id: 1 }] : []);
  const [drafts, setDrafts] = useState<DraftBlock[]>(initialBlocks);
  // This browser's defaults within what the server offers.
  const [start] = useState(() => noteStart(config));
  const [expireSec, setExpireSec] = useState(start.expireSec);
  const [maxViews, setMaxViews] = useState(start.limit);
  const [password, setPassword] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(start.password);

  useEffect(() => {
    if (noteHook.phase === "error" && noteHook.error) showKnownErrorToast(noteHook.error);
  }, [noteHook.phase, noteHook.error]);

  const busy = noteHook.phase === "encrypting" || noteHook.phase === "uploading";
  const toSend = blocksToSend(drafts);
  // The size the server checks is the encrypted document, which is this plus a 16-byte tag.
  const bytes = toSend.length > 0 ? new TextEncoder().encode(serializeNote(toSend)).length : 0;
  const tooLarge = bytes > config.noteMaxSize;
  const canSubmit = toSend.length > 0 && !tooLarge && !busy;

  const add = (type: NoteBlockType) => setDrafts((current) => addDraft(current, type));

  const submit = () =>
    noteHook.upload({ blocks: toSend, maxViews, expireSec, password: passwordEnabled ? password : "" });

  const startOver = () => {
    noteHook.reset();
    setDrafts(initialBlocks());
    setPassword("");
    setPasswordEnabled(noteStart(config).password);
  };

  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={startOver} />;
  }

  if (drafts.length === 0) return <BlockCards onPick={add} />;

  return (
    <div className="space-y-5">
      <BlockListEditor
        drafts={drafts}
        onChange={setDrafts}
        mode="compose"
        disabled={busy}
        addon={
          <span className={cn("ml-auto text-xs tabular-nums", tooLarge ? "text-destructive-text" : "text-muted-foreground")}>
            {formatBytes(bytes)} / {formatBytes(config.noteMaxSize)}
          </span>
        }
      />

      {tooLarge && (
        <p className="px-2 text-sm text-destructive-text" role="alert">
          {t("note.tooLarge", { size: formatBytes(config.noteMaxSize) })}
        </p>
      )}

      <div className="px-2 sm:px-3">
        <ShareOptions
          kind="note"
          expireOptions={config.noteExpireOptions}
          expireSec={expireSec}
          onExpireChange={setExpireSec}
          limitOptions={config.noteViewOptions}
          limit={maxViews}
          onLimitChange={setMaxViews}
          passwordEnabled={passwordEnabled}
          onPasswordEnabledChange={setPasswordEnabled}
          password={password}
          onPasswordChange={setPassword}
          forcePassword={config.forceNotePassword}
          disabled={busy}
        />
      </div>

      <ShareFooter
        kind="note"
        expireSec={expireSec}
        limit={maxViews}
        label={t("share.encryptShare")}
        busyLabel={t("note.creating")}
        icon={<Send />}
        busy={busy}
        disabled={!canSubmit}
        onSubmit={submit}
      />
    </div>
  );
}
