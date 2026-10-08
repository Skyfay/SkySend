import { Fragment, createElement, type ReactNode } from "react";
import en from "@/i18n/messages/en.json";
import de from "@/i18n/messages/de.json";
import { INTL_LOCALE, type Locale } from "@/i18n/config";

export type Messages = typeof en;

const MESSAGES: Record<Locale, Messages> = { en, de };

function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}

// Every dot path to a string in the English file, with the plural suffixes of
// i18next folded away, so `blog.posts` stands for `posts_one` and `posts_other`.
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
type Unplural<K> = K extends `${infer B}_one` | `${infer B}_other` ? B : K;
export type MessageKey = Unplural<Leaves<Messages>>;

type Vars = Record<string, string | number>;
type Tags = Record<string, (chunks: ReactNode) => ReactNode>;

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Fills `{name}` with its value. A number is written the way the language writes numbers. */
function fill(text: string, vars: Vars | undefined, numbers: Intl.NumberFormat): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!Object.hasOwn(vars, name)) return match;
    const value = vars[name];
    return typeof value === "number" ? numbers.format(value) : value;
  });
}

export interface Translator {
  locale: Locale;
  /** A message, with `{name}` filled in. A `count` picks the plural form. */
  (key: MessageKey, vars?: Vars): string;
  /** A message with tags like `<link>Docs</link>` turned into elements, `<br>` into a line break or into what a `br` tag renders. */
  rich: (key: MessageKey, tags?: Tags, vars?: Vars) => ReactNode;
}

/**
 * The translator of a language. A missing German message falls back to the
 * English one, so a new key never shows up as its name.
 */
export function createTranslator(locale: Locale): Translator {
  const messages = getMessages(locale);
  const plural = new Intl.PluralRules(INTL_LOCALE[locale]);
  const numbers = new Intl.NumberFormat(INTL_LOCALE[locale]);

  const raw = (key: string, vars?: Vars): string => {
    if (vars && typeof vars.count === "number") {
      const form = `${key}_${plural.select(vars.count) === "one" ? "one" : "other"}`;
      const text = lookup(messages, form) ?? lookup(en, form);
      if (text) return fill(text, vars, numbers);
    }
    return fill(lookup(messages, key) ?? lookup(en, key) ?? key, vars, numbers);
  };

  const t = ((key: MessageKey, vars?: Vars) => raw(key, vars)) as Translator;
  t.locale = locale;
  // The tags are split before the variables are filled, so a value from
  // outside can never open a tag of its own.
  t.rich = (key, tags = {}, vars) => {
    const text = raw(key);
    const parts: ReactNode[] = [];
    const pattern = /<(\w+)>([\s\S]*?)<\/\1>|<br\s*\/?>/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let n = 0;
    while ((match = pattern.exec(text))) {
      if (match.index > last) parts.push(fill(text.slice(last, match.index), vars, numbers));
      if (match[1] === undefined) {
        parts.push(createElement(Fragment, { key: `br${n++}` }, tags.br ? tags.br(null) : createElement("br")));
      } else {
        const render = tags[match[1]];
        const inner = fill(match[2], vars, numbers);
        parts.push(createElement(Fragment, { key: `t${n++}` }, render ? render(inner) : inner));
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(fill(text.slice(last), vars, numbers));
    return parts;
  };
  return t;
}
