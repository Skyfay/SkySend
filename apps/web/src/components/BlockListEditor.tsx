import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Code, FileText, KeyRound, Plus, Terminal, type LucideIcon } from "lucide-react";
import { MAX_BLOCKS, type NoteBlock, type NoteBlockType } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { BlockControls } from "@/components/BlockEditorFrame";
import { CodeBlockEditor } from "@/components/CodeBlockEditor";
import { PasswordBlockEditor } from "@/components/PasswordBlockEditor";
import { SshKeyBlockEditor } from "@/components/SshKeyBlockEditor";
import { TextBlockEditor } from "@/components/TextBlockEditor";
import { emptyBlock, type DraftBlock, type EditorMode } from "@/lib/note-editor";

export const BLOCK_TYPES: Array<{
  type: NoteBlockType;
  icon: LucideIcon;
  label: string;
  description: string;
}> = [
  { type: "text", icon: FileText, label: "tab.text", description: "note.cardText" },
  { type: "password", icon: KeyRound, label: "tab.password", description: "note.cardPassword" },
  { type: "code", icon: Code, label: "tab.code", description: "note.cardCode" },
  { type: "sshkey", icon: Terminal, label: "tab.sshkey", description: "note.cardSshKey" },
];

/** The draft with a new block of a type at the end, keyed one above the highest key. */
export function addDraft(drafts: readonly DraftBlock[], type: NoteBlockType): DraftBlock[] {
  const id = drafts.reduce((max, draft) => Math.max(max, draft.id), 0) + 1;
  return [...drafts, { ...emptyBlock(type), id }];
}

interface BlockListEditorProps {
  drafts: DraftBlock[];
  onChange: (drafts: DraftBlock[]) => void;
  mode: EditorMode;
  disabled: boolean;
  /** Shown at the end of the row of buttons that add a block, like the size of the note. */
  addon?: ReactNode;
}

/**
 * The blocks of a note, each in its own editor. Writing a note and laying out a template can
 * add, move and remove blocks. Filling in a template cannot, its structure is the requester's.
 */
export function BlockListEditor({ drafts, onChange, mode, disabled, addon }: BlockListEditorProps) {
  const { t } = useTranslation();
  const structured = mode !== "fill";

  const replace = (id: number, block: NoteBlock) =>
    onChange(drafts.map((draft) => (draft.id === id ? { ...block, id } : draft)));
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= drafts.length) return;
    const next = [...drafts];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const remove = (id: number) => onChange(drafts.filter((draft) => draft.id !== id));

  return (
    <div className="space-y-3">
      {drafts.map((draft, index) => {
        const controls = structured ? (
          <BlockControls
            first={index === 0}
            last={index === drafts.length - 1}
            disabled={disabled}
            onMove={(delta) => move(index, delta)}
            onRemove={() => remove(draft.id)}
          />
        ) : null;
        const props = {
          controls,
          disabled,
          mode,
          onChange: (block: NoteBlock) => replace(draft.id, block),
        };
        switch (draft.type) {
          case "text":
            return <TextBlockEditor key={draft.id} block={draft} {...props} />;
          case "password":
            return <PasswordBlockEditor key={draft.id} block={draft} {...props} />;
          case "code":
            return <CodeBlockEditor key={draft.id} block={draft} {...props} />;
          case "sshkey":
            return <SshKeyBlockEditor key={draft.id} block={draft} {...props} />;
        }
      })}

      {(structured || addon) && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          {structured && (
            <>
              <span className="mr-1 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <Plus className="h-3.5 w-3.5" />
                {t("note.addBlock")}
              </span>
              {BLOCK_TYPES.map(({ type, icon: Icon, label }) => (
                <Button
                  key={type}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[13px] hover:border-primary-line hover:text-primary-text"
                  onClick={() => onChange(addDraft(drafts, type))}
                  disabled={disabled || drafts.length >= MAX_BLOCKS}
                >
                  <Icon />
                  {t(label)}
                </Button>
              ))}
            </>
          )}
          {addon}
        </div>
      )}
    </div>
  );
}
