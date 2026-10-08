import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootShell } from "@/components/pages/root-shell";
import { rootMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = rootMetadata("de", SITE_URL);

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <RootShell locale="de">{children}</RootShell>;
}
