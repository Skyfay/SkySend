// ---------------------------------------------------------------------------
// SSH Key Generation (Ed25519 + RSA) using Web Crypto API
// Output: OpenSSH public key format, OpenSSH/PKCS#8 private key format
// Passphrase: PKCS#8 EncryptedPrivateKeyInfo (PBES2 / PBKDF2-SHA256 / AES-256-CBC)
// ---------------------------------------------------------------------------

export interface SSHKeyPair {
  publicKey: string;
  privateKey: string;
  algorithm: "ed25519" | "rsa";
  fingerprint: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateEd25519KeyPair(
  comment = "",
  passphrase?: string,
): Promise<SSHKeyPair> {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);

  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );

  // PKCS#8 DER contains the 32-byte seed at bytes 16..47
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  );
  const seed = pkcs8.slice(16, 48);

  const publicKeyBlob = concat(
    sshString("ssh-ed25519"),
    sshString(publicKeyRaw),
  );

  const publicKeyStr = `ssh-ed25519 ${base64Encode(publicKeyBlob)}${comment ? ` ${comment}` : ""}`;

  let privateKeyStr: string;
  if (passphrase) {
    privateKeyStr = await encryptPKCS8(pkcs8, passphrase);
  } else {
    const privateSection = buildEd25519PrivateSection(
      publicKeyRaw,
      seed,
      comment,
    );
    privateKeyStr = buildOpenSSHPrivateKey(publicKeyBlob, privateSection);
  }

  const fingerprint = await sshFingerprint(publicKeyBlob);

  return {
    publicKey: publicKeyStr,
    privateKey: privateKeyStr,
    algorithm: "ed25519",
    fingerprint,
  };
}

export async function generateRSAKeyPair(
  bits = 4096,
  comment = "",
  passphrase?: string,
): Promise<SSHKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: bits,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const jwk = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.privateKey,
  )) as JsonWebKey;

  const n = base64urlDecode(jwk.n!);
  const e = base64urlDecode(jwk.e!);
  const d = base64urlDecode(jwk.d!);
  const p = base64urlDecode(jwk.p!);
  const q = base64urlDecode(jwk.q!);
  const iqmp = base64urlDecode(jwk.qi!);

  const publicKeyBlob = concat(
    sshString("ssh-rsa"),
    sshMpint(e),
    sshMpint(n),
  );

  const publicKeyStr = `ssh-rsa ${base64Encode(publicKeyBlob)}${comment ? ` ${comment}` : ""}`;

  let privateKeyStr: string;
  if (passphrase) {
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    );
    privateKeyStr = await encryptPKCS8(pkcs8, passphrase);
  } else {
    const privateSection = buildRSAPrivateSection(
      n,
      e,
      d,
      iqmp,
      p,
      q,
      comment,
    );
    privateKeyStr = buildOpenSSHPrivateKey(publicKeyBlob, privateSection);
  }

  const fingerprint = await sshFingerprint(publicKeyBlob);

  return {
    publicKey: publicKeyStr,
    privateKey: privateKeyStr,
    algorithm: "rsa",
    fingerprint,
  };
}

// ---------------------------------------------------------------------------
// SSH wire format helpers
// ---------------------------------------------------------------------------

