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

- No Server Actions, no middleware, no ISR, no `next/image` optimisation (`images.unoptimized` is set). A Route Handler only works as a static `GET` with `export const dynamic = "force-static"`, like the RSS feed.
- Anything dynamic happens in the browser or in a Cloudflare Worker. The abuse report form posts to `report.skysend.app`, the instance list comes from the same Worker.
- `trailingSlash: true`, so internal links keep the trailing slash.
- Data read at build time (blog posts, roadmap, instances) uses `node:fs` inside server components, which is fine because it runs during the export.

Adding a feature that needs a server means adding it to a Worker under `workers/`, not to this app.

## Layout

```
src/app/(en)/              English routes at the root: /, /blog, /blog/[slug], /blog/rss.xml, /roadmap, /report, and the social cards og.png
src/app/(de)/de/           The same routes in German under /de/
src/app/                   robots.ts, sitemap.ts, global-not-found.tsx and globals.css, shared by both languages
src/components/pages/      One component per page, with its metadata, taking the locale. The route files only wrap them
src/i18n/                  config.ts, translate.ts, provider.tsx and messages/en.json, de.json
src/components/site/       Header, mobile menu, footer and the effects in fx.tsx
src/components/site/home/  The sections of the home page
src/components/site/blog/  Blog index, post parts and the MDX components
src/components/site/       roadmap/ and report/ for those pages
src/components/ui/         Radix primitives for this site only
src/content/blog/*.mdx     Blog posts, frontmatter parsed by gray-matter
src/lib/                   blog, content, countries, format, github, instances, releases, report, roadmap, site, utils, version
```

Server Components are the default. `"use client"` only where interactivity actually lives - the report form, the theme toggle, the demos of the home page, the blog filter.

## Languages

English lives at `/`, German under `/de/`, with no middleware since the export is static. Each language is a route group with its own root layout, both rendering `RootShell`, so `<html lang>` is right in the HTML. A page is a component in `components/pages/` that takes `locale`, and its two route files only pass it on. A new page gets both route files, and a new language gets its route group, its message file and its entry in `LOCALES`.

- **Copy goes through the messages**, never into the JSX. `src/i18n/messages/en.json` is the source and the type of every key, `de.json` mirrors it key by key and falls back to English for a missing one. Plurals use the i18next suffixes `_one` and `_other`, placeholders `{name}`, and `t.rich()` turns `<shine>`, `<link>`, `<code>` and `<br>` into elements. German addresses the reader with "Sie" and writes ß, like the app.
- Server components call `createTranslator(locale)`, client components `useI18n()`, which also gives `path()`. Every internal link goes through `localePath` or `path`, external links stay as they are.
- `LANGUAGE_SCRIPT` runs in the head before the first paint. Auto follows the first language of the browser the site has, a language picked in the switcher wins and is kept in localStorage as `skysend-lang`, and crawlers stay on the page they asked for. It is plain ES5 inside a template string, so a regex needs its backslashes doubled.
- Terminal output, commands and file names in the demos stay English in every language, the way the tools print them.
- The roadmap keeps only structure in `src/lib/roadmap.ts`. Its text lives under `roadmap.items.<slug>` and `roadmap.shipped.<slug>`, and a slug without messages does not compile.
- The report form sends its reasons as the English values the Worker knows. Only the label on the button is translated.
- `src/lib/seo.ts` builds the canonical and the hreflang alternates of a page, and the sitemap lists every language a page exists in.

## Look and motion

The site uses the Graphite theme of the app: the tokens in `globals.css` are its light and dark scheme, `.panel` is a card lit from above, `.btn-primary` and `.btn-chip` are its two buttons. Bands, terminals and the server side of the hero window stay dark in light mode through a `dark` class on their wrapper. The header is fixed and floats over the page, so every page starts its first section with room for it (`pt-[124px] sm:pt-[172px]`).

iOS Safari freezes on large layers under an endless animation. Every decorative animation of a big element carries a class that `@media (hover: none)` in `globals.css` stops: `fx-border` on a spinning conic layer (`SpinBorder` sets it), `fx-marquee`, `fx-floor`, `fx-shine`, `fx-twinkle`, `fx-drift`, and the lens classes of the hero. A new effect joins that list, and the same list sits under `prefers-reduced-motion`. Demos that tick in JavaScript use `useTick`, which only runs while they are on screen.

## Blog

