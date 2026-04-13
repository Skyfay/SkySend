import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NoteContentType } from "@skysend/crypto";

interface NoteContentProps {
  content: string;
  contentType: NoteContentType;
}

export function NoteContent({ content, contentType }: NoteContentProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

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
    return (
      <div className="space-y-3">
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 text-sm scrollbar-thin">
            <code>{content}</code>
          </pre>
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
