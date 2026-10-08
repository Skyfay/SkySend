import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface PasswordPromptProps {
  /** What is locked. A file when left out. */
  title?: string;
  onSubmit: (password: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function PasswordPrompt({
  title,
  onSubmit,
  loading = false,
  error,
}: PasswordPromptProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (error === "wrong-password") {
      toast.error(t("download.wrongPassword"), { id: "password-error" });
    } else if (error === "rate-limited") {
      toast.warning(t("download.tooManyAttempts"), { id: "password-error" });
    }
  }, [error, t]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length > 0) {
      onSubmit(password);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
          <Lock className="h-4 w-4" />
        </span>
        <p className="text-[15px] font-semibold tracking-tight">{title ?? t("download.passwordRequired")}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("download.passwordPlaceholder")}
            disabled={loading}
            autoComplete="off"
            autoFocus
            aria-label={t("download.passwordPlaceholder")}
            className="h-11 pr-10"
          />
          <button
            type="button"
            className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? t("share.hidePassword") : t("share.showPassword")}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button type="submit" className="h-11" disabled={loading || password.length === 0}>
          {loading && <Loader2 className="animate-spin" />}
          {t("download.unlock")}
        </Button>
      </div>
    </form>
  );
}
