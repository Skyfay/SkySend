"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { DotGrid, Glow, SpinBorder, CONIC } from "@/components/site/fx";
import { CRYPTO_URL, HOW_IT_WORKS_URL } from "@/lib/content";
import { cn } from "@/lib/utils";

type PartId = "host" | "id" | "secret";

const PARTS: { id: PartId; text: string; title: string; about: string; sent: boolean; color: string }[] = [
  {
    id: "host",
    text: "https://ch.skysend.app",
    title: "The instance",
    about: "Where the share lives. Your browser asks this server for the encrypted blob, like it asks any website for a page.",
    sent: true,
    color: "var(--subtle)",
  },
  {
    id: "id",
    text: "/file/aB3kQ9xZ",
    title: "The share ID",
    about: "Tells the server which blob to hand out. It is random and opens nothing on its own.",
    sent: true,
    color: "var(--tone-blue-soft)",
  },
  {
    id: "secret",
    text: "#Zk3vT0qL8mWc2HxR9bN4yJ6sPa1eFgUd7tKiVo5nC3w",
    title: "The secret",
    about: "32 random bytes made in your browser. Everything after the # stays on the device, so the server never sees it, not even in its logs.",
    sent: false,
    color: "var(--tone-green)",
  },
];

const KEYS = [
  { name: "fileKey", text: "Encrypts the file in 64 KB records", sent: false },
  { name: "metaKey", text: "Encrypts names, sizes and types", sent: false },
  { name: "authToken", text: "Proves to the server that you hold the link", sent: true },
  { name: "ownerToken", text: "Lets the uploader delete the share", sent: true },
];

function Where({ sent, children }: { sent: boolean; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] w-fit items-center rounded-full px-2 text-xs font-medium",
        sent ? "bg-accent text-subtle" : "bg-tone-green/16 text-tone-green"
      )}
    >
      {children}
    </span>
  );
}

/**
 * The share link taken apart. Each part says whether it reaches the server,
 * and the secret shows the keys and tokens HKDF derives from it.
 */
function LinkAnatomy() {
  const [part, setPart] = useState<PartId>("secret");
  const current = PARTS.find((p) => p.id === part) ?? PARTS[2];
  const secretOn = part === "secret";

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div role="group" aria-label="Parts of a share link" className="rounded-[14px] border border-border bg-surface px-4 py-3.5 font-mono text-sm leading-[1.75] break-all sm:px-[18px] sm:py-4 sm:text-[15px]">
        {PARTS.map((p) => {
          const on = p.id === part;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => setPart(p.id)}
              className="inline rounded px-0.5 py-px text-left break-all transition-colors"
              style={{
                color: p.color,
                background: on ? `color-mix(in srgb, ${p.color} 16%, transparent)` : "transparent",
                boxShadow: on ? `inset 0 -2px 0 ${p.color}` : "none",
              }}
            >
              {p.text}
            </button>
          );
        })}
      </div>

      <div aria-live="polite">
        <div key={current.id} className="fx-in panel flex flex-col gap-1.5 rounded-[14px] px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-semibold">{current.title}</span>
            <Where sent={current.sent}>{current.sent ? "Sent to the server" : "Never sent"}</Where>
            <span className="ml-auto hidden text-xs text-faint sm:inline">Click a part of the link</span>
          </div>
          <p className="leading-[1.55] text-muted-foreground">{current.about}</p>
        </div>
      </div>

      <div className={cn("flex flex-col transition-opacity duration-300", secretOn ? "opacity-100" : "opacity-45")}>
        <div className="flex justify-center">
          <span className="inline-flex h-[30px] items-center gap-2 rounded-full border border-tone-green/50 bg-tone-green/12 px-3 text-[13px] font-medium text-tone-green">
            <KeyRound className="size-[13px]" />
            Secret, 32 bytes
          </span>
        </div>
        <div aria-hidden="true" className="relative hidden h-[34px] sm:block">
          <span className={cn("absolute top-0 left-1/2 h-3.5 w-px", secretOn ? "bg-tone-green/60" : "bg-input")} />
          <span className={cn("absolute inset-x-[12.5%] top-3.5 h-px", secretOn ? "bg-tone-green/60" : "bg-input")} />
          {["12.5%", "37.5%", "62.5%", "87.5%"].map((left) => (
            <span
              key={left}
              className={cn("absolute top-3.5 h-5 w-px", secretOn ? "bg-tone-green/60" : "bg-input")}
              style={{ left }}
            />
          ))}
          <span className="absolute top-1 left-1/2 ml-2 text-[11px] text-faint">HKDF-SHA256</span>
        </div>
        <span className="py-2 text-center text-[11px] text-faint sm:hidden">HKDF-SHA256</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KEYS.map((k) => (
            <div key={k.name} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-2.5">
              <span className="font-mono text-[12.5px] font-medium">{k.name}</span>
              <span className="text-xs leading-[1.45] text-muted-foreground">{k.text}</span>
              <Where sent={k.sent}>{k.sent ? "Sent, derived" : "Stays here"}</Where>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KeyBand() {
  return (
    <section className="mx-auto mt-28 max-w-[1248px] px-4 sm:mt-[140px] sm:px-6">
      <SpinBorder conic={CONIC.green} radius={30} innerClassName="dark overflow-hidden bg-[#0c0d0e] text-foreground">
        <DotGrid mask="radial-gradient(ellipse 60% 70% at 75% 50%, #000, transparent 70%)" />
        <Glow color="#17a37a" opacity={0.18} blur={100} drift={2} className="-bottom-40 -left-24 size-[440px]" />
        <div className="relative grid items-center gap-10 p-6 sm:gap-14 sm:p-16 lg:grid-cols-[5fr_6fr]">
          <div className="flex flex-col gap-[18px]">
            <span className="w-fit rounded-full border border-input px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              Zero knowledge
            </span>
            <h2 className="text-[32px] leading-[1.06] font-semibold tracking-[-0.04em] sm:text-[46px]">
              The key is in the link. <span className="fx-shine">The server never gets it.</span>
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              Browsers never send the part of a link after the #. SkySend puts a random secret there and
              derives every key from it in your browser, with HKDF-SHA256.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={CRYPTO_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-primary flex h-[42px] items-center rounded-[9px] px-[18px] font-medium"
              >
                Read the crypto design
              </a>
              <a
                href={HOW_IT_WORKS_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-chip flex h-[42px] items-center rounded-[9px] px-[18px] font-medium"
              >
                Try it on How it works
              </a>
            </div>
          </div>
          <LinkAnatomy />
        </div>
      </SpinBorder>
    </section>
  );
}
