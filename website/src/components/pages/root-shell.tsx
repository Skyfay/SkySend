import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/site/nav";
import { Footer } from "@/components/site/footer";
import { JsonLd } from "@/components/site/json-ld";
import { I18nProvider } from "@/i18n/provider";
import { LANGUAGE_SCRIPT, localePath, type Locale } from "@/i18n/config";
import { DISCORD_URL, GITHUB_REPO } from "@/lib/content";
import { SITE_URL } from "@/lib/site";
import "@/app/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "SkySend",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  sameAs: [`https://github.com/${GITHUB_REPO}`, DISCORD_URL],
};

/**
 * The document of every page, shared by the root layout of each language. Each
 * language has its own root layout, so `<html lang>` is right in the static
 * HTML, and the language script runs before the first paint.
 */
export function RootShell({
  locale,
  children,
  languageScript = true,
}: {
  locale: Locale;
  children: ReactNode;
  /** Off on the 404 page, which has nothing to send the visitor to. */
  languageScript?: boolean;
}) {
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "SkySend",
    url: `${SITE_URL}${localePath(locale, "/")}`,
    inLanguage: locale,
  };

  return (
    <html lang={locale} suppressHydrationWarning>
      {/* A plain head of the root layout, the App Router merges it. The rule only knows the Pages Router,
          and next/script would run the language script after the first paint. */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        {languageScript && <script dangerouslySetInnerHTML={{ __html: LANGUAGE_SCRIPT }} />}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col overflow-x-clip font-sans antialiased`}
      >
        <JsonLd data={ORGANIZATION_JSON_LD} />
        <JsonLd data={websiteJsonLd} />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <I18nProvider locale={locale}>
            <TooltipProvider>
              <Nav locale={locale} />
              <main className="flex-1">{children}</main>
              <Footer locale={locale} />
            </TooltipProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
