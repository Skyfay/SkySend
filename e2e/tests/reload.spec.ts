import { expect, test } from "./support/fixtures.js";
import {
  downloadFile,
  randomFile,
  randomText,
  shareFiles,
  shareNote,
  watchTiers,
} from "./support/flows.js";

test("a note link keeps its key through a reload", async ({ page, openRecipient, guard }) => {
  const text = randomText("Reloaded note");
  guard.text(text);
  const link = await shareNote(page, [{ type: "Text", text }]);
  guard.secretOf(link);

  const recipient = await openRecipient();
  await recipient.goto(link);
  await recipient.getByRole("button", { name: "View note" }).click();
  await expect(recipient.getByText(text)).toBeVisible();
  expect(recipient.url()).toBe(link);

  await recipient.reload();
  await recipient.getByRole("button", { name: "View note" }).click();
  await expect(recipient.getByText(text)).toBeVisible();
});

test("a file link keeps its key after a download", async ({
  page,
  openRecipient,
  guard,
  expectedTier,
}) => {
  const file = randomFile(40_000);
  guard.text(file.name);
  guard.content(file.name, file.buffer);
  const link = await shareFiles(page, [file], { downloads: 2 });
  guard.secretOf(link);

  const recipient = await openRecipient();
  const tiers = watchTiers(recipient);
  await recipient.goto(link);
  await downloadFile(recipient);
  expect(recipient.url()).toBe(link);

  await recipient.reload();
  const again = await downloadFile(recipient);
  expect(again.data.equals(file.buffer)).toBe(true);
  expect(tiers).toEqual([expectedTier, expectedTier]);
});

test("a key added to the address bar opens the link", async ({ page, openRecipient, guard }) => {
  const text = randomText("Key added later");
  guard.text(text);
  const link = await shareNote(page, [{ type: "Text", text }]);
  guard.secretOf(link);

  const recipient = await openRecipient();
  await recipient.goto(link.split("#")[0]!);
  await expect(recipient.getByText("Note not found")).toBeVisible();

  // Only the fragment changes, which the browser treats as a navigation within the page.
  await recipient.goto(link);
  await recipient.getByRole("button", { name: "View note" }).click();
  await expect(recipient.getByText(text)).toBeVisible();
});
