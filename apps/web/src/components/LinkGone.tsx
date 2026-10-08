import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LinkGoneProps {
  icon: LucideIcon;
  title: string;
  text?: string;
}

/**
 * What a recipient sees when a link no longer leads anywhere: expired, used up, deleted
 * or mistyped. One calm panel with a way back to sharing.
 */
export function LinkGone({ icon: Icon, title, text }: LinkGoneProps) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-14 text-center sm:py-20">
      <span className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-border bg-card text-muted-foreground shadow-chip">
        <Icon className="h-7 w-7" />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{text ?? t("share.goneText")}</p>
      </div>
      <Button asChild>
        <Link to="/">
          {t("share.goneAction")}
          <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}
