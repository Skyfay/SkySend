import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, EyeOff, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import DOMPurify from "dompurify";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Extend the default sanitize schema to allow checkbox inputs for GFM task lists.
// type/checked/disabled are the only attributes react-markdown sets on these elements.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [["type", "checkbox"], "checked", "disabled"],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), "input"],
};
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NoteContentType } from "@skysend/crypto";
import hljs from "highlight.js/lib/core";
import "highlight.js/styles/github.min.css";

// Register languages
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import lua from "highlight.js/lib/languages/lua";
import perl from "highlight.js/lib/languages/perl";
import r from "highlight.js/lib/languages/r";
import java from "highlight.js/lib/languages/java";
import csharp from "highlight.js/lib/languages/csharp";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import scala from "highlight.js/lib/languages/scala";
import dart from "highlight.js/lib/languages/dart";
import haskell from "highlight.js/lib/languages/haskell";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import fsharp from "highlight.js/lib/languages/fsharp";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import powershell from "highlight.js/lib/languages/powershell";
import sql from "highlight.js/lib/languages/sql";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import ini from "highlight.js/lib/languages/ini";
import protobuf from "highlight.js/lib/languages/protobuf";
import graphql from "highlight.js/lib/languages/graphql";
import diff from "highlight.js/lib/languages/diff";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import docker from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import nix from "highlight.js/lib/languages/nix";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import http from "highlight.js/lib/languages/http";
import vim from "highlight.js/lib/languages/vim";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("php", php);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("perl", perl);
hljs.registerLanguage("r", r);
hljs.registerLanguage("java", java);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("dart", dart);
hljs.registerLanguage("haskell", haskell);
hljs.registerLanguage("elixir", elixir);
hljs.registerLanguage("erlang", erlang);
hljs.registerLanguage("fsharp", fsharp);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("toml", ini); // toml is handled by the ini grammar
hljs.registerLanguage("protobuf", protobuf);
hljs.registerLanguage("graphql", graphql);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("dockerfile", docker);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("nix", nix);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("http", http);
hljs.registerLanguage("vim", vim);
hljs.registerLanguage("plaintext", plaintext);

import { CODE_LANGUAGES } from "@/components/CodeForm";

const LANGUAGE_LABEL: Record<string, string> = Object.fromEntries(
  CODE_LANGUAGES.map((l) => [l.value, l.label]),
);

interface ParsedCodeBlock {
  title: string;
  language: string;
  code: string;
  html: string;
  detectedLanguage: string;
}

function IconAction({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" className={cn("shrink-0", className)} onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CopyLabel({ copied }: { copied: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {copied ? <Check className="text-primary-text" /> : <Copy />}
      {copied ? t("common.copied") : t("common.copy")}
    </>
  );
}

interface NoteContentProps {
  content: string;
  contentType: NoteContentType;
}

