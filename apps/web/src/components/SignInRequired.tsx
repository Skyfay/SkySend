import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown in place of a share form, or the form for a new file request, when the server only
 * lets signed-in people use it.
 */
export function SignInRequired({ request = false }: { request?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-4 rounded-[20px] bg-well px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
        <LogIn className="h-6 w-6" />
      </span>
      <div className="space-y-1.5">
        <p className="text-lg font-semibold tracking-tight">{t(request ? "auth.loginRequiredRequest" : "auth.loginRequired")}</p>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">{t(request ? "request.signInText" : "share.signInText")}</p>
      </div>
      <Button asChild>
        <a href="/auth/login">
          <LogIn />
          {t("auth.loginButton")}
        </a>
      </Button>
    </div>
  );
}
