import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Upload, FolderOpen, LogOut, Menu, X } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerConfig } from "@/hooks/useServerConfig";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { config } = useServerConfig();
  const { user, isLoggedIn, loading: authLoading, logout } = useAuth(config ?? null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const logoSrc = config?.customLogo ?? "/logo.svg";
  const title = config?.customTitle ?? t("common.appName");
  const oidcEnabled = config?.oidcEnabled ?? false;

  useEffect(() => {
    document.title = `${title} | ${t("common.tabSubtitle")}`;
  }, [title, t]);

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

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const navItems = [
    { to: "/", label: t("nav.upload"), icon: Upload },
    { to: "/uploads", label: t("nav.myUploads"), icon: FolderOpen },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="relative mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link
            to="/"
            className="flex flex-1 min-w-0 items-center gap-2 text-lg font-bold tracking-tight"
          >
            <img src={logoSrc} alt="" className="h-6 w-6 shrink-0" />
            <span className="truncate">{title}</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  (to === "/" ? location.pathname === "/" : location.pathname.startsWith(to))
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </Link>
            ))}
            <LanguageSwitcher />
            <ThemeToggle />
            {oidcEnabled && isLoggedIn && (
              authLoading ? (
                <Skeleton className="h-8 w-8 rounded-md" />
              ) : (
                <button
                  type="button"
                  onClick={logout}
                  title={`${user?.name} - ${t("auth.logout")}`}
                  aria-label={t("auth.logout")}
                  className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )
            )}
          </nav>

          {/* Mobile hamburger */}
          <div className="flex shrink-0 md:hidden" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={t("nav.menu")}
              aria-expanded={mobileMenuOpen}
              className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            {mobileMenuOpen && (
              <div className="absolute right-4 top-14 z-50 min-w-45 rounded-lg border border-border bg-background py-1 shadow-lg">
                {navItems.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                      (to === "/" ? location.pathname === "/" : location.pathname.startsWith(to))
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                ))}
                <div className="my-1 border-t border-border" />
                <LanguageSwitcher mobile />
                <ThemeToggle mobile />
                {oidcEnabled && isLoggedIn && (
                  <>
                    <div className="my-1 border-t border-border" />
                    {authLoading ? (
                      <div className="px-4 py-2.5">
                        <Skeleton className="h-7 w-20 rounded-md" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { logout(); setMobileMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 px-4">
          <p>
            {title} - {t("common.tagline")} - v{__APP_VERSION__}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://github.com/skyfay/skysend"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
              </svg>
              {t("footer.source")}
            </a>
            {config?.customLegal && (
              <a
                href={config.customLegal}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                {t("footer.legal")}
              </a>
            )}
            {config?.customPrivacy && (
              <a
                href={config.customPrivacy}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                {t("footer.privacy")}
              </a>
            )}
            {config?.customLinkUrl && config?.customLinkName && (
              <a
                href={config.customLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                {config.customLinkName}
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
