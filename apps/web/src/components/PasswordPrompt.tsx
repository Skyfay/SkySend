import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface PasswordPromptProps {
  onSubmit: (password: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function PasswordPrompt({
  onSubmit,
  loading = false,
  error,
}: PasswordPromptProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length > 0) {
      onSubmit(password);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="h-4 w-4" />
        <span>{t("download.passwordRequired")}</span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("download.passwordPlaceholder")}
            disabled={loading}
            autoComplete="off"
            aria-label={t("download.passwordPlaceholder")}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        <Button type="submit" disabled={loading || password.length === 0}>
          {t("download.unlock")}
        </Button>
      </div>

      {error === "wrong-password" && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {t("download.wrongPassword")}
        </p>
      )}
    </form>
  );
}
