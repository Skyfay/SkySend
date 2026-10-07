import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Heading, Maximize2, Type } from "lucide-react";
import type { TextBlock } from "@skysend/note-format";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BlockEditorFrame, IconButton } from "@/components/BlockEditorFrame";
import { MarkdownView } from "@/components/NoteBlocks";
import type { EditorMode } from "@/lib/note-editor";
import { cn } from "@/lib/utils";

interface TextBlockEditorProps {
  block: TextBlock;
  onChange: (block: TextBlock) => void;
  controls: ReactNode;
  disabled: boolean;
  mode?: EditorMode;
}

/**
 * A text block: plain text, or Markdown with a preview. Opens in a large dialog on request.
 * In a template it holds only what the text is about, and filling it in keeps that label.
 */
export function TextBlockEditor({ block, onChange, controls, disabled, mode = "compose" }: TextBlockEditorProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const markdown = block.format === "markdown";
  const showPreview = markdown && preview;

  const textareaClass = cn(
    "min-h-40 resize-y rounded-xl border-0 bg-transparent px-3 shadow-none focus-visible:ring-0",
    markdown && "font-mono text-sm",
  );
  const placeholder = markdown ? t("note.placeholder.markdown") : t("note.placeholder.text");
  const previewView = (className: string) =>
    block.text ? (
      <MarkdownView text={block.text} className={cn("rounded-xl bg-card p-4", className)} />
    ) : (
      <p className={cn("rounded-xl bg-card p-4 text-sm italic text-muted-foreground", className)}>{t("note.previewEmpty")}</p>
    );
  const modeToggle = markdown && (
    <ToggleGroup
      variant="segmented"
      type="single"
      value={preview ? "preview" : "edit"}
      onValueChange={(v) => v && setPreview(v === "preview")}
      aria-label={t("share.editorMode")}
    >
      <ToggleGroupItem value="edit">{t("note.edit")}</ToggleGroupItem>
      <ToggleGroupItem value="preview">{t("note.preview")}</ToggleGroupItem>
    </ToggleGroup>
  );

  const formatToggle = (
    <ToggleGroup
      variant="segmented"
      type="single"
      value={block.format}
      onValueChange={(v) => {
        if (v !== "plain" && v !== "markdown") return;
        onChange({ ...block, format: v });
        if (v === "plain") setPreview(false);
      }}
      aria-label={t("share.format")}
      disabled={disabled}
    >
      <ToggleGroupItem value="plain">
        <Type />
        {t("note.plainText")}
      </ToggleGroupItem>
      <ToggleGroupItem value="markdown">
        <Heading />
        {t("tab.markdown")}
      </ToggleGroupItem>
    </ToggleGroup>
  );

  if (mode === "template") {
    return (
      <BlockEditorFrame icon={FileText} title={t("tab.text")} controls={controls} toolbar={formatToggle}>
        <div className="space-y-2 p-3">
          <Input
            type="text"
            value={block.label ?? ""}
            onChange={(e) => onChange({ ...block, label: e.target.value })}
            placeholder={t("template.textLabel")}
            aria-label={t("template.textLabel")}
            disabled={disabled}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{t("template.textHint")}</p>
        </div>
      </BlockEditorFrame>
    );
  }

  return (
    <BlockEditorFrame
      icon={FileText}
      title={mode === "fill" && block.label ? block.label : t("tab.text")}
      controls={controls}
      toolbar={
        <>
          {mode === "compose" && formatToggle}
          {modeToggle}
          <IconButton variant="ghost" label={t("note.expand")} onClick={() => setExpanded(true)}>
            <Maximize2 />
          </IconButton>
        </>
      }
    >
      <div className="p-1.5">
        {showPreview ? (
          previewView("min-h-40")
        ) : (
          <Textarea
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            placeholder={placeholder}
            aria-label={t("tab.text")}
            className={textareaClass}
            disabled={disabled}
          />
        )}
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[90vh] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="flex-row flex-wrap items-center gap-3 space-y-0 border-b px-6 py-4 pr-14">
            <DialogTitle className="mr-auto flex items-center gap-2">
              {t("tab.text")}
              {markdown && <span className="text-sm font-normal text-muted-foreground">· {t("tab.markdown")}</span>}
            </DialogTitle>
            {modeToggle}
          </DialogHeader>
          <div className="flex-1 overflow-hidden p-4">
            {showPreview ? (
              previewView("h-full")
            ) : (
              <Textarea
                value={block.text}
                onChange={(e) => onChange({ ...block, text: e.target.value })}
                placeholder={placeholder}
                aria-label={t("tab.text")}
                className={cn(textareaClass, "h-full resize-none bg-well")}
                disabled={disabled}
                autoFocus
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </BlockEditorFrame>
  );
}
