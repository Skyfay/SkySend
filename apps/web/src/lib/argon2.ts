import { argon2id } from "hash-wasm";
import type { Argon2idHashFn } from "@skysend/crypto";

/**
 * Argon2id hash function using hash-wasm.
 * Used for password-based key derivation when the upload was created with Argon2id.
 */
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
