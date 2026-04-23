import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import DOMPurify from "dompurify";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import type { NoteContentType } from "@skysend/crypto";
import hljs from "highlight.js/lib/core";
import "highlight.js/styles/github-dark.min.css";

// Register commonly used languages
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import csharp from "highlight.js/lib/languages/csharp";
import cpp from "highlight.js/lib/languages/cpp";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import docker from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("java", java);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("php", php);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("dockerfile", docker);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("plaintext", plaintext);

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

  const highlightedCode = useMemo(() => {
    if (contentType !== "code") return "";
    // Defense-in-Depth (C-1): sanitize hljs output before using dangerouslySetInnerHTML.
    // hljs escapes HTML entities in user content by default, but DOMPurify provides an
    // additional layer of protection against any future upstream vulnerabilities.
    // Only <span> with a class attribute is needed for syntax highlighting.
    const raw = hljs.highlightAuto(content).value;
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ["span"],
      ALLOWED_ATTR: ["class"],
    });
  }, [content, contentType]);

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
    const lines = content.split("\n");
    const lineNumberWidth = String(lines.length).length;

    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-lg border bg-[#0d1117]">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse text-sm font-mono">
              <tbody>
                {highlightedCode.split("\n").map((line, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    <td
                      className="select-none border-r border-white/10 px-3 py-0.5 text-right text-muted-foreground/50"
                      style={{ minWidth: `${lineNumberWidth + 2}ch` }}
                    >
                      {i + 1}
                    </td>
                    <td className="px-4 py-0.5">
                      <span dangerouslySetInnerHTML={{ __html: line || "\n" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

  if (contentType === "markdown") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border bg-muted/50 p-4 prose prose-sm dark:prose-invert max-w-none overflow-auto">
          {/* C-2: rehype-sanitize prevents XSS from future react-markdown upstream changes
              that could enable allowDangerousHtml. Explicit sanitization is best practice. */}
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
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
