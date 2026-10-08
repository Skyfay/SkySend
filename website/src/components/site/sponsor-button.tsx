"use client";

import { Heart } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SPONSOR_URL } from "@/lib/content";
import { useI18n } from "@/i18n/provider";

/** A red heart in the header that leads to GitHub Sponsors. */
export function SponsorButton() {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={SPONSOR_URL}
          target="_blank"
          rel="noreferrer"
          aria-label={t("nav.sponsorLabel")}
          className="btn-chip group flex size-9 items-center justify-center rounded-lg"
        >
          <Heart className="size-4 text-tone-red transition-[fill] group-hover:fill-current" />
        </a>
      </TooltipTrigger>
      <TooltipContent>{t("nav.sponsorTooltip")}</TooltipContent>
    </Tooltip>
  );
}
