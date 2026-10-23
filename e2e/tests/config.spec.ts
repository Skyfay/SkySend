import { writeFile } from "node:fs/promises";
import { cliWithLogin } from "./support/cli.js";
import { expect, test } from "./support/fixtures.js";
import {
  downloadFile,
  randomFile,
  randomPassword,
  randomText,
  readLink,
  shareFiles,
  unlock,
} from "./support/flows.js";
import { createRequest } from "./support/requests.js";

// Each block runs against a server of its own with one setting changed, see variant() in
// playwright.config.ts, which picks the block by the [tag] in its title.

test.describe("[forced-passwords]", () => {
  test("a file waits for a password before it uploads", async ({ page, openRecipient, guard }) => {
    const file = randomFile(30_000);
    const password = randomPassword();
    guard.text(file.name, password);
    guard.content(file.name, file.buffer);

    await page.goto("/");
    await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(file);
    const upload = page.getByRole("button", { name: "Encrypt and upload" });
    await expect(page.getByRole("switch", { name: "Password" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Password" })).toBeDisabled();
    await expect(upload).toBeDisabled();
    await page.getByPlaceholder("Enter password (required)").fill(password);
    await upload.click();
    const link = await readLink(page, "Share this link");
    guard.secretOf(link);

    const recipient = await openRecipient();
    await recipient.goto(link);
    await expect(recipient.getByText("This file is password-protected")).toBeVisible();
    await unlock(recipient, password);
    const received = await downloadFile(recipient);
    expect(received.data.equals(file.buffer)).toBe(true);
  });

  test("a note and a request wait for a password too", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: /^Note/ }).click();
    await page.getByRole("button", { name: /^Text/ }).click();
    await page.getByRole("textbox", { name: "Text", exact: true }).fill(randomText("Forced"));
    await expect(page.getByRole("switch", { name: "Password" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Password" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Encrypt and share" })).toBeDisabled();

    await page.goto("/requests");
    await expect(page.getByRole("switch", { name: "Password" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Password" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create request" })).toBeDisabled();
    await page.getByPlaceholder("Enter password (required)").fill(randomPassword());
    await expect(page.getByRole("button", { name: "Create request" })).toBeEnabled();
  });
});

test.describe("[files-only]", () => {
  test("only files can be shared", async ({ page, guard }) => {
    const file = randomFile(20_000);
    guard.text(file.name);
    await page.goto("/");
    await expect(page.getByRole("tab", { name: /^Note/ })).toHaveCount(0);
    guard.secretOf(await shareFiles(page, [file]));

    await page.goto("/requests");
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});

test.describe("[notes-only]", () => {
  test("only notes can be shared", async ({ page, openRecipient, guard }) => {
    const text = randomText("Only notes");
    guard.text(text);
    await page.goto("/");
    await expect(page.getByRole("tab", { name: /^File/ })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    // Without tabs the note form is the page, shareNote's click on the tab is not needed.
    await page.getByRole("button", { name: /^Text/ }).click();
    await page.getByRole("textbox", { name: "Text", exact: true }).fill(text);
    await page.getByRole("button", { name: "Encrypt and share" }).click();
    const link = await readLink(page, "Share this link");
    guard.secretOf(link);
    const recipient = await openRecipient();
    await recipient.goto(link);
    await recipient.getByRole("button", { name: "View note" }).click();
    await expect(recipient.getByText(text)).toBeVisible();

    await page.goto("/requests");
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});

test.describe("[requests-only]", () => {
  test("the start page leads to the request form", async ({ page, guard }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/requests$/);
    const { uploadLink, inboxLink } = await createRequest(page);
    await guard.requestLinks(uploadLink, inboxLink);
  });
});

test.describe("[slow-uploads]", () => {
  test("a cancelled upload leaves no link behind", async ({ page }) => {
    // About six seconds at the speed limit of this server, plenty of time to cancel.
    const file = randomFile(6 * 1024 * 1024);
    await page.goto("/");
    await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(file);
    await page.getByRole("button", { name: "Encrypt and upload" }).click();
    await page.getByRole("button", { name: "Cancel upload" }).click();

    // The form comes back with the file still picked, and nothing was shared.
    await expect(page.getByRole("button", { name: "Encrypt and upload" })).toBeVisible();
    await expect(page.getByLabel("Share this link")).toHaveCount(0);
    await page.goto("/uploads");
    await expect(page.getByText("No uploads yet")).toBeVisible();
  });
});

test.describe("[oidc]", () => {
  test("sharing waits for a login, reading does not", async ({ page, openRecipient, guard }) => {
    const file = randomFile(30_000);
    guard.text(file.name);
    guard.content(file.name, file.buffer);

    await page.goto("/");
    await expect(page.getByText("Login required to upload")).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    // The development login form of the test provider takes any login, then asks for consent.
    await page.getByRole("link", { name: "Login with SSO" }).click();
    await page.locator('input[name="login"]').fill("e2e-user");
    await page.locator('input[name="password"]').fill("any-password");
    await page.getByRole("button", { name: "Sign-in" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.locator('input[type="file"]:not([webkitdirectory])')).toHaveCount(1);
    const link = await shareFiles(page, [file]);
    guard.secretOf(link);

    // Whoever holds the link reads without an account.
    const recipient = await openRecipient();
    await recipient.goto(link);
    const received = await downloadFile(recipient);
    expect(received.data.equals(file.buffer)).toBe(true);
  });

  test("the CLI logs in through the browser and sends over the WebSocket", async ({
    page,
    baseURL,
    openRecipient,
    guard,
  }, testInfo) => {
    test.skip(process.platform !== "linux", "The stand-in for the browser opener is xdg-open");
    const file = randomFile(300_000);
    guard.text(file.name);
    guard.content(file.name, file.buffer);
    const path = testInfo.outputPath(file.name);
    await writeFile(path, file.buffer);

    // The CLI prints the login address, the page logs in there, the server sends the session
    // back to the CLI on 127.0.0.1, and the CLI sends it with the WebSocket handshake.
    const home = testInfo.outputPath("home");
    const sent = await cliWithLogin(["upload", path, "--server", baseURL!], home, async (url) => {
      await page.goto(url);
      await page.locator('input[name="login"]').fill("e2e-cli-user");
      await page.locator('input[name="password"]').fill("any-password");
      await page.getByRole("button", { name: "Sign-in" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Login successful")).toBeVisible();
    });
    const link = String(sent.url);
    guard.secretOf(link);
    expect(sent.transport).toBe("ws");

    const recipient = await openRecipient();
    await recipient.goto(link);
    const received = await downloadFile(recipient);
    expect(received.data.equals(file.buffer)).toBe(true);
  });
});
