import { Heart } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SPONSOR_URL } from "@/lib/content";

/** A red heart in the header that leads to GitHub Sponsors. */
export function SponsorButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={SPONSOR_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Sponsor SkySend on GitHub"
          className="btn-chip group flex size-9 items-center justify-center rounded-lg"
        >
          <Heart className="size-4 text-tone-red transition-[fill] group-hover:fill-current" />
        </a>
      </TooltipTrigger>
      <TooltipContent>Sponsor SkySend</TooltipContent>
    </Tooltip>
  );
}
