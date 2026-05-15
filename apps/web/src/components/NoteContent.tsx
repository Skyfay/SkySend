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
      <div className="space-y-3">
        {entries.map((entry, index) => (
          <div key={index} className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              {entry.label || t("password.passwordNumber", { number: index + 1 })}
            </span>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-lg border bg-muted/50 px-4 py-2.5 font-mono text-sm break-all">
                {revealedPasswords.has(index)
                  ? entry.value
                  : "•".repeat(Math.min(entry.value.length, 40))}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => togglePasswordReveal(index)}
                title={revealedPasswords.has(index) ? t("noteView.hide") : t("noteView.reveal")}
              >
                {revealedPasswords.has(index) ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => copyPassword(entry.value, index)}
                title={copiedPasswords.has(index) ? t("common.copied") : t("common.copy")}
              >
                {copiedPasswords.has(index) ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
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
              <span className="text-sm font-medium">{t("sshKey.publicKey")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => copyText(publicKey, setCopiedPublic)}
              >
                {copiedPublic ? (
                  <Check className="mr-1 h-3 w-3" />
                ) : (
                  <Copy className="mr-1 h-3 w-3" />
                )}
                {copiedPublic ? t("common.copied") : t("common.copy")}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs break-all whitespace-pre-wrap scrollbar-thin">
              {publicKey}
            </pre>
          </div>
        )}

        {/* Private Key */}
        {privateKey && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("sshKey.privateKey")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => copyText(privateKey, setCopiedPrivate)}
              >
                {copiedPrivate ? (
                  <Check className="mr-1 h-3 w-3" />
                ) : (
                  <Copy className="mr-1 h-3 w-3" />
                )}
                {copiedPrivate ? t("common.copied") : t("common.copy")}
              </Button>
            </div>
            <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs scrollbar-thin">
              {privateKey}
            </pre>
          </div>
        )}

        {/* Passphrase */}
        {passphrase && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("sshKey.passphrase")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => copyText(passphrase, setCopiedPassphrase)}
              >
                {copiedPassphrase ? (
                  <Check className="mr-1 h-3 w-3" />
                ) : (
                  <Copy className="mr-1 h-3 w-3" />
                )}
                {copiedPassphrase ? t("common.copied") : t("common.copy")}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs break-all whitespace-pre-wrap scrollbar-thin">
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
            <div key={index} className="overflow-hidden rounded-lg border border-border">
              {/* Block header */}
              <div
                className="flex cursor-pointer items-center justify-between gap-2 bg-muted/40 px-3 py-2 hover:bg-muted/60 transition-colors"
                onClick={() => toggleBlock(index)}
                role="button"
                aria-expanded={!isCollapsed}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono text-sm font-medium">{displayTitle}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {block.language === "auto"
                      ? t("code.detectedAs", { lang: langLabel })
                      : langLabel}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => { e.stopPropagation(); void copyBlock(block.code, index); }}
                    title={copiedBlocks.has(index) ? t("common.copied") : t("common.copy")}
                  >
                    {copiedBlocks.has(index) ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Block body */}
              {!isCollapsed && (
                <div className="bg-[#f6f8fa] dark:bg-[#222] text-[#24292e] dark:text-[#aaa]">
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
        <div className="rounded-lg border bg-muted/50 p-4 prose prose-sm dark:prose-invert max-w-none overflow-auto">
          {/* C-2: rehype-sanitize prevents XSS from future react-markdown upstream changes
              that could enable allowDangerousHtml. Explicit sanitization is best practice. */}
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]} components={markdownComponents}>{content}</ReactMarkdown>
        </div>
        <Button variant="outline" size="sm" onClick={copyToClipboard}>
          {copied ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Copy className="mr-1.5 h-4 w-4" />
          )}
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
    );
  }

  // Default: text
  return (
    <div className="space-y-3">
      <div className="whitespace-pre-wrap rounded-lg border bg-muted/50 p-4 text-sm wrap-break-word">
        {content}
      </div>
      <Button variant="outline" size="sm" onClick={copyToClipboard}>
        {copied ? (
          <Check className="mr-1.5 h-4 w-4" />
        ) : (
          <Copy className="mr-1.5 h-4 w-4" />
        )}
        {copied ? t("common.copied") : t("common.copy")}
      </Button>
    </div>
  );
}
