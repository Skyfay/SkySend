import { GITHUB_REPO } from "@/lib/content";
import type { MessageKey, Messages } from "@/i18n/translate";

export type RoadmapStatus = "idea" | "planned" | "in-progress";

export type RoadmapCategory =
  | "core-sharing"
  | "storage"
  | "monitoring"
  | "security"
  | "developer-experience";

// The title and the description of an entry live in the messages under
// roadmap.items.<slug> and roadmap.shipped.<slug>, so a slug without them does
// not compile.
type ItemSlug = keyof Messages["roadmap"]["items"];
type ShippedSlug = keyof Messages["roadmap"]["shipped"];

export interface RoadmapItem {
  slug: ItemSlug;
  status: RoadmapStatus;
  category: RoadmapCategory;
  issueNumber?: number;
}

export const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    slug: "download-speed-limit",
    status: "planned",
    category: "storage",
  },
  {
    slug: "e2e-test-suite",
    status: "planned",
    category: "developer-experience",
  },
  {
    slug: "notification-on-download",
    status: "idea",
    category: "monitoring",
  },
  {
    slug: "prometheus-metrics-endpoint",
    status: "idea",
    category: "monitoring",
  },
];

export interface ShippedItem {
  slug: ShippedSlug;
  /** A release has a version and takes its date from the changelog. */
  version?: string;
  /** YYYY-MM-DD, for community milestones, which have no changelog entry. */
  releaseDate?: string;
  /** The headline features of a big release, listed on its card under "Now". */
  highlights?: MessageKey[];
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
    version: "v3.0.0",
    highlights: [
      "roadmap.shipped.version-3.highlight1",
      "roadmap.shipped.version-3.highlight2",
      "roadmap.shipped.version-3.highlight3",
      "roadmap.shipped.version-3.highlight4",
    ],
  },
  {
    slug: "download-integrity",
    version: "v2.12.2",
  },
  {
    slug: "link-previews",
    version: "v2.12.1",
  },
  {
    slug: "300-github-stars",
    stars: 300,
    releaseDate: "2026-08-10",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
  },
  {
    slug: "new-website",
    version: "v2.12.0",
  },
  {
    slug: "adaptive-zip-compression",
    version: "v2.11.1",
  },
  {
    slug: "200-github-stars",
    stars: 200,
    releaseDate: "2026-05-28",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
  },
  {
    slug: "multi-block-code-notes",
    version: "v2.9.0",
  },
  {
    slug: "oidc-sso-authentication",
    version: "v2.8.0",
  },
  {
    slug: "100-github-stars",
    stars: 100,
    releaseDate: "2026-05-10",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
  },
  {
    slug: "native-os-share-button",
    version: "v2.7.0",
  },
  {
    slug: "custom-branding-chinese-language",
    version: "v2.6.0",
  },
  {
    slug: "cli-client-pwa-support",
    version: "v2.4.0",
  },
  {
    slug: "s3-storage-backend",
    version: "v2.2.0",
  },
  {
    slug: "encrypted-notes",
    version: "v2.0.0",
  },
  {
    slug: "docker-hardening",
    version: "v1.0.0",
  },
  {
    slug: "first-stable-release",
    version: "v1.0.0",
  },
];

export interface Milestone {
  /** The star count the goal is reached at. */
  target: number;
}

export const MILESTONES: Milestone[] = [{ target: 500 }];
