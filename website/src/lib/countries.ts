const COUNTRY_TO_CODE: Record<string, string> = {
  Switzerland: "ch",
  Germany: "de",
  Austria: "at",
  France: "fr",
  Italy: "it",
  "United States": "us",
  "United Kingdom": "gb",
  Netherlands: "nl",
  Sweden: "se",
  Norway: "no",
  Finland: "fi",
  Canada: "ca",
  Australia: "au",
  Japan: "jp",
  Singapore: "sg",
};

/** The two-letter code of a country, like CH, or null for one not in the list. */
export function getCountryCode(country: string): string | null {
  return Object.hasOwn(COUNTRY_TO_CODE, country) ? COUNTRY_TO_CODE[country].toUpperCase() : null;
}

/** "ch" from the flag emoji 🇨🇭, read from its two regional indicator letters. */
function codeFromFlagEmoji(flag: string): string | null {
  const letters = [...flag].map((ch) => (ch.codePointAt(0) ?? 0) - 0x1f1e6);
  if (letters.length !== 2 || letters.some((n) => n < 0 || n > 25)) return null;
  return letters.map((n) => String.fromCharCode(97 + n)).join("");
}

/** The lowercase code of a country, from the flag emoji of the instance or the list above. */
function codeOf(country: string, flag?: string): string | null {
  return (flag && codeFromFlagEmoji(flag)) || (Object.hasOwn(COUNTRY_TO_CODE, country) ? COUNTRY_TO_CODE[country] : null);
}

/**
 * The class of the flag in flag-icons, like fi-ch. It comes from the flag emoji
 * of the instance, so any country works, and falls back to the list above.
 */
export function getFlagClass(country: string, flag?: string): string | null {
  const code = codeOf(country, flag);
  return code ? `fi-${code}` : null;
}

/** The name of the country in a language, like Schweiz, or the English name the instance gives. */
export function countryName(country: string, flag: string | undefined, intlLocale: string): string {
  const code = codeOf(country, flag);
  if (!code) return country;
  try {
    return new Intl.DisplayNames([intlLocale], { type: "region" }).of(code.toUpperCase()) ?? country;
  } catch {
    return country;
  }
}
