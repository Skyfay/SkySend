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

export function getFlagClass(country: string): string | null {
  const code = COUNTRY_TO_CODE[country];
  return code ? `fi-${code}` : null;
}
