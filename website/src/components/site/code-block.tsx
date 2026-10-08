"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CodeBlock({ className, children, ...props }: React.ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(preRef.current?.textContent ?? "");
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative mb-[22px]">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-md border border-input bg-surface-2 px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre
        ref={preRef}
        className={cn(
          "code-highlight overflow-x-auto rounded-2xl border border-border bg-surface px-5 py-4 font-mono text-[13px] leading-[1.75]",
          className
        )}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}
