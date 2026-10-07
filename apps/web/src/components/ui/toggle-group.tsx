import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

type ToggleGroupVariant = "chips" | "segmented" | "cards";

const VariantContext = React.createContext<ToggleGroupVariant>("chips");

/**
 * Chips for a short list of options, like the expiry times, so a choice takes one click
 * instead of two. The segmented variant is a compact switch between two or three modes,
 * like plain text and Markdown. The cards variant is for two or three choices with a line of
 * explanation each, like the cards tabs, when the choice opens no panel of its own.
 */
const ToggleGroup = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & { variant?: ToggleGroupVariant }
>(({ className, variant = "chips", ...props }, ref) => (
  <VariantContext.Provider value={variant}>
    <ToggleGroupPrimitive.Root
      ref={ref}
      className={cn(
        variant === "chips" && "flex flex-wrap gap-1.5",
        variant === "segmented" && "inline-flex gap-0.5 rounded-xl bg-muted p-0.5",
        variant === "cards" && "flex w-full gap-0.5 rounded-[18px] bg-well p-1",
        className,
      )}
      {...props}
    />
  </VariantContext.Provider>
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(VariantContext);
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        "cursor-pointer transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variant !== "cards" &&
          "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium",
        variant === "chips" &&
          "h-8 rounded-full border border-border bg-transparent px-3 text-[13px] text-foreground hover:border-input data-[state=on]:border-primary-line data-[state=on]:bg-primary-soft data-[state=on]:text-primary-text [&_svg]:size-3.5",
        variant === "segmented" &&
          "h-7 rounded-[10px] px-2.5 text-xs text-muted-foreground hover:text-foreground data-[state=on]:bg-primary-soft data-[state=on]:text-primary-text data-[state=on]:shadow-[inset_0_0_0_1px_var(--color-primary-line)] [&_svg]:size-3.5",
        variant === "cards" &&
          "flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-[14px] px-3.5 py-2.5 text-left text-muted-foreground hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-chip data-[state=on]:ring-1 data-[state=on]:ring-inset data-[state=on]:ring-primary-line [&_svg]:size-4 [&_svg]:shrink-0 data-[state=on]:[&_svg]:text-primary-text",
        className,
      )}
      {...props}
    />
  );
});
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };
