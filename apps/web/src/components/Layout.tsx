import { Link, Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Upload, FolderOpen, Inbox, LogOut, Menu, X, Settings, Sparkles } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ColorSchemeToggle } from "@/components/ColorSchemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerConfig } from "@/hooks/useServerConfig";
import { useAuth } from "@/hooks/useAuth";
import { useUnseenUploads } from "@/hooks/useUnseenUploads";
import { cn } from "@/lib/utils";

/** Built-in logo shipped with the frontend build. */
const DEFAULT_LOGO = "/logo.svg";

const GITHUB_PATH =
  "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z";

export function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { config } = useServerConfig();
  const { user, isLoggedIn, loading: authLoading, logout } = useAuth(config ?? null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A misconfigured CUSTOM_LOGO or an unreachable external host would otherwise
  // leave a broken image in the header, so fall back to the built-in logo.
  const [failedLogoSrc, setFailedLogoSrc] = useState<string | null>(null);
  const customLogo = config?.customLogo ?? null;
  const logoSrc =
    customLogo && customLogo !== failedLogoSrc ? customLogo : DEFAULT_LOGO;
  const title = config?.customTitle ?? t("common.appName");
  const oidcEnabled = config?.oidcEnabled ?? false;

  useEffect(() => {
    document.title = `${title} | ${t("common.tabSubtitle")}`;
  }, [title, t]);

  const [lastPathname, setLastPathname] = useState(location.pathname);
  if (lastPathname !== location.pathname) {
    setLastPathname(location.pathname);
    if (mobileMenuOpen) setMobileMenuOpen(false);
  }

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      // Ignore clicks inside a Radix portal (dropdown content rendered at body level)
      if ((target as Element).closest?.("[data-radix-popper-content-wrapper]")) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [mobileMenuOpen]);

  // Not on the page of a share link, see useUnseenUploads.
  const onShareLink = /^\/(file|note|request|d)\//.test(location.pathname);
  const unseen = useUnseenUploads(Boolean(config?.fileRequestsEnabled) && !onShareLink);
  // A dot beside My Links, which lists the requests, while uploads wait that no inbox here
  // has shown yet.
  const unseenDot = (to: string) =>
    to === "/uploads" &&
    unseen > 0 && (
      <>
        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span className="sr-only">{t("nav.requestsUnseen")}</span>
      </>
    );

  // An instance with only file requests has nothing to share and no uploads to list.
  const sharing = !config || config.enabledServices.length > 0;
  // What you do first, then the list of what it made, then how it works, which is read once.
  const navItems = [
    ...(sharing ? [{ to: "/", label: t("header.share"), icon: Upload }] : []),
    ...(config?.fileRequestsEnabled ? [{ to: "/requests", label: t("nav.requests"), icon: Inbox }] : []),
    ...(sharing || config?.fileRequestsEnabled
      ? [{ to: "/uploads", label: t("nav.myUploads"), icon: FolderOpen }]
      : []),
    { to: "/how", label: t("header.howItWorks"), icon: Sparkles },
  ];
  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  // Settings sit with the switches of this browser, as an icon, so the nav stays short.
  const settingsLink = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/settings"
          aria-label={t("nav.settings")}
          aria-current={isActive("/settings") ? "page" : undefined}
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
            isActive("/settings")
              ? "bg-primary-soft text-primary-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Settings className="h-4 w-4" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t("nav.settings")}</TooltipContent>
    </Tooltip>
  );

  const logoutButton = oidcEnabled && isLoggedIn && (
    authLoading ? (
      <Skeleton className="h-9 w-9 rounded-full" />
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={logout}
            aria-label={t("auth.logout")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {user?.name} · {t("auth.logout")}
        </TooltipContent>
      </Tooltip>
    )
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 sm:pt-4">
        <div
          data-slot="glass"
          ref={menuRef}
          className="relative mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 rounded-full border border-border bg-card pl-4 pr-2 shadow-lift"
        >
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2.5 text-base font-semibold tracking-tight"
          >
            <img
              src={logoSrc}
              alt=""
              className="h-7 w-7 shrink-0"
              onError={() => setFailedLogoSrc(logoSrc)}
            />
            <span className="truncate">{title}</span>
          </Link>

          {/* Desktop nav */}
          <nav aria-label={t("header.navigation")} className="hidden items-center gap-1 md:flex">
            {navItems.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                aria-current={isActive(to) ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
                  isActive(to)
                    ? "bg-primary-soft text-primary-text"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
                {unseenDot(to)}
              </Link>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <LanguageSwitcher />
            <ColorSchemeToggle />
            {settingsLink}
            {logoutButton}
          </nav>

          {/* Mobile menu */}
          <div className="flex shrink-0 items-center md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={t("nav.menu")}
              aria-expanded={mobileMenuOpen}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              {!mobileMenuOpen && unseen > 0 && (
                <span
                  className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
                  aria-hidden="true"
                />
              )}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="absolute right-0 top-16 z-50 w-60 rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lift animate-in fade-in-0 zoom-in-95 md:hidden">
              {navItems.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={isActive(to) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive(to)
                      ? "bg-primary-soft text-primary-text"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {unseenDot(to)}
                </Link>
              ))}
              <div className="-mx-1.5 my-1.5 h-px bg-border" />
              <LanguageSwitcher mobile />
              <ColorSchemeToggle mobile />
              <Link
                to="/settings"
                onClick={() => setMobileMenuOpen(false)}
                aria-current={isActive("/settings") ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive("/settings")
                    ? "bg-primary-soft text-primary-text"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Settings className="h-4 w-4" />
                {t("nav.settings")}
              </Link>
              {oidcEnabled && isLoggedIn && (
                <>
                  <div className="-mx-1.5 my-1.5 h-px bg-border" />
                  {authLoading ? (
                    <div className="px-3 py-2">
                      <Skeleton className="h-7 w-24 rounded-lg" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { logout(); setMobileMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <LogOut className="h-4 w-4" />
                      <span className="max-w-40 truncate">{user?.name}</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-8 sm:pt-12">
        <Outlet />
      </main>

      <footer className="px-4 pb-8 pt-4 text-center text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2.5">
          <p>
            {title} · {t("common.tagline")} · v{__APP_VERSION__}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <a
              href="https://github.com/skyfay/skysend"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={GITHUB_PATH} />
              </svg>
              {t("footer.source")}
            </a>
            {config?.customReportUrl && (
              <a href={config.customReportUrl} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
                {t("footer.report")}
              </a>
            )}
            {config?.customLegal && (
              <a href={config.customLegal} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
                {t("footer.legal")}
              </a>
            )}
            {config?.customPrivacy && (
              <a href={config.customPrivacy} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
                {t("footer.privacy")}
              </a>
            )}
            {config?.customLinkUrl && config?.customLinkName && (
              <a href={config.customLinkUrl} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
                {config.customLinkName}
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
