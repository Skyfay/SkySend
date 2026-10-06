import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Glow } from "@/components/Glow";
import { cn } from "@/lib/utils";

/**
 * The column a recipient sees, with the accent glow behind the card. A note that is
 * being read gets the wide column, so code and tables have room.
 */
export function ReceiveShell({
  title,
  wide = false,
  children,
}: {
  title: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("relative mx-auto", wide ? "max-w-3xl" : "max-w-xl")}>
      <Glow />
      <div className="relative">
        <header className="mb-7 text-center">
          <h1
            data-slot="hero-title"
            className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px]"
          >
            {title}
          </h1>
          <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {t("share.receiveText")}
          </p>
        </header>
        <Card data-emphasis="main" className="p-4 sm:p-6">
          {children}
        </Card>
      </div>
    </div>
  );
}
