import { expect, test } from "./support/fixtures.js";
import { randomPassword, randomText, shareNote, unlock } from "./support/flows.js";

test("a note of several blocks reads the same", async ({ page, openRecipient, guard }) => {
  const text = randomText("Meeting notes");
  const secret = randomPassword();
  const marker = randomText("deploy").replace(" ", "-");
  const code = `const target = "${marker}";\nif (target) {\n    console.log(target);\n}`;
  guard.text(text, secret, marker);

  const link = await shareNote(page, [
    { type: "Text", text },
    { type: "Password", value: secret },
    { type: "Code", code },
  ]);
  guard.secretOf(link);

  const recipient = await openRecipient();
  await recipient.goto(link);
  await recipient.getByRole("button", { name: "View note" }).click();

  await expect(recipient.getByText(text)).toBeVisible();
  await expect(recipient.locator("body")).toContainText(marker);
  await expect(recipient.locator("body")).toContainText("console.log(target);");
  // The indentation of code survives the table the lines are shown in.
  await expect(
    recipient.locator("tr").filter({ hasText: "console.log(target);" }).locator("td").last(),
  ).toHaveJSProperty("innerText", "    console.log(target);");
  // A password stays hidden until it is revealed.
  await expect(recipient.getByText(secret)).toHaveCount(0);
  await recipient.getByRole("button", { name: "Reveal" }).click();
  await expect(recipient.getByText(secret)).toBeVisible();
});

test("a password protects a note", async ({ page, openRecipient, guard }) => {
  const text = randomText("Door code");
  const password = randomPassword();
  guard.text(text, password);

  const link = await shareNote(page, [{ type: "Text", text }], { password });
  guard.secretOf(link);

  const recipient = await openRecipient();
  await recipient.goto(link);
  await unlock(recipient, `${password}-wrong`);
  await expect(recipient.getByText("Incorrect password")).toBeVisible();
  await expect(recipient.getByText(text)).toHaveCount(0);

  await unlock(recipient, password);
  await expect(recipient.getByText(text)).toBeVisible();
});

test("a note to burn after reading opens once", async ({ page, openRecipient, guard }) => {
  const text = randomText("One time only");
  guard.text(text);

  const link = await shareNote(page, [{ type: "Text", text }], { views: "1" });
  guard.secretOf(link);

  const first = await openRecipient();
  await first.goto(link);
  await first.getByRole("button", { name: "View note" }).click();
  await expect(first.getByText(text)).toBeVisible();
  await expect(first.getByText("This note has been permanently deleted")).toBeVisible();

  const second = await openRecipient();
  await second.goto(link);
  await expect(second.getByText("View limit reached")).toBeVisible();
  await expect(second.getByText(text)).toHaveCount(0);
});
