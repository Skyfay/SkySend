export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The choice of the visitor in localStorage, the same key the app uses. No key means Auto. */
export const LANG_STORAGE_KEY = "skysend-lang";

/** The flag of a language in flag-icons, the same the app shows. */
export const LOCALE_FLAG: Record<Locale, string> = { en: "us", de: "de" };

/** The tag for dates and numbers. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-US", de: "de-DE" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * A path of the site in a language. English lives at the root, every other
 * language under its own prefix, so `/roadmap/` becomes `/de/roadmap/`.
 */
export function localePath(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE) return path;
  if (path === "/" || path === "") return `/${locale}/`;
  return `/${locale}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The language a path is in, from its prefix. */
function localeOfPath(pathname: string): Locale {
  const first = pathname.split("/")[1];
  return isLocale(first) && first !== DEFAULT_LOCALE ? first : DEFAULT_LOCALE;
}

/**
 * The same page in another language. Leading slashes and backslashes collapse
 * into one slash, so a path like /de//example.com can never turn into a link
 * to another host.
 */
export function switchLocalePath(pathname: string, target: Locale): string {
  const current = localeOfPath(pathname);
  const rest = current === DEFAULT_LOCALE ? pathname : pathname.slice(current.length + 1);
  return localePath(target, `/${rest.replace(/^[/\\]+/, "")}`);
}

/**
 * Runs in the head before the page paints. With Auto, the first language of
 * the browser the site has wins, with English as the fallback. A language the
 * visitor picked wins over the browser. Crawlers stay on the page they asked
 * for, so every language stays indexable. Kept in plain ES5, it runs before
 * any bundle.
 */
export const LANGUAGE_SCRIPT = `(function(){try{
var L=${JSON.stringify(LOCALES)},D=${JSON.stringify(DEFAULT_LOCALE)},K=${JSON.stringify(LANG_STORAGE_KEY)};
if(/bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|lighthouse|headless/i.test(navigator.userAgent))return;
var p=null;try{p=localStorage.getItem(K)}catch(e){}
var want=L.indexOf(p)>=0?p:null;
if(!want){var ls=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||D];
for(var i=0;i<ls.length&&!want;i++){var c=String(ls[i]).toLowerCase().split("-")[0];if(L.indexOf(c)>=0)want=c}
want=want||D}
var path=location.pathname,first=path.split("/")[1],here=L.indexOf(first)>=0&&first!==D?first:D;
if(want===here)return;
var rest="/"+(here===D?path:path.slice(here.length+1)).replace(/^[\\/\\\\]+/,"");
var target=want===D?rest:"/"+want+rest;
location.replace(target+location.search+location.hash);
}catch(e){}})();`;
