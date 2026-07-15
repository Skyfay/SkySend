export const TAGLINE =
  "End-to-end encrypted, self-hostable file and note sharing service built for speed and security.";

export const GITHUB_REPO = "Skyfay/SkySend";
export const DOCS_URL = "https://docs.skysend.app";
export const DISCORD_URL = "https://dc.skyfay.ch";
export const GETTING_STARTED_URL = `${DOCS_URL}/user-guide/getting-started`;
export const INSTANCES_DOCS_URL = `${DOCS_URL}/instances`;

export const STATS = [
  { value: "13", label: "Languages" },
  { value: "2", label: "Storage Backends" },
  { value: "0", label: "Accounts Required" },
  { value: "AGPL-3.0", label: "Open Source" },
];

export const FEATURES = [
  {
    title: "Zero-Knowledge Encryption",
    description:
      "Every file and note is encrypted client-side with AES-256-GCM before it ever leaves the browser - the server only ever stores ciphertext and never sees the key.",
  },
  {
    title: "Files & Notes",
    description:
      "Share files, plain text, passwords, code snippets, and SSH keys, all with the same end-to-end encryption and expiry model.",
  },
  {
    title: "Self-Destructing Links",
    description:
      "Configurable expiry times and download/view limits, so a share disappears automatically after it's no longer needed.",
  },
  {
    title: "Password Protection",
    description:
      "Add an optional password on top of the encryption key for an extra layer of access control on sensitive shares.",
  },
  {
    title: "No Accounts, No Tracking",
    description:
      "Open the site and share - no registration, no login, and no analytics tracking who uploaded or downloaded what.",
  },
  {
    title: "Storage Flexibility",
    description:
      "Local filesystem or any S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, and more) as the storage backend.",
  },
  {
    title: "CLI & TUI Client",
    description:
      "A cross-platform CLI and terminal UI for uploading and downloading with the same end-to-end encryption as the web app.",
  },
  {
    title: "Progressive Web App",
    description:
      "Install SkySend as a PWA for a native-feeling, installable experience directly from the browser.",
  },
  {
    title: "Designed for Simplicity",
    description:
      "A minimalist interface with sensible defaults - deep configurability for self-hosters, nothing to learn for the person just opening a link.",
  },
];

export const ACCESS_METHODS = [
  {
    title: "Web UI",
    description: "Drag, drop, and share directly from the browser - no installation required.",
  },
  {
    title: "CLI & TUI",
    description: "Script uploads and downloads, or use the interactive terminal UI, with the same E2E encryption.",
  },
  {
    title: "REST API",
    description: "A documented HTTP API behind every instance, for building your own integrations.",
  },
  {
    title: "Docker",
    description: "A single multi-arch image (amd64/arm64) to self-host your own instance in minutes.",
  },
];

export const QUICK_START_SNIPPET = `# docker-compose.yml
services:
  skysend:
    image: skyfay/skysend:latest
    container_name: skysend
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
      - ./uploads:/uploads
    environment:
      - BASE_URL=http://localhost:3000`;

export const FAQS = [
  {
    question: "Can the SkySend server read my files or notes?",
    answer:
      "No. Every file and note is encrypted in your browser with AES-256-GCM before upload, and the decryption key lives only in the share link's URL fragment, which is never sent to the server. The server only ever stores and serves ciphertext.",
  },
  {
    question: "Do I need to create an account?",
    answer:
      "No. SkySend has no user accounts for sharing - open an instance and start uploading. Self-hosters can optionally require OIDC/SSO login before uploads or notes are allowed, for example to restrict a private instance to their organization.",
  },
  {
    question: "Is there a hosted or cloud version?",
    answer:
      "SkySend is self-hosted, distributed as a single Docker image you run on your own infrastructure. See the Server Instances section for community-run public instances.",
  },
  {
    question: "What license is SkySend released under?",
    answer: "AGPL-3.0. The source code is fully open and available on GitHub.",
  },
  {
    question: "What can I share besides files?",
    answer:
      "Files, plain text, passwords, code snippets, and SSH keys - all with the same zero-knowledge encryption, configurable expiry, and download/view limits.",
  },
];