function sshString(data: string | Uint8Array): Uint8Array {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

function sshUint32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

/** Encode a big-endian unsigned integer as SSH mpint (with sign byte if needed). */
function sshMpint(bytes: Uint8Array): Uint8Array {
  // Strip leading zeros
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.subarray(start);

  // Prepend 0x00 if high bit is set (positive number in two's complement)
  if (trimmed[0]! & 0x80) {
    const padded = new Uint8Array(trimmed.length + 1);
    padded.set(trimmed, 1);
    return sshString(padded);
  }
  return sshString(trimmed);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// OpenSSH private key format (unencrypted)
// ---------------------------------------------------------------------------

function buildOpenSSHPrivateKey(
  publicKeyBlob: Uint8Array,
  privateSection: Uint8Array,
): string {
  const magic = new TextEncoder().encode("openssh-key-v1\0");
  const data = concat(
    magic,
    sshString("none"), // cipher
    sshString("none"), // kdf
    sshString(new Uint8Array(0)), // kdf options
    sshUint32(1), // number of keys
    sshString(publicKeyBlob),
    sshString(privateSection),
  );
  return wrapPEM(data, "OPENSSH PRIVATE KEY");
}

function buildEd25519PrivateSection(
  publicKey: Uint8Array,
  seed: Uint8Array,
  comment: string,
): Uint8Array {
  const checkInt = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const unpadded = concat(
    sshUint32(checkInt),
    sshUint32(checkInt),
    sshString("ssh-ed25519"),
    sshString(publicKey),
    sshString(concat(seed, publicKey)), // 64 bytes: seed(32) + public(32)
    sshString(comment),
  );
  return addOpenSSHPadding(unpadded, 8);
}

function buildRSAPrivateSection(
  n: Uint8Array,
  e: Uint8Array,
  d: Uint8Array,
  iqmp: Uint8Array,
  p: Uint8Array,
  q: Uint8Array,
  comment: string,
): Uint8Array {
  const checkInt = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const unpadded = concat(
    sshUint32(checkInt),
    sshUint32(checkInt),
    sshString("ssh-rsa"),
    sshMpint(n),
    sshMpint(e),
    sshMpint(d),
    sshMpint(iqmp),
    sshMpint(p),
    sshMpint(q),
    sshString(comment),
  );
  return addOpenSSHPadding(unpadded, 8);
}

function addOpenSSHPadding(data: Uint8Array, blockSize: number): Uint8Array {
  const padLen = blockSize - (data.length % blockSize);
  if (padLen === blockSize) return data;
  const padding = new Uint8Array(padLen);
  for (let i = 0; i < padLen; i++) padding[i] = (i + 1) & 0xff;
  return concat(data, padding);
}

// ---------------------------------------------------------------------------
// PKCS#8 EncryptedPrivateKeyInfo (PBES2 / PBKDF2-SHA256 / AES-256-CBC)
// ---------------------------------------------------------------------------

async function encryptPKCS8(
  pkcs8Der: Uint8Array,
  passphrase: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;

  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    passphraseKey,
    { name: "AES-CBC", length: 256 },
    false,
    ["encrypt"],
  );

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      aesKey,
      pkcs8Der.buffer as ArrayBuffer,
    ),
  );

  const der = buildEncryptedPrivateKeyInfo(salt, iterations, iv, encrypted);
  return wrapPEM(der, "ENCRYPTED PRIVATE KEY");
}

// ---------------------------------------------------------------------------
// ASN.1 DER encoding
// ---------------------------------------------------------------------------

// OID constants (pre-encoded without tag+length)
const OID_PBES2 = new Uint8Array([
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d,
]);
const OID_PBKDF2 = new Uint8Array([
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0c,
]);
const OID_HMAC_SHA256 = new Uint8Array([
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x09,
]);
const OID_AES256_CBC = new Uint8Array([
  0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x01, 0x2a,
]);

function buildEncryptedPrivateKeyInfo(
  salt: Uint8Array,
  iterations: number,
  iv: Uint8Array,
  encryptedData: Uint8Array,
): Uint8Array {
  const prf = derSequence(derOID(OID_HMAC_SHA256), derNull());
  const pbkdf2Params = derSequence(
    derOctetString(salt),
    derInteger(iterations),
    prf,
  );
  const keyDerivationFunc = derSequence(derOID(OID_PBKDF2), pbkdf2Params);
  const encryptionScheme = derSequence(
    derOID(OID_AES256_CBC),
    derOctetString(iv),
  );
  const pbes2Params = derSequence(keyDerivationFunc, encryptionScheme);
  const encryptionAlgorithm = derSequence(derOID(OID_PBES2), pbes2Params);
  return derSequence(encryptionAlgorithm, derOctetString(encryptedData));
}

function derLength(len: number): Uint8Array {
  if (len < 128) return new Uint8Array([len]);
  if (len < 256) return new Uint8Array([0x81, len]);
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derTag(tag: number, content: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), derLength(content.length), content);
}

function derSequence(...items: Uint8Array[]): Uint8Array {
  return derTag(0x30, concat(...items));
}

function derOID(oid: Uint8Array): Uint8Array {
  return derTag(0x06, oid);
}

function derOctetString(data: Uint8Array): Uint8Array {
  return derTag(0x04, data);
}

function derNull(): Uint8Array {
  return new Uint8Array([0x05, 0x00]);
}

function derInteger(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v & 0xff);
    v = v >>> 8;
  } while (v > 0);
  if (bytes[0]! & 0x80) bytes.unshift(0x00);
  return derTag(0x02, new Uint8Array(bytes));
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function base64Encode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]!);
  return btoa(binary);
}

function base64urlDecode(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

function wrapPEM(data: Uint8Array, label: string): string {
  const b64 = base64Encode(data);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 70) lines.push(b64.slice(i, i + 70));
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

async function sshFingerprint(publicKeyBlob: Uint8Array): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", publicKeyBlob.buffer as ArrayBuffer),
  );
  return `SHA256:${base64Encode(hash).replace(/=+$/, "")}`;
}
