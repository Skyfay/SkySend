import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { generatePassword, calculateEntropy } from "@/lib/password-generator";

interface PasswordGeneratorProps {
  onGenerate: (password: string) => void;
  disabled?: boolean;
}

export function PasswordGenerator({ onGenerate, disabled }: PasswordGeneratorProps) {
  const { t } = useTranslation();
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);

  const options = { length, uppercase, lowercase, numbers, symbols };
  const entropy = calculateEntropy(options);
  const anySelected = uppercase || lowercase || numbers || symbols;

  const handleGenerate = () => {
    const password = generatePassword(options);
    if (password) onGenerate(password);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3">
      <Label className="text-xs font-medium text-muted-foreground">
        {t("passwordGenerator.title")}
      </Label>

      {/* Length */}
      <div className="flex items-center gap-3">
        <Label className="shrink-0 text-sm">{t("passwordGenerator.length")}</Label>
        <input
          type="range"
          min={8}
          max={128}
          value={length}
          onChange={(e) => setLength(parseInt(e.target.value, 10))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
          disabled={disabled}
        />
        <Input
          type="number"
          min={8}
          max={128}
          value={length}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v >= 1 && v <= 128) setLength(v);
          }}
          className="h-8 w-16 text-center font-mono text-sm"
          disabled={disabled}
        />
      </div>

      {/* Character type toggles */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "uppercase", label: "A-Z", checked: uppercase, set: setUppercase },
          { key: "lowercase", label: "a-z", checked: lowercase, set: setLowercase },
          { key: "numbers", label: "0-9", checked: numbers, set: setNumbers },
          { key: "symbols", label: "!@#$", checked: symbols, set: setSymbols },
        ].map(({ key, label, checked, set }) => (
          <button
            key={key}
            type="button"
            onClick={() => set(!checked)}
            disabled={disabled}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              checked
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Entropy + Generate */}
      <div className="flex items-center justify-between">
        {anySelected && entropy > 0 ? (
          <span className="text-xs text-muted-foreground">
            ~{entropy} {t("passwordGenerator.bits")}
          </span>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={disabled || !anySelected}
        >
          <Shuffle className="mr-1.5 h-3.5 w-3.5" />
          {t("passwordGenerator.generate")}
        </Button>
      </div>
    </div>
  );
}
