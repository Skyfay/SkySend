import { Eyebrow, Glow } from "@/components/site/fx";
import {
  AccountsCard,
  BlocksCard,
  ExpiryCard,
  PasswordCard,
  RequestsCard,
  StorageCard,
  ThemesCard,
} from "@/components/site/home/feature-cards";
import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";

export function Features({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <section id="features" className="relative px-4 pt-28 sm:px-6 sm:pt-[150px]">
      <div
        aria-hidden="true"
        className="absolute top-0 left-1/2 h-px w-[min(1100px,100%)] -translate-x-1/2"
        style={{ background: "linear-gradient(90deg, transparent, rgb(70 200 157 / 0.5), rgb(34 211 238 / 0.5), transparent)" }}
      />
      <Glow color="#17a37a" opacity={0.1} blur={100} className="top-10 left-1/2 h-[300px] w-[min(900px,100%)] -translate-x-1/2" />

      <div className="relative mx-auto flex max-w-[1200px] flex-col gap-10">
        <div className="flex flex-col items-center gap-3.5 text-center">
          <Eyebrow>{t("features.eyebrow")}</Eyebrow>
          <h2 className="max-w-[820px] text-[34px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[48px]">
            {t.rich("features.title", { shine: (c) => <span className="fx-shine">{c}</span> })}
          </h2>
          <p className="hidden text-faint [@media(pointer:fine)]:block">{t("features.hint")}</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-[repeat(4,minmax(300px,auto))]">
          <BlocksCard className="md:col-span-2 lg:row-span-2" />
          <RequestsCard className="md:col-span-2 lg:col-span-1 lg:row-span-2" />
          <ExpiryCard className="md:col-span-2" />
          <PasswordCard />
          <StorageCard />
          <AccountsCard />
          <ThemesCard />
        </div>
      </div>
    </section>
  );
}
