import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Code,
  Copy,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { CodeBlock, PasswordBlock, ReadBlock, SshKeyBlock, TextBlock } from "@skysend/note-format";
import "highlight.js/styles/github.min.css";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyText } from "@/lib/clipboard";
import { languageLabel } from "@/lib/code-languages";
import { highlightAs, highlightCode } from "@/lib/highlight";
import { markdownComponents as taskListComponents } from "@/lib/markdownComponents";
import { cn } from "@/lib/utils";

// Every block comes from a decrypted note, which anyone with a link can craft. Text is only
// ever rendered as text, Markdown through rehype-sanitize, code through the sanitized
// highlighter. Nothing here hands note content to the DOM unescaped.

// The default schema plus the checkbox inputs react-markdown sets for GFM task lists.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [["type", "checkbox"], "checked", "disabled"],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), "input"],
};

const markdownComponents: Components = {
  ...taskListComponents,
  code({ className, children }) {
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    const html = language ? highlightAs(String(children).replace(/\n$/, ""), language) : null;
    if (html === null) return <code className={className}>{children}</code>;
    return <code className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  },
};

/** Remembers for two seconds which value was copied last, for the check mark. */
function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    await copyText(text);
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
  };
  return { copied, copy };
}

function IconAction({ label, onClick, children, expanded }: { label: string; onClick: () => void; children: ReactNode; expanded?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClick} aria-label={label} aria-expanded={expanded}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CopyAction({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <IconAction label={copied ? t("common.copied") : t("common.copy")} onClick={onClick}>
      {copied ? <Check className="text-primary-text" /> : <Copy />}
    </IconAction>
  );
}

function BlockFrame({ icon: Icon, title, actions, children }: { icon: LucideIcon; title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-well">
      <header className="flex items-center gap-2.5 border-b border-border py-1.5 pl-3 pr-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Markdown as the recipient sees it. The text editor uses it for its preview too. */
export function MarkdownView({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("prose prose-sm max-w-none overflow-auto scrollbar-thin dark:prose-invert", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function TextBlockView({ block }: { block: TextBlock }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  return (
    <BlockFrame
      icon={FileText}
      title={block.format === "markdown" ? t("tab.markdown") : t("tab.text")}
      actions={<CopyAction copied={copied === "text"} onClick={() => void copy("text", block.text)} />}
    >
      {block.format === "markdown" ? (
        <MarkdownView text={block.text} className="p-4" />
      ) : (
        <p className="whitespace-pre-wrap wrap-break-word p-4 text-[15px] leading-relaxed">{block.text}</p>
      )}
    </BlockFrame>
  );
}

function PasswordBlockView({ block }: { block: PasswordBlock }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  const toggle = (index: number) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <BlockFrame icon={KeyRound} title={t("tab.password")}>
      <div className="space-y-3 p-3">
        {block.entries.map((entry, index) => {
          const shown = revealed.has(index);
          return (
            <div key={index}>
              <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
                {entry.label || t("password.passwordNumber", { number: index + 1 })}
              </p>
              <div className="flex items-center gap-1.5">
                <div className="min-h-10 min-w-0 flex-1 break-all rounded-xl border border-border bg-card px-4 py-2 font-mono text-sm leading-6">
                  {shown ? entry.value : "•".repeat(Math.min(entry.value.length, 40))}
                </div>
                <IconAction label={shown ? t("noteView.hide") : t("noteView.reveal")} onClick={() => toggle(index)}>
                  {shown ? <EyeOff /> : <Eye />}
                </IconAction>
                <CopyAction copied={copied === `entry-${index}`} onClick={() => void copy(`entry-${index}`, entry.value)} />
              </div>
            </div>
          );
        })}
      </div>
    </BlockFrame>
  );
}

function CodeBlockView({ block, number }: { block: CodeBlock; number: number }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  const [open, setOpen] = useState(true);
  const highlighted = useMemo(() => highlightCode(block.code, block.language), [block.code, block.language]);
  const label = languageLabel(highlighted.language);
  const lines = highlighted.html.split("\n");
  const numberWidth = String(lines.length).length;

  return (
    <BlockFrame
      icon={Code}
      title={block.title ? <span className="font-mono font-medium">{block.title}</span> : t("code.noTitle", { number })}
      actions={
        <>
          <span className="shrink-0 rounded-md bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
            {block.language === "auto" ? t("code.detectedAs", { lang: label }) : label}
          </span>
          <IconAction label={open ? t("noteView.hideCode") : t("noteView.showCode")} onClick={() => setOpen(!open)} expanded={open}>
            <ChevronDown className={cn("transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
          </IconAction>
          <CopyAction copied={copied === "code"} onClick={() => void copy("code", block.code)} />
        </>
      }
    >
      {open && (
        <div className="overflow-x-auto bg-[#f6f8fa] text-[#24292e] scrollbar-thin dark:bg-[#1c1c20] dark:text-[#aaa]">
          <table className="w-full border-collapse font-mono text-sm">
            <tbody>
              {lines.map((line, index) => (
                <tr key={index} className="hover:bg-black/5 dark:hover:bg-white/5">
                  <td
                    className="select-none border-r border-black/10 px-3 py-0.5 text-right text-muted-foreground/50 dark:border-white/10"
                    style={{ minWidth: `${numberWidth + 2}ch` }}
                  >
                    {index + 1}
                  </td>
                  {/* Sanitized by highlightCode: only span elements with a class are left. */}
                  <td className="px-4 py-0.5">
                    <span dangerouslySetInnerHTML={{ __html: line || " " }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BlockFrame>
  );
}

function SshKeyBlockView({ block }: { block: SshKeyBlock }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  const parts = [
    { key: "public", label: t("sshKey.publicKey"), value: block.publicKey, wrap: true },
    { key: "private", label: t("sshKey.privateKey"), value: block.privateKey, wrap: false },
    { key: "passphrase", label: t("sshKey.passphrase"), value: block.passphrase, wrap: true },
  ].filter((part) => part.value.length > 0);

  return (
    <BlockFrame icon={Terminal} title={t("tab.sshkey")}>
      <div className="space-y-3 p-3">
        {parts.map((part) => (
          <div key={part.key} className="space-y-1.5">
            <div className="flex items-center justify-between pl-1">
              <span className="text-xs font-medium text-muted-foreground">{part.label}</span>
              <CopyAction copied={copied === part.key} onClick={() => void copy(part.key, part.value)} />
            </div>
            <pre
              className={cn(
                "scrollbar-thin overflow-auto rounded-xl border border-border bg-card p-3 font-mono text-xs",
                part.wrap ? "whitespace-pre-wrap break-all" : "max-h-40",
              )}
            >
              {part.value}
            </pre>
          </div>
        ))}
      </div>
    </BlockFrame>
  );
}

/** A note's blocks, in the order the sender put them. */
export function NoteBlocks({ blocks }: { blocks: readonly ReadBlock[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "text":
            return <TextBlockView key={index} block={block} />;
          case "password":
            // A legacy note could hold an empty list, which v2 showed as nothing at all.
            return block.entries.length > 0 ? <PasswordBlockView key={index} block={block} /> : null;
          case "code": {
            // Untitled code blocks are numbered among the code blocks only.
            const number = blocks.slice(0, index + 1).filter((b) => b.type === "code").length;
            return <CodeBlockView key={index} block={block} number={number} />;
          }
          case "sshkey":
            return <SshKeyBlockView key={index} block={block} />;
          case "unsupported":
            return (
              <div key={index} className="flex items-start gap-2.5 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {t("noteView.unsupported")}
              </div>
            );
        }
      })}
    </div>
  );
}
