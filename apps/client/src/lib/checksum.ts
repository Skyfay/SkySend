/**
 * Find the SHA-256 checksum of `assetName` in a `sha256sum` listing like the
 * `checksums.txt` of a release. Matches the file name exactly and accepts the
 * `*` that marks binary mode. Returns null when the listing has no such line.
 */
export function findChecksum(listing: string, assetName: string): string | null {
  for (const line of listing.split("\n")) {
    const [hash = "", name = "", ...rest] = line.trim().split(/\s+/);
    if (
      rest.length === 0 &&
      name.replace(/^\*/, "") === assetName &&
      /^[0-9a-f]{64}$/i.test(hash)
    ) {
      return hash.toLowerCase();
    }
  }
  return null;
}
