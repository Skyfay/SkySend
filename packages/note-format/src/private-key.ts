/**
 * Finding a private key block in pasted or stored SSH key text.
 *
 * Notes from before v3 and the CLI client used this regex:
 *
 *   /(-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----)/
 *
 * It backtracks catastrophically: a crafted note of repeated BEGIN lines takes seconds at
 * 16KB and days at 1MB, and it runs on the recipient's device after the view is counted.
 * findPrivateKey() returns exactly what the regex matched, in linear time.
 */

const BEGIN = "-----BEGIN";
const END = "-----END";
const TAIL = "PRIVATE KEY-----";

function positions(text: string, needle: string): number[] {
  const found: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) found.push(i);
  return found;
}

/** Index of the first value >= target in an ascending list, or the list's length. */
function lowerBound(list: readonly number[], target: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid]! < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The first private key block in the text, from its BEGIN line to the end of its END line's
 * last "PRIVATE KEY-----", or undefined. Same result as the regex above.
 *
 * How the regex decides, and so how this does:
 * - It takes the first BEGIN that can start a match.
 * - On the BEGIN line, the greedy [^\n]* tries the last TAIL first, then earlier ones.
 * - From there, the lazy [\s\S]*? takes the first END whose line has a TAIL after it, and
 *   that END's greedy [^\n]* ends the match at the last TAIL of its line.
 */
export function findPrivateKey(text: string): string | undefined {
  const tails = positions(text, TAIL);
  if (tails.length === 0) return undefined;
  const newlines = positions(text, "\n");
  const lineEnd = (at: number) => {
    const i = lowerBound(newlines, at);
    return i < newlines.length ? newlines[i]! : text.length;
  };
  // The last TAIL that starts before `end`, or -1.
  const lastTailBefore = (end: number) => {
    const i = lowerBound(tails, end) - 1;
    return i >= 0 ? tails[i]! : -1;
  };

  // Every END that can close a match, with the end of that match.
  const endStarts: number[] = [];
  const matchEnds: number[] = [];
  for (const start of positions(text, END)) {
    const tail = lastTailBefore(lineEnd(start));
    if (tail >= start + END.length) {
      endStarts.push(start);
      matchEnds.push(tail + TAIL.length);
    }
  }
  if (endStarts.length === 0) return undefined;
  const lastEnd = endStarts[endStarts.length - 1]!;

  for (const start of positions(text, BEGIN)) {
    // The last TAIL on the BEGIN line that still has a closing END somewhere after it.
    const tail = lastTailBefore(Math.min(lineEnd(start), lastEnd - TAIL.length + 1));
    if (tail < start + BEGIN.length) continue;
    const close = lowerBound(endStarts, tail + TAIL.length);
    return text.slice(start, matchEnds[close]);
  }
  return undefined;
}
