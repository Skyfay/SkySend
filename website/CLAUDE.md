# Marketing Website

`@skysend/website` - the public site at skysend.app. Next.js 16 App Router with `output: "export"`, so it builds to a fully static bundle and ships to Cloudflare. React 19, Tailwind v4, Shadcn UI, MDX for the blog.

Completely separate from `apps/web`. Different React tree, different design system, different Tailwind setup, different ESLint config. Do not import between them, and do not copy a component from one into the other without adapting it.

This app **does** have a `components.json` (Shadcn `new-york` style, `neutral` base, lucide icons), so `npx shadcn@latest add <component>` works here and drops into `src/components/ui/`. `apps/web` has no such config and its primitives are maintained by hand - that asymmetry is real, do not assume the CLI works on both sides.

```bash
pnpm --filter @skysend/website dev     # localhost:3002
pnpm --filter @skysend/website build   # static export to out/
pnpm --filter @skysend/website type    # tsc --noEmit
pnpm --filter @skysend/website lint    # eslint-config-next, not the root config
```

The root `eslint.config.js` ignores `website/.next/` and `website/out/`, and the site brings its own `eslint.config.mjs` based on `eslint-config-next`. `next.config.ts` points Turbopack at the monorepo root so pnpm's hoisted store resolves.

## Static export constraints

`output: "export"` is the constraint that shapes everything:

- No Route Handlers, no Server Actions, no middleware, no ISR, no `next/image` optimisation (`images.unoptimized` is set).
- Anything dynamic happens in the browser or in a Cloudflare Worker. The abuse report form posts to `report.skysend.app`, the instance list comes from the same Worker.
- `trailingSlash: true`, so internal links keep the trailing slash.
- Data read at build time (blog posts, roadmap, instances) uses `node:fs` inside server components, which is fine because it runs during the export.

Adding a feature that needs a server means adding it to a Worker under `workers/`, not to this app.

## Layout

```
src/app/                   Routes: /, /blog, /blog/[slug], /roadmap, /report, plus robots.ts, sitemap.ts, opengraph-image.tsx
src/components/site/       Page sections (hero, faq, feature-grid, instances/, roadmap/, report/)
src/components/ui/         Radix + cva primitives for this site only
src/content/blog/*.mdx     Blog posts, frontmatter parsed by gray-matter
src/lib/                   blog, content, countries, format, github, highlight, instances, report, roadmap, site, utils
```

Server Components are the default. `"use client"` only where interactivity actually lives - the report form, the theme toggle, the tabs, the reveal animations.

## Blog

A post is a single `.mdx` file in `src/content/blog/`, with frontmatter `title`, `date`, `excerpt`, `tags`, `author`. `src/lib/blog.ts` reads the directory at build time and sorts newest first, so no index needs updating. Rendering goes through `next-mdx-remote`, and code blocks through `rehype-pretty-code` with Shiki.

Dates are `YYYY-MM-DD`. The slug is the filename.

## Report form

`src/components/site/report/report-form.tsx` plus `src/lib/report.ts`. It fetches the instance list from `https://report.skysend.app/instances`, validates with Zod, renders Cloudflare Turnstile explicitly, and posts the report to the same Worker.

- Validation lives in `ReportFormSchema` and is shared by the form, so a new field goes there first.
- The Turnstile site key falls back to Cloudflare's public test key when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset, which is what makes local development work. Do not remove the fallback and do not commit a real secret - the secret half lives only in the Worker.
- An instance without an abuse contact must stay unselectable rather than silently failing at submit time.
- Any change here is likely to need a matching change in `workers/report/`.

## Instances and roadmap

Both are data-driven. The instance list originates from `docs/public/instances.json` and reaches the site through the report Worker. The roadmap is defined in `src/lib/roadmap.ts` and rendered by the components under `components/site/roadmap/`. Update the data module, not the JSX.

## SEO

`robots.ts`, `sitemap.ts`, `json-ld.tsx`, and the `opengraph-image.tsx` files are part of the deliverable, not extras. A new route needs a `metadata` export with a title, a description, and a canonical `alternates` entry, matching the pattern in the existing pages.

## Conventions

- Files are `kebab-case`, components are named exports in `PascalCase`.
- `@/` maps to `src/`. Compose classes with `cn()` from `@/lib/utils`.
- Semantic Tailwind tokens and `next-themes` for dark mode. Every color needs to work in both themes.
- Copy is English, sentence case, and stays consistent with `PHILOSOPHY.md`. Do not promise features that are not shipped, and do not overstate the security model - the docs site is the technical authority.
- Changelog scope for anything in this directory is `**website**`.
