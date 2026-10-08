import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

type TabsVariant = "segmented" | "cards";

const VariantContext = React.createContext<TabsVariant>("segmented");

const Tabs = TabsPrimitive.Root;

/**
 * A segmented track: the open tab sits on a raised pill and its icon takes the accent. The
 * cards variant is for a few big choices with a line of explanation each, like Datei and Notiz.
 */
const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = "segmented", ...props }, ref) => (
  <VariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        variant === "segmented"
          ? "flex w-full gap-0.5 rounded-2xl bg-muted p-1"
          : "flex w-full gap-0.5 rounded-[18px] bg-well p-1",
        className,
      )}
      {...props}
    />
  </VariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(VariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex-1 cursor-pointer text-muted-foreground transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-chip data-[state=active]:[&_svg]:text-primary-text",
        variant === "segmented"
          ? "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium"
          : "flex min-w-0 flex-col items-start gap-0.5 rounded-[14px] px-3.5 py-2.5 text-left data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-primary-line",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
