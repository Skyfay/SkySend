import Image from "next/image";
import Link from "next/link";
import { CONIC, Floor, Glow, SpinBorder, Stars } from "@/components/site/fx";
import { DiscordIcon } from "@/components/site/discord-icon";
import { DISCORD_URL } from "@/lib/content";

// The last band of the home page. It stays dark in light mode too: the `dark`
// class on the band switches every token inside it.
export function CtaBand() {
  return (
    <section className="mx-auto mt-28 max-w-[1248px] px-4 sm:mt-[140px] sm:px-6">
      <SpinBorder conic={CONIC.cta} speed="normal" radius={30} innerClassName="dark overflow-hidden bg-[#0c0d0e] text-foreground">
        <Floor className="top-[120px] h-[400px]" tilt={600} mask="linear-gradient(transparent, #000 40%, transparent)" />
        <Glow color="#17a37a" opacity={0.3} blur={100} drift={1} className="top-10 left-1/2 -ml-[300px] h-[300px] w-[600px]" />
        <Stars count={16} height={480} seed={23} />
        <div className="relative flex flex-col items-center gap-5 px-5 py-14 text-center sm:px-[72px] sm:py-[88px]">
          <Image src="/logo.svg" alt="" width={64} height={64} className="size-[52px] drop-shadow-[0_10px_30px_rgb(70_200_157/0.5)] sm:size-16" />
          <h2 className="text-[32px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[52px] sm:leading-[1.05]">
            Stop pasting passwords
            <br className="hidden sm:block" /> into chat.
          </h2>
          <p className="text-base text-muted-foreground sm:text-[17px]">Free and open source under AGPL-3.0. Yours to run.</p>
          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
            <Link
              href="/#start"
              className="btn-primary flex h-12 items-center justify-center rounded-[10px] px-6 text-[15px] font-medium"
            >
              Get started
            </Link>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-chip flex h-12 items-center justify-center gap-2 rounded-[10px] px-6 text-[15px] font-medium"
            >
              <DiscordIcon className="size-4 text-[#a5b4fc]" />
              Join the Discord
            </a>
          </div>
        </div>
      </SpinBorder>
    </section>
  );
}
