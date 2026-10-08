"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { DISCORD_URL, FAQS } from "@/lib/content";
import { cn } from "@/lib/utils";

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="mx-auto grid max-w-[1248px] gap-10 px-4 pt-28 sm:px-6 sm:pt-[140px] lg:grid-cols-[4fr_7fr] lg:gap-16">
      <div>
        <h2 className="text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">Questions</h2>
        <p className="mt-2.5 text-muted-foreground">
          Something missing? Ask on{" "}
          <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            Discord
          </a>
          .
        </p>
      </div>
      <div className="panel rounded-[18px] px-4 sm:px-[22px]">
        {FAQS.map((faq, i) => {
          const isOpen = open === i;
          return (
            <div key={faq.question} className="border-b border-border last:border-b-0">
              <h3>
                <button
                  type="button"
                  id={`faq-q-${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left text-[15px] font-medium"
                >
                  {faq.question}
                  <ChevronDown
                    className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")}
                  />
                </button>
              </h3>
              <div
                id={`faq-a-${i}`}
                role="region"
                aria-labelledby={`faq-q-${i}`}
                className={cn("grid transition-[grid-template-rows] duration-200", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
              >
                <div className="overflow-hidden" inert={!isOpen}>
                  <p className="pr-8 pb-[18px] leading-[1.65] text-muted-foreground">{faq.answer}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
