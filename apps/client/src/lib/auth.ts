import {
  generateSecret,
  generateSalt,
  deriveKeys,
  computeAuthToken,
  computeOwnerToken,
  applyPasswordProtection,
  deriveKeyFromPassword,
  deriveKeyFromPasswordArgon2,
  ARGON2_PARAMS_LEGACY,
  randomBytes,
  toBase64url,
  fromBase64url,
  PASSWORD_SALT_LENGTH,
  type DerivedKeys,
  type Argon2idHashFn,
} from "@skysend/crypto";
import { argon2id } from "hash-wasm";

// ── Argon2id via hash-wasm ─────────────────────────────

const hashWasmArgon2: Argon2idHashFn = async (
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

// ── Upload Preparation ─────────────────────────────────

export interface UploadCredentials {
  secret: Uint8Array;
  salt: Uint8Array;
  keys: DerivedKeys;
  authTokenB64: string;
  ownerTokenB64: string;
  effectiveSecretB64: string;
  hasPassword: boolean;
  passwordSalt?: Uint8Array;
  passwordAlgo?: "argon2id" | "argon2id-v2" | "pbkdf2";
}

export async function prepareUpload(password?: string): Promise<UploadCredentials> {
  const secret = generateSecret();
  const salt = generateSalt();
  const keys = await deriveKeys(secret, salt);

  let effectiveSecret: Uint8Array = secret;
  let hasPassword = false;
  let passwordSalt: Uint8Array | undefined;
  let passwordAlgo: "argon2id" | "argon2id-v2" | "pbkdf2" | undefined;

  if (password && password.length > 0) {
    hasPassword = true;
    passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
    const { key: passwordKey, algorithm } = await deriveKeyFromPassword(
      password,
      passwordSalt,
      hashWasmArgon2,
    );
    passwordAlgo = algorithm;
    effectiveSecret = applyPasswordProtection(secret, passwordKey);
  }

  const authToken = await computeAuthToken(keys.authKey);
  const ownerToken = await computeOwnerToken(effectiveSecret, salt);

  return {
    secret,
    salt,
    keys,
    authTokenB64: toBase64url(authToken),
    ownerTokenB64: toBase64url(ownerToken),
    effectiveSecretB64: toBase64url(effectiveSecret),
    hasPassword,
    passwordSalt,
    passwordAlgo,
  };
}

// ── Download Preparation ───────────────────────────────

export interface DownloadCredentials {
  keys: DerivedKeys;
  authTokenB64: string;
}

export async function prepareDownload(
  secretB64: string,
  saltB64: string,
  password?: string,
  passwordSaltB64?: string,
  passwordAlgo?: "argon2id" | "argon2id-v2" | "pbkdf2",
): Promise<DownloadCredentials> {
  let secret = fromBase64url(secretB64) as Uint8Array<ArrayBuffer>;
  const salt = fromBase64url(saltB64) as Uint8Array<ArrayBuffer>;

  if (password && passwordSaltB64 && passwordAlgo) {
    const passwordSalt = fromBase64url(passwordSaltB64) as Uint8Array<ArrayBuffer>;
    let passwordKey: Uint8Array;

    if (passwordAlgo === "argon2id") {
      // Legacy uploads (pre-v2.4.4) - use old Argon2id params for backward compat
      passwordKey = await deriveKeyFromPasswordArgon2(
        password,
        passwordSalt,
        hashWasmArgon2,
        ARGON2_PARAMS_LEGACY,
      );
    } else if (passwordAlgo === "argon2id-v2") {
      // New uploads (v2.4.4+) - use current Argon2id params (default)
      passwordKey = await deriveKeyFromPasswordArgon2(
        password,
        passwordSalt,
        hashWasmArgon2,
      );
    } else {
      const { key } = await deriveKeyFromPassword(password, passwordSalt);
      passwordKey = key;
    }

    secret = applyPasswordProtection(secret, passwordKey) as Uint8Array<ArrayBuffer>;
  }

  const keys = await deriveKeys(secret, salt);
  const authToken = await computeAuthToken(keys.authKey);

  return {
    keys,
    authTokenB64: toBase64url(authToken),
  };
}
