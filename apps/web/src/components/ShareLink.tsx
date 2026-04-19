import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Link, Plus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ShareLinkProps {
  link: string;
  averageSpeed?: string | null;
  onNewUpload: () => void;
}

export function ShareLink({ link, averageSpeed, onNewUpload }: ShareLinkProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [qrExpanded, setQrExpanded] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-success">
          <Check className="h-5 w-5" />
          {t("upload.uploadComplete")}
          {averageSpeed && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              Ø {averageSpeed}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="share-link">
            <Link className="mr-1 inline h-4 w-4" />
            {t("upload.shareLink")}
          </label>
          <div className="flex gap-2">
            <Input
              id="share-link"
              value={link}
              readOnly
              className="font-mono text-xs"
              onClick={(e) => e.currentTarget.select()}
            />
            <Button onClick={copyToClipboard} variant="secondary" size="default">
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("common.copied")}</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("common.copy")}</span>
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("upload.shareLinkHint")}
          </p>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setQrExpanded((v) => !v)}
            className="cursor-pointer rounded-lg bg-white p-2 transition-transform hover:scale-105"
          >
            <QRCodeSVG
              value={link}
              size={qrExpanded ? 256 : 96}
              level="L"
            />
          </button>
        </div>

        <Button onClick={onNewUpload} variant="outline" className="w-full">
          <Plus className="mr-1 h-4 w-4" />
          {t("upload.newUpload")}
        </Button>
      </CardContent>
    </Card>
  );
}
