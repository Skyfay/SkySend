import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Copy, Check, Wand2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PasswordGenerator } from "@/components/PasswordGenerator";

interface PasswordProtectionInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}

export function PasswordProtectionInput({
  value,
  onChange,
  placeholder,
  disabled,
}: PasswordProtectionInputProps) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            disabled={disabled}
            className="pr-9 font-mono"
          />
          <button
            type="button"
            className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? t("share.hidePassword") : t("share.showPassword")}
            disabled={disabled}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={handleCopy}
              disabled={disabled || !value}
              aria-label={copied ? t("common.copied") : t("common.copy")}
            >
              {copied ? <Check className="h-4 w-4 text-primary-text" /> : <Copy className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? t("common.copied") : t("common.copy")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0 aria-expanded:border-primary-line aria-expanded:bg-primary-soft aria-expanded:text-primary-text"
              onClick={() => setShowGenerator((s) => !s)}
              disabled={disabled}
              aria-label={t("passwordGenerator.title")}
              aria-expanded={showGenerator}
            >
              <Wand2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("passwordGenerator.title")}</TooltipContent>
        </Tooltip>
      </div>

      {showGenerator && (
        <PasswordGenerator
          onGenerate={(v) => {
            onChange(v);
            setShowGenerator(false);
          }}
          disabled={disabled}
        />
      )}
    </div>
  );
}
