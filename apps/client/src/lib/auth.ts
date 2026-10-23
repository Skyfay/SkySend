import type { Argon2idHashFn } from "@skysend/crypto";
import { argon2id } from "hash-wasm";

// ── Argon2id via hash-wasm ─────────────────────────────

export const hashWasmArgon2: Argon2idHashFn = async (
  password: Uint8Array,
  salt: Uint8Array,
  params: { memory: number; iterations: number; parallelism: number; hashLength: number },
): Promise<Uint8Array> => {
  const result = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: params.hashLength,
    outputType: "binary",
  });
  return new Uint8Array(result);
};
