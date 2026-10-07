import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

/** The look of a setting shown as a pill. A long label in another language wraps. */
const pillClass =
  "h-auto min-h-9 whitespace-normal py-1.5 text-left text-[13px] font-normal data-[state=open]:border-primary-line data-[state=open]:text-primary-text data-[state=open]:[&_svg]:text-primary-text";

interface OptionPillProps {
  icon: LucideIcon;
  /** What the pill reads, with the value in bold. */
  label: ReactNode;
  /** The question the options answer. */
  title: string;
  hint?: string;
  options: readonly number[];
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  columns: 3 | 4;
  disabled?: boolean;
}

/**
 * A setting that shows its value and opens its options on a click: in a popover at the pill,
 * or on a phone in a sheet from the bottom. Picking one closes it again.
 */
export function OptionPill({
  icon: Icon,
  label,
  title,
  hint,
  options,
  value,
  onChange,
  format,
  columns,
  disabled,
}: OptionPillProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 640px)");

  const trigger = (
    <Button type="button" variant="outline" size="sm" className={pillClass} disabled={disabled}>
      <Icon className="text-muted-foreground" />
      <span>{label}</span>
    </Button>
  );
  const chips = (
    <ToggleGroup
      type="single"
      value={String(value)}
      // Radix switches the picked chip off on a second click, which only closes here.
      onValueChange={(picked) => {
        if (picked) onChange(Number(picked));
        setOpen(false);
      }}
      aria-label={title}
      className={cn("grid gap-1.5 p-0.5", columns === 3 ? "grid-cols-3" : "grid-cols-4")}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option}
          value={String(option)}
          className={cn("px-2", !wide && "h-11 text-[15px]")}
        >
          {format(option)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  if (wide) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent aria-labelledby={`${id}-title`} className="space-y-3">
          <p id={`${id}-title`} className="text-[13px] font-semibold">
            {title}
          </p>
          <ScrollArea viewportClassName="max-h-72">{chips}</ScrollArea>
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      {/* Without a hint there is no description, so the sheet points at none. */}
      <SheetContent {...(hint ? {} : { "aria-describedby": undefined })}>
        <div className="space-y-1">
          <DialogTitle className="text-[17px] leading-snug">{title}</DialogTitle>
          {hint && <DialogDescription className="text-[13px]">{hint}</DialogDescription>}
        </div>
        <ScrollArea className="min-h-0 flex-1">{chips}</ScrollArea>
        <SheetClose asChild>
          <Button type="button" variant="outline" size="lg">
            {t("common.done")}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

interface SwitchPillProps {
  icon: LucideIcon;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * A setting that is on or off, as a pill with a switch, so it reads like the pills beside
 * it. The whole pill is the label of the switch.
 */
export function SwitchPill({
  icon: Icon,
  label,
  checked,
  onCheckedChange,
  disabled,
}: SwitchPillProps) {
  return (
    // The slot and the variant give it the look a theme gives an outline button.
    <Label
      data-slot="button"
      data-variant="outline"
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        pillClass,
        checked && "border-primary-line text-primary-text",
        disabled && "cursor-default",
      )}
    >
      <Icon className={checked ? undefined : "text-muted-foreground"} />
      {label}
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </Label>
  );
}
