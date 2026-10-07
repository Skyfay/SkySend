import { useId } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  BUILT_IN_KEYS,
  builtInTemplate,
  type BuiltInKey,
  type RequestTemplate,
} from "@/lib/request-templates";
import { cn } from "@/lib/utils";

/** What the form started from: nothing, a kept template by its ID, or one that comes with SkySend. */
export type TemplateStartValue = "blank" | `builtin:${BuiltInKey}` | (string & {});

const BUILT_IN = "builtin:";

/** The built-in a start value names, if it names one. */
export function builtInOf(value: TemplateStartValue): BuiltInKey | null {
  if (!value.startsWith(BUILT_IN)) return null;
  const key = value.slice(BUILT_IN.length) as BuiltInKey;
  return BUILT_IN_KEYS.includes(key) ? key : null;
}

interface TemplateStartProps {
  templates: readonly RequestTemplate[];
  value: TemplateStartValue;
  onPick: (value: TemplateStartValue) => void;
  disabled?: boolean;
}

/**
 * Where a new request starts: empty, a template kept in this browser, or one that comes with
 * SkySend. Picking one fills in the form, which stays open to every change.
 */
export function TemplateStart({ templates, value, onPick, disabled }: TemplateStartProps) {
  const { t } = useTranslation();
  const id = useId();
  const translate = (key: string) => t(key);
  const builtIn = builtInOf(value);
  // The one used last comes first.
  const recent = [...templates].sort((a, b) =>
    (b.usedAt ?? b.createdAt).localeCompare(a.usedAt ?? a.createdAt),
  );

  return (
    <section className="space-y-2.5" aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-[13px] font-medium">
          {t("templates.startWith")}
        </h3>
        <Link
          to="/settings?tab=templates"
          className="text-xs text-primary-text underline-offset-4 hover:underline"
        >
          {t("templates.manage")}
        </Link>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <ToggleGroup
          type="single"
          value={builtIn ? "" : value}
          onValueChange={(v) => v && onPick(v)}
          aria-labelledby={id}
          disabled={disabled}
        >
          <ToggleGroupItem value="blank">{t("templates.blank")}</ToggleGroupItem>
          {recent.map((template) => (
            <ToggleGroupItem key={template.id} value={template.id} className="max-w-56">
              <span className="truncate">{template.name}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 rounded-full px-3 text-[13px] shadow-none [&_svg]:size-3.5",
                builtIn && "border-primary-line bg-primary-soft text-primary-text",
              )}
            >
              <Sparkles />
              {builtIn ? builtInTemplate(builtIn, translate).name : t("templates.builtIn.title")}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={builtIn ?? ""}
              onValueChange={(key) => onPick(`${BUILT_IN}${key as BuiltInKey}`)}
            >
              {BUILT_IN_KEYS.map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {builtInTemplate(key, translate).name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("templates.startHint")}</p>
    </section>
  );
}
