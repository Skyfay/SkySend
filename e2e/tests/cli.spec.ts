import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  decryptMetadata,
  deriveKeys,
  ENCRYPTED_RECORD_SIZE,
  fromBase64url,
  NONCE_LENGTH,
} from "@skysend/crypto";
import { unzipSync } from "fflate";
import { cli } from "./support/cli.js";
import { expect, test } from "./support/fixtures.js";
import {
  downloadFile,
  randomFile,
  randomPassword,
  randomText,
  shareFiles,
  unlock,
  watchTiers,
} from "./support/flows.js";

// The CLI and the browser encrypt with code of their own, the CLI with its own Argon2id too, so
// a share made by one has to open in the other. The CLI talks to the server through the same
// recording proxy, so the guard watches it like a browser.

/** ID and secret of a share link without a password. */
function partsOf(link: string) {
  const url = new URL(link);
  return { id: url.pathname.split("/").pop()!, secret: fromBase64url(url.hash.slice(1)) };
}

/** The metadata of a share, decrypted with its link the way a recipient does. */
async function metadataOf(link: string) {
  const { id, secret } = partsOf(link);
  const response = await fetch(new URL(`/api/info/${id}`, link));
  const info = (await response.json()) as { salt: string; encryptedMeta: string; nonce: string };
  const keys = await deriveKeys(secret, fromBase64url(info.salt));
  return decryptMetadata(
    new Uint8Array(Buffer.from(info.encryptedMeta, "base64")),
    new Uint8Array(Buffer.from(info.nonce, "base64")),
    keys.metaKey,
  );
}

/**
 * Plays a server that reorders a stored upload: the first two records swapped and the header
 * XORed by 1, so each record still finds its nonce and decrypts. Only the base nonce named in
 * the metadata gives it away. The blob lies in DATA_DIR of the direct target, see
 * playwright.config.ts.
 */
async function reorderStoredRecords(id: string) {
  const offset = Number(process.env.E2E_PORT_OFFSET ?? 0);
  const dataDir = join(tmpdir(), `skysend-e2e-direct${offset ? `-${offset}` : ""}`);
  const path = join(dataDir, "uploads", `${id}.bin`);
  const stored = await readFile(path);
  const changed = Buffer.from(stored);
  changed[NONCE_LENGTH - 1] = changed[NONCE_LENGTH - 1]! ^ 1;
  const start = (i: number) => NONCE_LENGTH + i * ENCRYPTED_RECORD_SIZE;
  stored.copy(changed, start(0), start(1), start(2));
  stored.copy(changed, start(1), start(0), start(1));
  await writeFile(path, changed);
}

test("a file the CLI uploads with a password opens in the browser", async ({
  page,
  baseURL,
  guard,
  expectedTier,
}, testInfo) => {
  const file = randomFile(200_000);
  const password = randomPassword();
  guard.text(file.name, password);
  guard.content(file.name, file.buffer);
  const path = testInfo.outputPath(file.name);
  await writeFile(path, file.buffer);

  const { url } = await cli(
    ["upload", path, "--server", baseURL!, "--password", password],
    testInfo.outputPath("home"),
  );
  const link = String(url);
  guard.secretOf(link);

  const tiers = watchTiers(page);
  await page.goto(link);
  await unlock(page, password);
  const received = await downloadFile(page);
  expect(received.name).toBe(file.name);
  expect(received.data.equals(file.buffer)).toBe(true);
  expect(tiers).toEqual([expectedTier]);
});

test("a file the browser shares with a password downloads with the CLI", async ({
  page,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "The CLI does the downloading, any browser shares alike");
  const file = randomFile(200_000);
  const password = randomPassword();
  guard.text(file.name, password);
  guard.content(file.name, file.buffer);
  const link = await shareFiles(page, [file], { password });
  guard.secretOf(link);

  const output = testInfo.outputPath("downloads");
  await mkdir(output);
  const { file: saved } = await cli(
    ["download", link, "--output", output, "--password", password],
    testInfo.outputPath("home"),
  );
  expect(basename(String(saved))).toBe(file.name);
  expect((await readFile(String(saved))).equals(file.buffer)).toBe(true);
});

test("the CLI refuses a file whose records the server reordered", async ({
  page,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "The CLI does the downloading, any browser shares alike");
  // Two records: XOR 1 maps them onto each other. A third would land on a counter that does not
  // exist and fail to decrypt anyway.
  const file = randomFile(2 * 65_536);
  guard.text(file.name);
  guard.content(file.name, file.buffer);
  const link = await shareFiles(page, [file]);
  guard.secretOf(link);
  await reorderStoredRecords(partsOf(link).id);

  const output = testInfo.outputPath("downloads");
  await mkdir(output);
  await expect(
    cli(["download", link, "--output", output], testInfo.outputPath("home")),
  ).rejects.toThrow();
});

test("a file the CLI uploads names the base nonce of its stream", async ({
  baseURL,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "No browser takes part");
  const file = randomFile(100_000);
  guard.text(file.name);
  guard.content(file.name, file.buffer);
  const path = testInfo.outputPath(file.name);
  await writeFile(path, file.buffer);

  const { url } = await cli(["upload", path, "--server", baseURL!], testInfo.outputPath("home"));
  guard.secretOf(String(url));
  expect((await metadataOf(String(url))).streamNonce).toBeDefined();
});

test("two files of the same name the CLI sends together both arrive", async ({
  page,
  baseURL,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "The zip reads the same in every browser");
  const first = randomFile(50_000);
  const second = randomFile(60_000);
  guard.content("first", first.buffer);
  guard.content("second", second.buffer);
  const paths = [];
  for (const [folder, file] of [["a", first], ["b", second]] as const) {
    await mkdir(testInfo.outputPath(folder));
    const path = testInfo.outputPath(folder, "report.bin");
    await writeFile(path, file.buffer);
    paths.push(path);
  }

  const { url } = await cli(["upload", ...paths, "--server", baseURL!], testInfo.outputPath("home"));
  const link = String(url);
  guard.secretOf(link);
  await page.goto(link);
  const received = await downloadFile(page);
  const entries = unzipSync(new Uint8Array(received.data));
  expect(Object.keys(entries).sort()).toEqual(["report (2).bin", "report.bin"]);
  expect(Buffer.from(entries["report.bin"]!).equals(first.buffer)).toBe(true);
  expect(Buffer.from(entries["report (2).bin"]!).equals(second.buffer)).toBe(true);
});

test("a note the CLI makes opens in the browser", async ({
  page,
  baseURL,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "A note reads the same in every browser");
  const text = randomText("Written in a terminal");
  guard.text(text);

  const { url } = await cli(["note", text, "--server", baseURL!], testInfo.outputPath("home"));
  const link = String(url);
  guard.secretOf(link);

  await page.goto(link);
  await page.getByRole("button", { name: "View note" }).click();
  await expect(page.getByText(text)).toBeVisible();
});
