// Helpers shared by the HPKE and file request tests.

/** The P-256 field prime. */
export const P256_PRIME = 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n;

export function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A copy with the lowest bit of one byte flipped. */
export function flipped(bytes: Uint8Array, index = 0): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[index]! ^= 0x01;
  return copy;
}

/** The same point with y replaced by p - y: same x, so the same ECDH output. */
export function negate(point: Uint8Array): Uint8Array {
  const y = BigInt(`0x${toHex(point.slice(33))}`);
  const negY = (P256_PRIME - y).toString(16).padStart(64, "0");
  return new Uint8Array([0x04, ...point.slice(1, 33), ...fromHex(negY)]);
}
