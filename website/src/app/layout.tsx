import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/components/site/nav";
import { Footer } from "@/components/site/footer";
import { JsonLd } from "@/components/site/json-ld";
import { SITE_URL } from "@/lib/site";
import { GITHUB_REPO, DISCORD_URL, TAGLINE } from "@/lib/content";
import "./globals.css";
import "flag-icons/css/flag-icons.min.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "SkySend - End-to-End Encrypted File & Note Sharing",
    template: "%s | SkySend",
  },
  description: TAGLINE,
  icons: {
    icon: "/logo.svg",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "SkySend - End-to-End Encrypted File & Note Sharing",
    description: TAGLINE,
    url: SITE_URL,
    siteName: "SkySend",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SkySend - End-to-End Encrypted File & Note Sharing",
    description: TAGLINE,
  },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "SkySend",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  sameAs: [`https://github.com/${GITHUB_REPO}`, DISCORD_URL],
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "SkySend",
  url: SITE_URL,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex min-h-screen flex-col`}
      >
        <JsonLd data={ORGANIZATION_JSON_LD} />
        <JsonLd data={WEBSITE_JSON_LD} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
