import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  const [revealed, setRevealed] = useState(false);

  const highlightedCode = useMemo(() => {
    if (contentType !== "code") return "";
    return hljs.highlightAuto(content).value;
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
    return (
      <div className="space-y-3">
        <div className="relative rounded-lg border bg-muted/50 p-4 font-mono text-sm break-all">
          {revealed ? content : "•".repeat(Math.min(content.length, 40))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? (
              <EyeOff className="mr-1.5 h-4 w-4" />
            ) : (
              <Eye className="mr-1.5 h-4 w-4" />
            )}
            {revealed ? t("noteView.hide") : t("noteView.reveal")}
          </Button>
          <Button variant="outline" size="sm" onClick={copyToClipboard}>
            {copied ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" />
            )}
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
        </div>
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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
