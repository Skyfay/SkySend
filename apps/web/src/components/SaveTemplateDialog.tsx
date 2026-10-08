import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Lock } from "lucide-react";
import { cleanLabel, MAX_LABEL_LENGTH } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sameName, type RequestTemplate } from "@/lib/request-templates";

export interface SaveChoice {
  name: string;
  keepTitle: boolean;
  keepLimits: boolean;
  /** The kept template the save goes over, the edited one or one with the same name. */
  replace?: RequestTemplate;
}

interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The name it starts with: the template edited or started from, or the title. */
  defaultName: string;
  /** The title of the form, which the template may keep. */
  title: string;
  /** The limits of the form in one line, which the template may keep. */
  limits: string;
  /** Whether the limits start ticked. The title does whenever there is one. */
  keepLimits: boolean;
  templates: readonly RequestTemplate[];
  /** The template that is edited, which saving replaces without asking. */
  editing?: RequestTemplate;
  onSave: (choice: SaveChoice) => Promise<void>;
}

/**
 * Saves the form as a template: its name, and whether the title and the limits go with it.
 * Fields go with it always, values and an inbox password never.
 */
export function SaveTemplateDialog({ open, onOpenChange, ...props }: SaveTemplateDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("templates.saveTitle")}</DialogTitle>
          <DialogDescription>{t("templates.saveText")}</DialogDescription>
        </DialogHeader>
        {/* Mounted per opening, so every opening starts from the form as it is now. */}
        {open && <SaveForm {...props} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SaveForm({
  defaultName,
  title,
  limits,
  keepLimits: keepLimitsFirst,
  templates,
  editing,
  onSave,
  onCancel,
}: Omit<SaveTemplateDialogProps, "open" | "onOpenChange"> & { onCancel: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState(defaultName);
  const [keepTitle, setKeepTitle] = useState(title.length > 0);
  const [keepLimits, setKeepLimits] = useState(keepLimitsFirst);
  const [saving, setSaving] = useState(false);

  const cleaned = cleanLabel(name);
  const clash = templates.find(
    (template) => template.id !== editing?.id && sameName(template.name, cleaned),
  );
  // An edited template keeps its own place, so it may not take the name of another one.
  const blocked = !!editing && !!clash;

  const submit = async () => {
    if (!cleaned || saving || blocked) return;
    setSaving(true);
    try {
      await onSave({ name: cleaned, keepTitle, keepLimits, replace: clash ?? editing });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`} className="text-[13px]">
          {t("templates.name")}
        </Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_LABEL_LENGTH}
          placeholder={t("templates.namePlaceholder")}
          aria-describedby={clash ? `${id}-clash` : undefined}
          aria-invalid={blocked}
          autoFocus
        />
        {clash && (
          <p
            id={`${id}-clash`}
            className={blocked ? "text-xs text-destructive-text" : "text-xs text-warning"}
          >
            {blocked ? t("templates.nameInUse") : t("templates.nameTaken")}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <label className="flex items-start gap-2.5 text-[13px] leading-snug">
          <Checkbox
            checked={keepTitle}
            onCheckedChange={(v) => setKeepTitle(v === true)}
            disabled={title.length === 0}
            className="mt-0.5"
          />
          <span className="min-w-0">
            {t("templates.keepTitle")}
            <span className="block text-muted-foreground line-clamp-2 wrap-anywhere">
              {title.length > 0 ? t("templates.quoted", { text: title }) : t("templates.noTitle")}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-[13px] leading-snug">
          <Checkbox
            checked={keepLimits}
            onCheckedChange={(v) => setKeepLimits(v === true)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            {t("templates.keepLimits")}
            <span className="block text-muted-foreground">{limits}</span>
          </span>
        </label>
      </div>

      <p className="flex items-start gap-2 rounded-2xl bg-well px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-text" />
        {t("templates.saveSecret")}
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!cleaned || saving || blocked}>
          {saving && <Loader2 className="animate-spin" />}
          {clash && !blocked ? t("templates.replace") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
