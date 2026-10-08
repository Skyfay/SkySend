import { isValidElement, type ReactNode } from "react";
import { Info } from "lucide-react";
import { CodeBlock } from "@/components/site/code-block";
import type { Translator } from "@/i18n/translate";
import { slugify } from "@/lib/blog";

// Components the blog posts can use in their MDX. Props are plain strings,
// since next-mdx-remote leaves out JavaScript expressions in MDX.

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function H2({ children }: { children?: ReactNode }) {
  return <h2 id={slugify(textOf(children))}>{children}</h2>;
}

/** A side by side table, the right column being SkySend. */
function Compare({ label, left, right, children }: { label: string; left: string; right: string; children?: ReactNode }) {
  return (
    <div className="not-prose my-8 overflow-x-auto rounded-[18px] border border-border bg-card">
      <div className="min-w-[520px]">
        <div className="grid grid-cols-[minmax(140px,200px)_1fr_1fr] border-b border-border text-[13px] font-semibold">
          <span className="px-4 py-3.5 font-medium text-faint">{label}</span>
          <span className="flex items-center gap-2 px-4 py-3.5">
            <span className="size-2 rounded-full bg-muted-foreground" />
            {left}
          </span>
          <span className="flex items-center gap-2 bg-tone-green/6 px-4 py-3.5">
            <span className="size-2 rounded-full bg-tone-green shadow-[0_0_8px_var(--tone-green)]" />
            {right}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, left, right }: { label: string; left: string; right: string }) {
  return (
    <div className="grid grid-cols-[minmax(140px,200px)_1fr_1fr] border-b border-border text-sm last:border-b-0">
      <span className="px-4 py-3 text-muted-foreground">{label}</span>
      <span className="px-4 py-3 text-subtle">{left}</span>
      <span className="bg-tone-green/6 px-4 py-3">{right}</span>
    </div>
  );
}

function Callout({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="not-prose relative my-8 flex gap-3.5 overflow-hidden rounded-[14px] border border-tone-green/25 bg-tone-green/6 py-4 pr-[18px] pl-[22px]">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-tone-green shadow-[0_0_12px_var(--tone-green)]" />
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-tone-green/14 text-tone-green">
        <Info className="size-4" />
      </span>
      <div className="text-[15px] leading-relaxed text-subtle">
        {title && <strong className="font-semibold text-foreground">{title} </strong>}
        {children}
      </div>
    </div>
  );
}

/** The components for a post, with their own labels in the language of the page. */
export function mdxComponents(t: Translator) {
  return {
    h2: H2,
    pre: CodeBlock,
    Compare: (props: { left: string; right: string; children?: ReactNode }) => (
      <Compare label={t("blog.compared")} {...props} />
    ),
    Row,
    Callout,
  };
}