export function NoteContent({ content, contentType }: NoteContentProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState(false);
  const [copiedPrivate, setCopiedPrivate] = useState(false);
  const [copiedPassphrase, setCopiedPassphrase] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState<Set<number>>(new Set());
  const [copiedPasswords, setCopiedPasswords] = useState<Set<number>>(new Set());
  const [copiedBlocks, setCopiedBlocks] = useState<Set<number>>(new Set());
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<number> | null>(null);

  const codeBlocks = useMemo<ParsedCodeBlock[]>(() => {
    if (contentType !== "code") return [];

    // Parse JSON format; fall back to legacy plain-text single block
    let rawBlocks: { title: string; language: string; code: string }[];
    try {
      const parsed = JSON.parse(content) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (b) =>
            typeof b === "object" &&
            b !== null &&
            "code" in b &&
            typeof (b as Record<string, unknown>).code === "string",
        )
      ) {
        rawBlocks = (parsed as { title?: unknown; language?: unknown; code: string }[]).map((b) => ({
          title: typeof b.title === "string" ? b.title : "",
          language: typeof b.language === "string" ? b.language : "auto",
          code: b.code,
        }));
      } else {
        throw new Error("not code JSON");
      }
    } catch {
      rawBlocks = [{ title: "", language: "auto", code: content }];
    }

    return rawBlocks.map((b) => {
      let html: string;
      let detectedLanguage: string;

      if (b.language === "auto") {
        // Defense-in-Depth (C-1): DOMPurify on top of hljs's own HTML escaping
        const result = hljs.highlightAuto(b.code);
        html = DOMPurify.sanitize(result.value, { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"] });
        detectedLanguage = result.language ?? "plaintext";
      } else {
        try {
          const raw = hljs.highlight(b.code, { language: b.language }).value;
          html = DOMPurify.sanitize(raw, { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"] });
        } catch {
          html = DOMPurify.sanitize(hljs.highlightAuto(b.code).value, {
            ALLOWED_TAGS: ["span"],
            ALLOWED_ATTR: ["class"],
          });
        }
        detectedLanguage = b.language;
      }

      return { ...b, html, detectedLanguage };
    });
  }, [content, contentType]);

  const markdownComponents = useMemo<Components>(() => ({
    code({ className, children }) {
      const match = /language-(\w+)/.exec(className ?? "");
      const code = String(children).replace(/\n$/, "");
      if (match?.[1]) {
        try {
          const raw = hljs.highlight(code, { language: match[1] }).value;
          const sanitized = DOMPurify.sanitize(raw, {
            ALLOWED_TAGS: ["span"],
            ALLOWED_ATTR: ["class"],
          });
          return <code className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
        } catch {
          // Fall through to default rendering
        }
      }
      return <code className={className}>{children}</code>;
    },
  }), []);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (contentType === "password") {
    // Support both new JSON format and legacy plaintext format
    let entries: { label: string; value: string }[];
    try {
      const parsed = JSON.parse(content) as unknown[];
      if (Array.isArray(parsed) && parsed.every((e) => typeof e === "object" && e !== null && "value" in e)) {
        entries = parsed.map((e) => {
          const obj = e as Record<string, unknown>;
          return {
            label: typeof obj.label === "string" ? obj.label : "",
            value: String(obj.value),
          };
        });
      } else {
        throw new Error("Not password JSON");
      }
    } catch {
      // Legacy format: passwords separated by \n\n
      entries = content.split("\n\n").filter((p) => p.length > 0).map((p) => ({ label: "", value: p }));
    }

    const togglePasswordReveal = (index: number) => {
      setRevealedPasswords((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    };

    const copyPassword = async (text: string, index: number) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopiedPasswords((prev) => new Set(prev).add(index));
      setTimeout(() => {
        setCopiedPasswords((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }, 2000);
    };

    return (
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div key={index} className="space-y-2 rounded-2xl bg-well p-3">
            <span className="block px-1 text-xs font-medium text-muted-foreground">
              {entry.label || t("password.passwordNumber", { number: index + 1 })}
            </span>
            <div className="flex items-center gap-2">
              <div className="min-h-10 flex-1 break-all rounded-xl border border-border bg-card px-4 py-2 font-mono text-sm leading-6">
                {revealedPasswords.has(index)
                  ? entry.value
                  : "•".repeat(Math.min(entry.value.length, 40))}
              </div>
              <IconAction
                label={revealedPasswords.has(index) ? t("noteView.hide") : t("noteView.reveal")}
                onClick={() => togglePasswordReveal(index)}
              >
                {revealedPasswords.has(index) ? <EyeOff /> : <Eye />}
              </IconAction>
              <IconAction
                label={copiedPasswords.has(index) ? t("common.copied") : t("common.copy")}
                onClick={() => copyPassword(entry.value, index)}
              >
                {copiedPasswords.has(index) ? <Check className="text-primary-text" /> : <Copy />}
              </IconAction>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (contentType === "sshkey") {
    // Parse passphrase line
    const passphraseMatch = content.match(/^Passphrase: (.+)$/m);
    const passphrase = passphraseMatch?.[1] ?? null;
    const contentWithoutPassphrase = passphrase
      ? content.replace(passphraseMatch![0], "").trim()
      : content;

    // Parse content into public key and private key sections
    const privateKeyMatch = contentWithoutPassphrase.match(/(-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----)/);
    const privateKey = privateKeyMatch?.[1]?.trim() ?? null;
    const publicKey = privateKey
      ? contentWithoutPassphrase.replace(privateKey, "").trim()
      : contentWithoutPassphrase.trim();

    const copyText = async (text: string, setter: (v: boolean) => void) => {
      try {
        await navigator.clipboard.writeText(text);
        setter(true);
        setTimeout(() => setter(false), 2000);
      } catch {
        // Fallback
      }
    };

    return (
      <div className="space-y-4">
        {/* Public Key */}
        {publicKey && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">{t("sshKey.publicKey")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => copyText(publicKey, setCopiedPublic)}
              >
                <CopyLabel copied={copiedPublic} />
              </Button>
            </div>
            <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-well p-3 font-mono text-xs">
              {publicKey}
            </pre>
          </div>
        )}

        {/* Private Key */}
        {privateKey && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">{t("sshKey.privateKey")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => copyText(privateKey, setCopiedPrivate)}
              >
                <CopyLabel copied={copiedPrivate} />
              </Button>
            </div>
            <pre className="scrollbar-thin max-h-40 overflow-auto rounded-xl border border-border bg-well p-3 font-mono text-xs">
              {privateKey}
            </pre>
          </div>
        )}

        {/* Passphrase */}
        {passphrase && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">{t("sshKey.passphrase")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => copyText(passphrase, setCopiedPassphrase)}
              >
                <CopyLabel copied={copiedPassphrase} />
              </Button>
            </div>
            <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-well p-3 font-mono text-xs">
              {passphrase}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (contentType === "code") {
    const multiBlock = codeBlocks.length > 1;

    // Default collapse state: single block = expanded (empty set), multiple = all collapsed
    const effectiveCollapsed: Set<number> =
      collapsedBlocks !== null
        ? collapsedBlocks
        : multiBlock
          ? new Set(codeBlocks.map((_, i) => i))
          : new Set();

    const isAllCollapsed = codeBlocks.every((_, i) => effectiveCollapsed.has(i));

    const toggleBlock = (index: number) => {
      setCollapsedBlocks((prev) => {
        const base = prev ?? (multiBlock ? new Set(codeBlocks.map((_, i) => i)) : new Set<number>());
        const next = new Set(base);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    };

    const toggleAll = () => {
      if (isAllCollapsed) {
        setCollapsedBlocks(new Set());
      } else {
        setCollapsedBlocks(new Set(codeBlocks.map((_, i) => i)));
      }
    };

    const copyBlock = async (code: string, index: number) => {
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopiedBlocks((prev) => new Set(prev).add(index));
      setTimeout(() => {
        setCopiedBlocks((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }, 2000);
    };

    return (
      <div className="space-y-2">
        {/* Expand/Collapse All - only shown for multiple blocks */}
        {multiBlock && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={toggleAll} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
              {isAllCollapsed ? (
                <>
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                  {t("code.expandAll")}
                </>
              ) : (
                <>
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                  {t("code.collapseAll")}
                </>
              )}
            </Button>
          </div>
        )}

        {codeBlocks.map((block, index) => {
          const isCollapsed = effectiveCollapsed.has(index);
          const langLabel = LANGUAGE_LABEL[block.detectedLanguage] ?? block.detectedLanguage;
          const displayTitle = block.title || t("code.noTitle", { number: index + 1 });
          const lines = block.code.split("\n");
          const lineNumberWidth = String(lines.length).length;

          return (
            <div key={index} className="overflow-hidden rounded-2xl border border-border">
              {/* Block header */}
              <div className="flex items-center gap-2 bg-well py-1.5 pl-1.5 pr-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-accent"
                  onClick={() => toggleBlock(index)}
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono text-[13px] font-medium">{displayTitle}</span>
                </button>
                <span className="shrink-0 rounded-md bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {block.language === "auto"
                    ? t("code.detectedAs", { lang: langLabel })
                    : langLabel}
                </span>
                <IconAction
                  label={copiedBlocks.has(index) ? t("common.copied") : t("common.copy")}
                  onClick={() => void copyBlock(block.code, index)}
                  className="h-7 w-7 border-0 bg-transparent shadow-none [&_svg]:size-3.5"
                >
                  {copiedBlocks.has(index) ? <Check className="text-primary-text" /> : <Copy />}
                </IconAction>
              </div>

              {/* Block body */}
              {!isCollapsed && (
                <div className="border-t border-border bg-[#f6f8fa] text-[#24292e] dark:bg-[#1c1c20] dark:text-[#aaa]">
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full border-collapse font-mono text-sm">
                      <tbody>
                        {block.html.split("\n").map((line, i) => (
                          <tr key={i} className="hover:bg-black/5 dark:hover:bg-white/5">
                            <td
                              className="select-none border-r border-black/10 dark:border-white/10 px-3 py-0.5 text-right text-muted-foreground/50"
                              style={{ minWidth: `${lineNumberWidth + 2}ch` }}
                            >
                              {i + 1}
                            </td>
                            <td className="px-4 py-0.5">
                              <span dangerouslySetInnerHTML={{ __html: line || "\u00a0" }} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (contentType === "markdown") {
    return (
      <div className="space-y-3">
        <div className="prose prose-sm max-w-none overflow-auto rounded-2xl bg-well p-5 dark:prose-invert">
          {/* C-2: rehype-sanitize prevents XSS from future react-markdown upstream changes
              that could enable allowDangerousHtml. Explicit sanitization is best practice. */}
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>{content}</ReactMarkdown>
        </div>
        <Button variant="outline" size="sm" onClick={copyToClipboard}>
          <CopyLabel copied={copied} />
        </Button>
      </div>
    );
  }

  // Default: text
  return (
    <div className="space-y-3">
      <div className="whitespace-pre-wrap wrap-break-word rounded-2xl bg-well p-5 text-[15px] leading-relaxed">
        {content}
      </div>
      <Button variant="outline" size="sm" onClick={copyToClipboard}>
        <CopyLabel copied={copied} />
      </Button>
    </div>
  );
}
