import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTranslation } from "react-i18next";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useColorScheme } from "@/hooks/useColorScheme";

// Below the sticky header, which sits 16px from the top (12px on a phone) and is 56px high.
const OFFSET = { top: 84 };
const MOBILE_OFFSET = { top: 80, left: 16, right: 16 };

/**
 * Sonner keeps positioning, stacking, swiping and timing. Its own look is switched off with
 * `unstyled`, so the toasts get the surface, border, corners and shadow of the cards, and
 * an icon tile tinted by the toast's type like the note block tiles.
 */
export function Toaster(props: ToasterProps) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();

  return (
    <Sonner
      theme={colorScheme}
      className="toaster group"
      position="top-center"
      offset={OFFSET}
      mobileOffset={MOBILE_OFFSET}
      style={{ "--width": "380px" } as CSSProperties}
      closeButton
      icons={{
        error: <AlertCircle />,
        warning: <AlertTriangle />,
        success: <CheckCircle2 />,
        info: <Info />,
        close: <X />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: t("common.close"),
        classNames: {
          toast:
            "flex w-(--width) items-start gap-3 rounded-[18px] border border-border bg-popover p-3 pr-12 font-sans text-popover-foreground shadow-lift",
          icon: "flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[17px]",
          content: "flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5",
          title: "text-sm leading-5 font-semibold tracking-[-0.01em]",
          description: "text-[13px] leading-normal text-muted-foreground",
          actionButton:
            "inline-flex h-8 shrink-0 cursor-pointer items-center self-center rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground shadow-chip transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          closeButton:
            "absolute top-2.5 right-2.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-[15px]",
          error: "[&_[data-icon]]:bg-destructive-soft [&_[data-icon]]:text-destructive-text",
          warning: "[&_[data-icon]]:bg-warning-soft [&_[data-icon]]:text-warning",
          success: "[&_[data-icon]]:bg-success-soft [&_[data-icon]]:text-success",
          info: "[&_[data-icon]]:bg-primary-soft [&_[data-icon]]:text-primary-text",
        },
      }}
      {...props}
    />
  );
}
