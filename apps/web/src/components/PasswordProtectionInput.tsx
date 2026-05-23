import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Copy, Check, Wand2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            disabled={disabled}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={handleCopy}
          disabled={disabled || !value}
          title={copied ? t("common.copied") : t("common.copy")}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>

        <Button
          type="button"
          variant={showGenerator ? "secondary" : "outline"}
          size="icon"
          className="shrink-0"
          onClick={() => setShowGenerator((s) => !s)}
          disabled={disabled}
          title={t("passwordGenerator.title")}
        >
          <Wand2 className="h-4 w-4" />
        </Button>
      </div>

      {showGenerator && (
        <PasswordGenerator onGenerate={(v) => onChange(v)} disabled={disabled} />
      )}
    </div>
  );
}
