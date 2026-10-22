import { decodeChallenge } from "../src/logic";
import { expect, guess, open, pins, readStats, shared, storage, test } from "./helpers";

/** Make a challenge for Blue Blue Green Blue, 12 guesses, from "Ryan"; returns the link. */
async function makeChallenge(page: import("@playwright/test").Page) {
  await open(page, "?create");
  await expect(page.locator(".subtitle")).toHaveText("Make a challenge");
  const slots = page.locator(".create .slot");
  await expect(slots).toHaveCount(4);
  // Starts Red Yellow Green Blue; each tap moves to the next color.
  for (let i = 0; i < 3; i++) await slots.nth(0).click(); // Red -> Blue
  for (let i = 0; i < 2; i++) await slots.nth(1).click(); // Yellow -> Blue
  await page.getByLabel("Guesses allowed").selectOption("12");
  await page.getByLabel("Your name").fill("Ryan");
  await page.getByRole("button", { name: "Create challenge link" }).click();
  const link = await page.locator("#challenge-link").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:4317\/mastermind\?c=[0-9a-z]{5}&from=Ryan$/);
  return link;
}

test.describe("challenges", () => {
  test("the link carries the code and guess count, scrambled", async ({ page }) => {
    const link = await makeChallenge(page);
    const token = new URL(link).searchParams.get("c");
    expect(decodeChallenge(token)).toEqual({ code: ["blue", "blue", "green", "blue"], maxGuesses: 12 });

    await page.getByRole("button", { name: "Send to a friend" }).click();
    await expect.poll(() => shared(page)).toHaveLength(1);
    expect((await shared(page))[0]).toBe(`Can you crack my Mastermind code? You get 12 guesses.\n${link}`);
  });

  test("changing the code after making a link hides the old link", async ({ page }) => {
    await makeChallenge(page);
    await page.locator(".create .slot").nth(3).click();
    await expect(page.locator("#challenge-link")).toHaveCount(0);
  });

  test("Random picks four valid colors", async ({ page }) => {
    await open(page, "?create");
    await page.getByRole("button", { name: "🎲 Random" }).click();
    await expect(page.locator(".create .slot[class*='peg-']")).toHaveCount(4);
  });

  test("a friend opens the link and plays it", async ({ page, browser }) => {
    const link = await makeChallenge(page);

    // The friend: a separate browser profile.
    const friendCtx = await browser.newContext({ timezoneId: "UTC" });
    const friend = await friendCtx.newPage();
    await friend.addInitScript(() => {
      localStorage.setItem("mastermind.seenHelp", "true");
      (window as unknown as { __shared: string[] }).__shared = [];
      const record = async (t: string) => (window as unknown as { __shared: string[] }).__shared.push(t);
      Object.defineProperty(navigator, "share", { value: (d: { text: string }) => record(d.text), configurable: true });
      Object.defineProperty(navigator, "clipboard", { value: { writeText: record }, configurable: true });
    });
    await friend.goto(link);
    await expect(friend.locator(".subtitle")).toHaveText("Challenge from Ryan");
    await expect(friend.locator(".row")).toHaveCount(12);
    await expect(friend.locator(".prompt")).toHaveText("Guess 1 of 12");

    await guess(friend, ["red", "yellow", "green", "blue"]);
    expect(await pins(friend, 1)).toEqual({ black: 2, white: 0 });
    await friend.reload(); // progress is kept per challenge
    await expect(friend.locator(".row-done")).toHaveCount(1);
    await guess(friend, ["blue", "blue", "green", "blue"]);
    await expect(friend.locator(".result h2")).toHaveText("Cracked it in 2!");
    await expect(friend.locator(".result").getByRole("button", { name: "Today's puzzle" })).toBeVisible();

    await friend.getByRole("button", { name: "Share result" }).click();
    await expect.poll(() => shared(friend)).toHaveLength(1);
    expect((await shared(friend))[0]).toBe(`Mastermind: Ryan's challenge 2/12\n\n⚫⚫➖➖\n⚫⚫⚫⚫\n\n${link}`);

    // Challenges never count toward daily stats.
    expect(await storage(friend, "stats")).toBeNull();
    expect(await readStats(friend)).toMatchObject({ Played: "0" });
    await friendCtx.close();
  });

  test("a link without a name still works", async ({ page }) => {
    await open(page, "?c=1o4vu");
    await expect(page.locator(".subtitle")).toHaveText("Friend's challenge");
    await expect(page.locator(".row")).toHaveCount(12);
  });

  test("a broken link explains itself and offers today's puzzle", async ({ page }) => {
    await open(page, "?c=zzzzz");
    await expect(page.getByRole("heading", { name: "That challenge link doesn't work" })).toBeVisible();
    await page.getByRole("button", { name: "Play today's puzzle" }).click();
    await expect(page.locator(".subtitle")).toHaveText("Daily #2");
  });

  test("Back to today's puzzle", async ({ page }) => {
    await open(page, "?create");
    await page.getByRole("button", { name: "← Back to today's puzzle" }).click();
    await expect(page.locator(".subtitle")).toHaveText("Daily #2");
  });
});
