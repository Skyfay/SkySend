export const TAGLINE =
  "End-to-end encrypted, self-hostable file and note sharing. The server only ever sees ciphertext.";

export const GITHUB_REPO = "Skyfay/SkySend";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const SPONSOR_URL = "https://github.com/sponsors/Skyfay";
export const SECURITY_URL = `${GITHUB_URL}/security/policy`;
export const DISCORD_URL = "https://dc.skyfay.ch";

export const DOCS_URL = "https://docs.skysend.app";
export const GETTING_STARTED_URL = `${DOCS_URL}/user-guide/getting-started`;
export const INSTANCES_DOCS_URL = `${DOCS_URL}/instances`;
export const CHANGELOG_URL = `${DOCS_URL}/changelog`;
export const CRYPTO_URL = `${DOCS_URL}/developer-guide/crypto/`;
export const ENV_VARS_URL = `${DOCS_URL}/user-guide/configuration/environment-variables`;
export const REVERSE_PROXY_URL = `${DOCS_URL}/user-guide/self-hosting/reverse-proxy`;
export const S3_URL = `${DOCS_URL}/user-guide/configuration/s3`;
export const CLI_URL = `${DOCS_URL}/user-guide/client-cli/`;

/** The page of the official instance that encrypts a sample text step by step. */
export const HOW_IT_WORKS_URL = "https://ch.skysend.app/how";

/** The pill above the headline of the hero. */
export const HERO_NEWS = {
  label: "Version 3.0, with file requests and notes made of blocks",
  shortLabel: "File requests in 3.0",
  href: CHANGELOG_URL,
};

export const INSTALL_COMMANDS = [
  {
    id: "unix",
    label: "macOS and Linux",
    prompt: "$",
    command: "curl -fsSL https://skysend.app/install.sh | sh",
  },
  {
    id: "windows",
    label: "Windows",
    prompt: "PS>",
    command: "irm https://skysend.app/install.ps1 | iex",
  },
] as const;

export const COMPOSE_SNIPPET = `services:
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

export const DOCKER_RUN_SNIPPET = `docker run -d --name skysend \\
  -p 3000:3000 \\
  -v ./data:/data \\
  -v ./uploads:/uploads \\
  -e BASE_URL=http://localhost:3000 \\
  skyfay/skysend:latest`;

export const FAQS = [
  {
    question: "Can the server read my files or notes?",
    answer:
      "No. Every file and note is encrypted in your browser with AES-256-GCM before it is uploaded. The key lives in the part of the link after the #, which browsers never send to a server. The server only ever stores ciphertext.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. Open an instance and share. My Links keeps your shares in this browser. If you run an instance, you can require an OIDC sign-in before anyone may share or create requests.",
  },
  {
    question: "What happens when a share expires?",
    answer:
      "The server deletes the encrypted blob once its time runs out or its download limit is used up. A note set to burn after reading is gone after the first view.",
  },
  {
    question: "Is there a hosted version?",
    answer:
      "SkySend is made to run on your own server as one Docker image. Without a server, use one of the public instances, which run the same open code.",
  },
  {
    question: "What can I share besides files?",
    answer:
      "Notes made of blocks: text and Markdown, passwords, code and SSH keys, in any combination. With a request, someone else sends you files or a filled-in note that only you can open.",
  },
  {
    question: "Which license does SkySend use?",
    answer: "AGPL-3.0. The whole source, the crypto design included, is on GitHub.",
  },
];
