import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { cli, cliError } from "./support/cli.js";
import { expect, test } from "./support/fixtures.js";
import { randomFile, randomPassword, randomText } from "./support/flows.js";
import {
  createRequest,
  downloadFromInbox,
  inboxRow,
  openInbox,
  sendToRequest,
} from "./support/requests.js";

// File requests between the browser and the CLI. The browser makes the request, since the CLI
// does not. The CLI talks to the server through the same recording proxy as the browser, so
// the guard watches what it sends too. The browser part reads the same in every engine.

test("files the CLI sends into a request arrive in the inbox", async ({
  page,
  openRecipient,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "The CLI does the sending, any browser opens alike");
  const title = randomText("Server logs");
  const file = randomFile(300_000);
  guard.text(title, file.name);
  guard.content(file.name, file.buffer);
  const { uploadLink, inboxLink } = await createRequest(page, { title });
  await guard.requestLinks(uploadLink, inboxLink);

  const path = testInfo.outputPath(file.name);
  await writeFile(path, file.buffer);
  const sent = await cli(["upload", "--to", uploadLink, path], testInfo.outputPath("home"));
  expect(sent).toMatchObject({ delivered: true, fileCount: 1, size: file.buffer.length });

  const inbox = await openRecipient();
  await openInbox(inbox, inboxLink);
  await expect(inbox.getByText(title)).toBeVisible();
  const received = await downloadFromInbox(inboxRow(inbox, file.name));
  expect(received.name).toBe(file.name);
  expect(received.data.equals(file.buffer)).toBe(true);
});

test("a folder the CLI sends into a request arrives as one zip with its structure", async ({
  page,
  openRecipient,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "The zip reads the same in every browser");
  const top = randomFile(20_000);
  const nested = randomFile(35_000);
  guard.text(top.name, nested.name);
  guard.content(top.name, top.buffer);
  guard.content(nested.name, nested.buffer);
  const { uploadLink, inboxLink } = await createRequest(page, {});
  await guard.requestLinks(uploadLink, inboxLink);

  await mkdir(testInfo.outputPath("logs", "old"), { recursive: true });
  await writeFile(testInfo.outputPath("logs", top.name), top.buffer);
  await writeFile(testInfo.outputPath("logs", "old", nested.name), nested.buffer);
  const sent = await cli(
    ["upload", "--to", uploadLink, testInfo.outputPath("logs")],
    testInfo.outputPath("home"),
  );
  expect(sent.fileCount).toBe(2);

  const inbox = await openRecipient();
  await openInbox(inbox, inboxLink);
  const received = await downloadFromInbox(inboxRow(inbox, top.name));
  const entries = unzipSync(new Uint8Array(received.data));
  expect(Object.keys(entries).sort()).toEqual(
    [`logs/${top.name}`, `logs/old/${nested.name}`].sort(),
  );
  expect(Buffer.from(entries[`logs/${top.name}`]!).equals(top.buffer)).toBe(true);
  expect(Buffer.from(entries[`logs/old/${nested.name}`]!).equals(nested.buffer)).toBe(true);
});

test("the CLI stops at a full request and leaves one that asks for a note to the browser", async ({
  page,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "No browser takes part in what the CLI refuses");
  const file = randomFile(10_000);
  guard.content(file.name, file.buffer);
  const path = testInfo.outputPath(file.name);
  await writeFile(path, file.buffer);
  const home = testInfo.outputPath("home");

  const one = await createRequest(page, { uploads: 1 });
  await guard.requestLinks(one.uploadLink, one.inboxLink);
  expect(await cli(["upload", "--to", one.uploadLink, path], home)).toMatchObject({
    delivered: true,
  });
  expect((await cliError(["upload", "--to", one.uploadLink, path], home)).error).toBe(
    "This request takes no more uploads.",
  );

  const field = randomText("PIN");
  const both = await createRequest(page, { asks: "Both", field });
  await guard.requestLinks(both.uploadLink, both.inboxLink);
  expect((await cliError(["upload", "--to", both.uploadLink, path], home)).error).toContain(
    "files and a note together",
  );

  // The inbox link is for whoever made the request, never for sending.
  expect((await cliError(["upload", "--to", both.inboxLink, path], home)).error).toContain(
    "inbox link",
  );
});

test("the CLI lists an inbox and saves what a browser sent, its note included", async ({
  page,
  openRecipient,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "The CLI does the reading, any browser sends alike");
  const title = randomText("Access");
  const field = randomText("Database password");
  const value = randomPassword();
  const file = randomFile(120_000);
  guard.text(title, field, value, file.name);
  guard.content(file.name, file.buffer);
  const { uploadLink, inboxLink } = await createRequest(page, { asks: "Both", title, field });
  await guard.requestLinks(uploadLink, inboxLink);
  const sender = await openRecipient();
  await sendToRequest(sender, uploadLink, { files: [file], fields: { [field]: value } });

  const home = testInfo.outputPath("home");
  const listed = await cli(["inbox", inboxLink], home);
  expect(listed.title).toBe(title);
  const uploads = listed.uploads as Array<Record<string, unknown>>;
  expect(uploads.map((u) => u.type).sort()).toEqual(["note", "single"]);
  expect(uploads.find((u) => u.type === "single")).toMatchObject({ name: file.name, downloads: 0 });
  // Both arrived as one submission.
  expect(new Set(uploads.map((u) => u.submission)).size).toBe(1);

  const dir = testInfo.outputPath("saved");
  const saved = await cli(["inbox", inboxLink, "--save", dir], home);
  expect(saved.failed).toEqual([]);
  expect(await readFile(join(dir, file.name))).toEqual(file.buffer);
  const note = await readFile(join(dir, "note.txt"), "utf8");
  expect(note).toContain(field);
  expect(note).toContain(value);
  expect((await stat(join(dir, "note.txt"))).mode & 0o777).toBe(0o600);

  // Saving counted as a download of each, listing did not.
  const again = await cli(["inbox", inboxLink], home);
  expect((again.uploads as Array<{ downloads: number }>).map((u) => u.downloads)).toEqual([1, 1]);
});

test("the CLI opens an inbox with a password only with that password", async ({
  page,
  openRecipient,
  guard,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "The CLI does the reading, any browser sends alike");
  const password = randomPassword();
  const file = randomFile(30_000);
  guard.text(password, file.name);
  guard.content(file.name, file.buffer);
  const { uploadLink, inboxLink } = await createRequest(page, { password });
  await guard.requestLinks(uploadLink, inboxLink);
  const sender = await openRecipient();
  await sendToRequest(sender, uploadLink, { files: [file] });

  const home = testInfo.outputPath("home");
  expect((await cliError(["inbox", inboxLink, "-p", "not the password"], home)).error).toBe(
    "Wrong password, or the request no longer exists.",
  );
  const listed = await cli(["inbox", inboxLink, "-p", password], home);
  expect((listed.uploads as Array<{ name: string }>).map((u) => u.name)).toEqual([file.name]);
  // The upload link is for sending, never for reading.
  expect((await cliError(["inbox", uploadLink], home)).error).toContain("upload link");
});
