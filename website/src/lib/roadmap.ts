export type RoadmapStatus = "idea" | "planned" | "in-progress";

export type RoadmapCategory =
  | "core-sharing"
  | "storage"
  | "monitoring"
  | "security"
  | "developer-experience";

export const ROADMAP_CATEGORIES: { value: RoadmapCategory; label: string }[] = [
  { value: "core-sharing", label: "Core Sharing" },
  { value: "storage", label: "Storage" },
  { value: "monitoring", label: "Monitoring" },
  { value: "security", label: "Security" },
  { value: "developer-experience", label: "Developer Experience" },
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
    title: "Docker & Deployment Hardening",
    description:
      "A finalized multi-stage Dockerfile with optimized layers, a Docker Compose health check, graceful shutdown improvements, and production optimizations like compression and caching headers.",
    status: "in-progress",
    category: "developer-experience",
  },
  {
    slug: "download-speed-limit",
    title: "Download Speed Limit",
    description:
      "A configurable download speed limit for the filesystem storage backend, matching the upload speed limit already available today (not needed for S3-compatible storage).",
    status: "planned",
    category: "storage",
  },
  {
    slug: "e2e-test-suite",
    title: "End-to-End Test Suite",
    description:
      "A Playwright test suite covering critical flows - upload, share, download, verify, password-protected uploads, and multi-file uploads - running in CI.",
    status: "planned",
    category: "developer-experience",
  },
  {
    slug: "notification-on-download",
    title: "Notification on Download",
    description:
      "An optional notification, via webhook or email, sent when a shared file is downloaded.",
    status: "idea",
    category: "monitoring",
  },
  {
    slug: "prometheus-metrics-endpoint",
    title: "Prometheus Metrics Endpoint",
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
  version?: string;
  releaseDate: string;
  changelogAnchor?: string;
  link?: { href: string; label: string };
  star?: boolean;
}

export const SHIPPED_ITEMS: ShippedItem[] = [
  {
    slug: "adaptive-zip-compression",
    title: "Adaptive ZIP Compression",
    description:
      "Multi-file uploads now use store-only compression for already-compressed formats (audio, video, images, archives, office documents), reducing CPU load on mobile devices without affecting output size.",
    version: "v2.11.1",
    releaseDate: "2026-05-31",
  },
  {
    slug: "multi-block-code-notes",
    title: "Multi-Block Code Notes and UI Improvements",
    description: "Code notes support multiple language-tagged blocks in a single note.",
    version: "v2.9.0",
    releaseDate: "2026-05-15",
  },
  {
    slug: "oidc-sso-authentication",
    title: "OIDC / SSO Authentication",
    description:
      "Sign in to admin areas via any OIDC-compatible identity provider, alongside general improvements and security patches.",
    version: "v2.8.0",
    releaseDate: "2026-05-14",
  },
  {
    slug: "native-os-share-button",
    title: "Native OS Share Button",
    description: "Share links directly through the operating system's native share sheet on supported devices.",
    version: "v2.7.0",
    releaseDate: "2026-05-08",
  },
  {
    slug: "custom-branding-chinese-language",
    title: "Custom Branding & Chinese Language",
    description:
      "New customization options for self-hosted instances (logo, title, accent color) plus Chinese language support.",
    version: "v2.6.0",
    releaseDate: "2026-05-06",
  },
  {
    slug: "cli-client-pwa-support",
    title: "CLI Client & PWA Support",
    description:
      "A cross-platform CLI binary for uploading and downloading with end-to-end encryption (single/multi-file, notes, password protection, WebSocket and HTTP chunked transports), plus installable PWA support for the web app.",
    version: "v2.4.0",
    releaseDate: "2026-04-19",
  },
  {
    slug: "s3-storage-backend",
    title: "S3 Storage Backend",
    description: "S3-compatible object storage as a second storage backend alongside the local filesystem.",
    version: "v2.2.0",
    releaseDate: "2026-04-15",
  },
  {
    slug: "encrypted-notes-text-passwords-code-snippets-ssh-keys",
    title: "Encrypted Notes, Text, Passwords, Code Snippets & SSH Keys",
    description:
      "SkySend's sharing model expands beyond files - encrypted plain text, passwords, code snippets, and SSH keys, all with the same zero-knowledge encryption as file uploads.",
    version: "v2.0.0",
    releaseDate: "2026-04-13",
  },
  {
    slug: "first-stable-release",
    title: "First Stable Release",
    description: "The first stable release of SkySend, end-to-end encrypted file sharing with no accounts and no tracking.",
    version: "v1.0.0",
    releaseDate: "2026-04-12",
  },
];

export interface Milestone {
  slug: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  liveSource?: "github-stars";
  fallbackCurrent: number;
}

export const MILESTONES: Milestone[] = [
  {
    slug: "300-github-stars",
    title: "300 GitHub Stars",
    description: "Help SkySend reach its next community milestone.",
    target: 300,
    unit: "stars",
    liveSource: "github-stars",
    fallbackCurrent: 279,
  },
];
