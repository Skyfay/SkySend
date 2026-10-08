import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X, type LucideIcon } from "lucide-react";
import { MAX_LABEL_LENGTH } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  expanded?: boolean;
  variant?: "outline" | "ghost";
  className?: string;
}

/** An icon-only button with its label as tooltip. An open panel shows in the accent. */
export function IconButton({ label, onClick, children, disabled, expanded, variant = "outline", className }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="icon"
          className={cn(
            "shrink-0 aria-expanded:border-primary-line aria-expanded:bg-primary-soft aria-expanded:text-primary-text",
            variant === "ghost" && "h-8 w-8",
            className,
          )}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-expanded={expanded}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface BlockControlsProps {
  first: boolean;
  last: boolean;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

/** Moves a block up or down, or removes it. Given to each editor by the composer. */
export function BlockControls({ first, last, disabled, onMove, onRemove }: BlockControlsProps) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center">
      <IconButton variant="ghost" label={t("note.moveUp")} onClick={() => onMove(-1)} disabled={disabled || first}>
        <ChevronUp />
      </IconButton>
      <IconButton variant="ghost" label={t("note.moveDown")} onClick={() => onMove(1)} disabled={disabled || last}>
        <ChevronDown />
      </IconButton>
      <IconButton variant="ghost" label={t("note.removeBlock")} onClick={onRemove} disabled={disabled} className="hover:text-destructive-text">
        <X />
      </IconButton>
    </span>
  );
}

interface BlockTitleRowProps {
  value: string | undefined;
  onChange: (title: string) => void;
  placeholder: string;
  disabled: boolean;
}

/**
 * The title of a block, a borderless field at the top of its body, like the file name of a
 * code block. The title heads the block for whoever reads it.
 */
export function BlockTitleRow({ value, onChange, placeholder, disabled }: BlockTitleRowProps) {
  return (
    <div className="border-b border-border p-2 pl-3">
      <Input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={MAX_LABEL_LENGTH}
        className="h-8 w-full rounded-lg border-0 bg-transparent px-1 text-[13px] shadow-none focus-visible:ring-0"
        disabled={disabled}
        autoComplete="off"
      />
    </div>
  );
}

interface BlockEditorFrameProps {
  icon: LucideIcon;
  title: string;
  /** Switches of the block itself, like Plain text and Markdown. */
  toolbar?: ReactNode;
  controls: ReactNode;
  children: ReactNode;
}

/** The frame every block editor sits in, with its type, its own switches and the controls. */
export function BlockEditorFrame({ icon: Icon, title, toolbar, controls, children }: BlockEditorFrameProps) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-[20px] border border-border bg-well transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border py-1.5 pl-3 pr-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3 className="mr-1 text-[13px] font-semibold">{title}</h3>
        {toolbar}
        <span className="flex-1" />
        {controls}
      </header>
      {children}
    </section>
  );
}
