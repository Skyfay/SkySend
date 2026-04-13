const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?/~";

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

export function generatePassword(options: PasswordOptions): string {
  const pool = [
    ...(options.uppercase ? [...UPPERCASE] : []),
    ...(options.lowercase ? [...LOWERCASE] : []),
    ...(options.numbers ? [...NUMBERS] : []),
    ...(options.symbols ? [...SYMBOLS] : []),
  ];

  if (pool.length === 0) return "";

  // Use rejection sampling to avoid modulo bias
  const limit = Math.floor(0x100000000 / pool.length) * pool.length;
  const result: string[] = [];

  while (result.length < options.length) {
    const batch = new Uint32Array(options.length - result.length);
    crypto.getRandomValues(batch);
    for (const value of batch) {
      if (value < limit && result.length < options.length) {
        result.push(pool[value % pool.length]!);
      }
    }
  }

  return result.join("");
}

export function calculateEntropy(options: PasswordOptions): number {
  let poolSize = 0;
  if (options.uppercase) poolSize += 26;
  if (options.lowercase) poolSize += 26;
  if (options.numbers) poolSize += 10;
  if (options.symbols) poolSize += SYMBOLS.length;

  if (poolSize === 0) return 0;
  return Math.floor(options.length * Math.log2(poolSize));
}
