import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { generatePassword, calculateEntropy } from "@/lib/password-generator";

const MIN_LENGTH = 8;

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

  // The number field accepts any value while typing, so 1 can become 12. A password is
  // never shorter than the slider's minimum, and leaving the field snaps it back to it.
  const options = { length: Math.max(MIN_LENGTH, length), uppercase, lowercase, numbers, symbols };
  const entropy = calculateEntropy(options);
  const anySelected = uppercase || lowercase || numbers || symbols;

  const sets = [
    { key: "uppercase", label: "A-Z", checked: uppercase, set: setUppercase },
    { key: "lowercase", label: "a-z", checked: lowercase, set: setLowercase },
    { key: "numbers", label: "0-9", checked: numbers, set: setNumbers },
    { key: "symbols", label: "!@#$", checked: symbols, set: setSymbols },
  ];

  const handleGenerate = () => {
    const password = generatePassword(options);
    if (password) onGenerate(password);
  };

  return (
    <div className="space-y-3.5 rounded-2xl bg-well p-4">
      <Label className="text-xs font-medium text-muted-foreground">
        {t("passwordGenerator.title")}
      </Label>

      {/* Length */}
      <div className="flex items-center gap-3">
        <Label className="shrink-0 text-sm">{t("passwordGenerator.length")}</Label>
        <input
          type="range"
          min={MIN_LENGTH}
          max={128}
          value={length}
          onChange={(e) => setLength(parseInt(e.target.value, 10))}
          className="flex-1 cursor-pointer accent-primary"
          disabled={disabled}
        />
        <Input
          type="number"
          min={MIN_LENGTH}
          max={128}
          value={length}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v >= 1 && v <= 128) setLength(v);
          }}
          onBlur={() => setLength((l) => Math.max(MIN_LENGTH, l))}
          className="h-8 w-20 text-center text-sm tabular-nums"
          disabled={disabled}
        />
      </div>

      {/* Character type toggles */}
      <ToggleGroup
        type="multiple"
        value={sets.filter((c) => c.checked).map((c) => c.key)}
        onValueChange={(on) => sets.forEach((c) => c.set(on.includes(c.key)))}
        aria-label={t("share.characters")}
        disabled={disabled}
      >
        {sets.map(({ key, label }) => (
          <ToggleGroupItem key={key} value={key} className="font-mono">
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

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
          <Shuffle />
          {t("passwordGenerator.generate")}
        </Button>
      </div>
    </div>
  );
}
