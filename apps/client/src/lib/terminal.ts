/**
 * Text from someone else as the terminal may show it: a note, a sender's file name, a
 * server's error message or title. Such text can carry escape sequences that hide text,
 * fake a link, rewrite a line or write to the clipboard, and bidirectional overrides that
 * reorder what is shown. Each of them becomes a visible replacement character.
 */
export function forTerminal(text: string): string {
  return (
    text
      .replace(/\r\n/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F\u202A-\u202E\u2066-\u2069]/g, "\uFFFD")
  );
}
