import { GITHUB_REPO } from "@/lib/content";

export type RoadmapStatus = "idea" | "planned" | "in-progress";

export type RoadmapCategory =
  | "core-sharing"
  | "storage"
  | "monitoring"
  | "security"
  | "developer-experience";

export const ROADMAP_CATEGORIES: { value: RoadmapCategory; label: string }[] = [
  { value: "core-sharing", label: "Core sharing" },
  { value: "storage", label: "Storage" },
  { value: "monitoring", label: "Monitoring" },
  { value: "security", label: "Security" },
  { value: "developer-experience", label: "Developer experience" },
];

export interface RoadmapItem {
  slug: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  category: RoadmapCategory;
  issueNumber?: number;
}

export const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    slug: "docker-deployment-hardening",
    title: "Docker and deployment hardening",
    description:
      "A finalized multi-stage Dockerfile with optimized layers, a Docker Compose health check, graceful shutdown improvements, and production optimizations like compression and caching headers.",
    status: "in-progress",
    category: "developer-experience",
  },
  {
    slug: "download-speed-limit",
    title: "Download speed limit",
    description:
      "A configurable download speed limit for the filesystem storage backend, matching the upload speed limit already available today (not needed for S3-compatible storage).",
    status: "planned",
    category: "storage",
  },
  {
    slug: "e2e-test-suite",
    title: "End-to-end test suite",
    description:
      "A Playwright test suite for upload, share, download and verify, with and without a password and with several files, running in CI.",
    status: "planned",
    category: "developer-experience",
  },
  {
    slug: "notification-on-download",
    title: "Notification on download",
    description:
      "An optional notification, via webhook or email, sent when a shared file is downloaded.",
    status: "idea",
    category: "monitoring",
  },
  {
    slug: "prometheus-metrics-endpoint",
    title: "Prometheus metrics endpoint",
    description:
      "A /metrics endpoint exposing upload count, storage usage, active uploads, and download rate for monitoring.",
    status: "idea",
    category: "monitoring",
  },
];

export interface ShippedItem {
  slug: string;
  title: string;
  description: string;
  /** A release has a version and takes its date from the changelog. */
  version?: string;
  /** YYYY-MM-DD, for community milestones, which have no changelog entry. */
  releaseDate?: string;
  /** The headline features of a big release, listed on its card under "Now". */
  highlights?: string[];
  /** Where a community milestone links to. A release links to its changelog block. */
  link?: string;
  /** The star count of a community milestone. */
  stars?: number;
}

// Bigger releases and community milestones, newest first. A release takes its
// date and its link from docs/changelog.md, so the newest one appears with its
// date as soon as `pnpm version:bump` writes it.
export const SHIPPED_ITEMS: ShippedItem[] = [
  {
    slug: "version-3",
    title: "Version 3.0",
    description: "A new interface, file and note requests, notes made of blocks and three themes.",
    version: "v3.0.0",
    highlights: [
      "A new interface with a floating header",
      "File and note requests",
      "Notes made of blocks",
      "Graphite, Aurora and Midnight themes",
    ],
  },
  {
    slug: "download-integrity",
    title: "Download integrity fixes",
    description: "A download that was cut short now fails instead of being saved, and upload chunks stream to disk.",
    version: "v2.12.2",
  },
  {
    slug: "link-previews",
    title: "Link previews and branding",
    description: "A custom image for link previews, and no dark flash while the light theme loads.",
    version: "v2.12.1",
  },
  {
    slug: "300-github-stars",
    stars: 300,
    title: "300 GitHub stars",
    description: "SkySend crossed 300 stars on GitHub, thank you for the continued support.",
    releaseDate: "2026-08-10",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
  },
  {
    slug: "new-website",
    title: "A new website and UX",
    description: "The first skysend.app, more branding options and security hardening.",
    version: "v2.12.0",
  },
  {
    slug: "adaptive-zip-compression",
    title: "Adaptive ZIP compression",
    description: "Files that are already compressed are packed without compressing them again, which saves CPU on phones.",
    version: "v2.11.1",
  },
  {
    slug: "200-github-stars",
    stars: 200,
    title: "200 GitHub stars",
    description: "SkySend crossed 200 stars on GitHub, thanks to everyone in the community.",
    releaseDate: "2026-05-28",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
  },
  {
    slug: "multi-block-code-notes",
    title: "Code notes with many blocks",
    description: "Several language-tagged blocks in a single code note.",
    version: "v2.9.0",
  },
  {
    slug: "oidc-sso-authentication",
    title: "OIDC sign-in",
    description: "An instance can require a sign-in with any OIDC provider before anyone may share.",
    version: "v2.8.0",
  },
  {
    slug: "100-github-stars",
    stars: 100,
    title: "100 GitHub stars",
    description: "SkySend crossed 100 stars on GitHub.",
    releaseDate: "2026-05-10",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
  },
  {
    slug: "native-os-share-button",
    title: "Native share button",
    description: "Share a link through the share sheet of the system on devices that have one.",
    version: "v2.7.0",
  },
  {
    slug: "custom-branding-chinese-language",
    title: "Custom branding and Chinese",
    description: "Logo, title and accent color for your own instance, plus Chinese as a language.",
    version: "v2.6.0",
  },
  {
    slug: "cli-client-pwa-support",
    title: "CLI client and PWA",
    description: "A terminal client with the same encryption, and the web app installs like an app.",
    version: "v2.4.0",
  },
  {
    slug: "s3-storage-backend",
    title: "S3 storage",
    description: "Any S3-compatible bucket as a second storage backend next to the local disk.",
    version: "v2.2.0",
  },
  {
    slug: "encrypted-notes",
    title: "Encrypted notes",
    description: "Text, passwords, code and SSH keys, with the same zero-knowledge encryption as files.",
    version: "v2.0.0",
  },
  {
    slug: "first-stable-release",
    title: "First stable release",
    description: "End-to-end encrypted file sharing with no accounts and no tracking.",
    version: "v1.0.0",
  },
];

export interface Milestone {
  slug: string;
  /** The star count the goal is reached at. */
  target: number;
  unit: string;
}

export const MILESTONES: Milestone[] = [{ slug: "500-github-stars", target: 500, unit: "stars" }];