A post is an `.mdx` file in `src/content/blog/`, with frontmatter `title`, `date`, `excerpt`, `tags`, `author` and an optional `cover` (`badge` of up to three letters, `tone` of green, blue, violet, cyan or amber, and a two-line `snippet`) for the card art. `src/lib/blog.ts` checks the frontmatter with Zod, so a broken post fails the build, reads the directory at build time and sorts newest first, so no index needs updating. Rendering goes through `next-mdx-remote`, and code blocks through `rehype-pretty-code` with Shiki. A post can use `Callout`, `Compare` and `Row` from `components/site/blog/mdx-components.tsx`, and its `##` headings make the table of contents. The feed at `/blog/rss.xml` builds from the same list.

Dates are `YYYY-MM-DD`. The slug is the filename. The author is a GitHub username, its avatar shows beside the post, with the initial while it loads or when GitHub cannot be reached.

A post has a color, the `tone` of its cover. The post page sets `data-post-tone`, and the CSS in `globals.css` turns it into `--post-tone`, `--post-tone-2`, `--post-glow` and `--post-glow-2`, so the glows, the reading bar, the table of contents, the accents of the text and the band at the end take it. Tailwind knows it as the color `post` (`bg-post/10`). The buttons stay green, they are the brand.

An illustration sits beside the posts as `public/blog/<slug>.webp`, 2400 by 1260, and its social card as `public/blog/<slug>.jpg`, 1200 by 630. With them, the card on the blog and the head of the post show the illustration, and the JPEG becomes the social card, without them the card draws its badge and the post draws a card at `og.png`. The illustrations are drawn in the color of the post on the Blog page of the SkySend Illustrations canvas, with almost no text, so one picture serves every language.

A translation sits beside its post as `<slug>.de.mdx`, with only `title`, `excerpt` and optionally `tags` in its frontmatter. The date, the author and the cover stay those of the English post. Without a translation the German page shows the English text with a notice, marks it `lang="en"` and points its canonical at the English page, so search engines index the original. Every language has its own feed, `/de/blog/rss.xml` for German.

## Report form

`src/components/site/report/report-form.tsx` plus `src/lib/report.ts`. It fetches the instance list from `https://report.skysend.app/instances`, validates with Zod, renders Cloudflare Turnstile explicitly, and posts the report to the same Worker.

- Validation lives in `ReportFormSchema` and is shared by the form, so a new field goes there first.
- The Turnstile site key falls back to Cloudflare's public test key when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset, which is what makes local development work. Do not remove the fallback and do not commit a real secret - the secret half lives only in the Worker.
- An instance without an abuse contact must stay unselectable rather than silently failing at submit time.
- Any change here is likely to need a matching change in `workers/report/`.

## Instances and roadmap

Both are data-driven. The instance list originates from `docs/public/instances.json`. The home page reads it with status and limits from the instances Worker (`instances.skysend.app`, checked every 30 minutes) and parses every instance on its own, the report form reads it from the report Worker. The roadmap is defined in `src/lib/roadmap.ts`, its text in the messages, and rendered by the components under `components/site/roadmap/`. Update the data module and the messages, not the JSX. A release in `SHIPPED_ITEMS` carries only its version: `src/lib/releases.ts` reads `docs/changelog.md` at build time for its anchor, its date and the count of all releases. A version links to its block once `pnpm version:bump` writes it, and shows its date once that block says `*Released: ...*`, before that it shows as New. Community milestones have no changelog block and keep their own `releaseDate`.

## SEO

`robots.ts`, `sitemap.ts`, `json-ld.tsx`, and the social cards are part of the deliverable, not extras. The cards are route handlers at `og.png` and `blog/[slug]/og.png` in each language, drawn in `components/pages/og-image.tsx`. A `.png` path makes the host send them as images, which the `opengraph-image` convention without an extension does not. A new page builds its `metadata` with `pageMetadata()` from `src/lib/seo.ts`, which sets the title, the description, the canonical and the hreflang alternates, matching the pattern in `components/pages/`. The 404 page is `app/global-not-found.tsx`, one English page for every language, since two root layouts need a 404 with its own document. Cloudflare serves it through `not_found_handling` in `wrangler.jsonc`.

## Conventions

- Files are `kebab-case`, components are named exports in `PascalCase`.
- `@/` maps to `src/`. Compose classes with `cn()` from `@/lib/utils`.
- Semantic Tailwind tokens and `next-themes` for dark mode. Every color needs to work in both themes.
- Copy is written in English first, sentence case, and stays consistent with `PHILOSOPHY.md`. Do not promise features that are not shipped, and do not overstate the security model - the docs site is the technical authority.
- Changelog scope for anything in this directory is `**website**`.
