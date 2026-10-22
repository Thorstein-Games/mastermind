import type { Code } from "../src/logic";
import { expect, guess, open, readStats, shared, storage, test, wrongCode } from "./helpers";

async function practiceCode(page: import("@playwright/test").Page): Promise<Code> {
  return JSON.parse((await storage(page, "practice.code"))!);
}

test.describe("practice", () => {
  test("header button starts practice; Play again gives a fresh round", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await expect(page).toHaveURL(/\/mastermind\?practice$/);
    await expect(page.locator(".subtitle")).toHaveText("Practice");
    await expect(page.locator(".row")).toHaveCount(10);

    const code = await practiceCode(page);
    await guess(page, wrongCode(code));
    await page.reload(); // same round after a reload
    expect(await practiceCode(page)).toEqual(code);
    await expect(page.locator(".row-done")).toHaveCount(1);

    await guess(page, code);
    await expect(page.locator(".result h2")).toHaveText("Cracked it in 2!");
    await expect(page.locator(".result")).toContainText("Answer:");
    await expect(page.locator(".countdown")).toHaveCount(0);

    await page.getByRole("button", { name: "Share result" }).click();
    await expect.poll(async () => (await shared(page))[0] ?? "").toMatch(/^Mastermind practice 2\/10\n/);

    const historyBefore = await page.evaluate(() => history.length);
    await page.getByRole("button", { name: "Play again" }).click();
    await expect(page.locator(".row-done")).toHaveCount(0);
    await expect(page.locator(".prompt")).toHaveText("Guess 1 of 10");
    expect(await page.evaluate(() => history.length)).toBe(historyBefore); // Back still leaves practice

    // Practice never touches daily stats.
    expect(await storage(page, "stats")).toBeNull();
    expect(await readStats(page)).toMatchObject({ Played: "0" });

    await page.goBack();
    await expect(page.locator(".subtitle")).toHaveText("Daily #2");
  });

  test("losing a practice round reveals the answer", async ({ page }) => {
    await open(page, "?practice");
    const wrong = wrongCode(await practiceCode(page));
    for (let i = 0; i < 10; i++) await guess(page, wrong);
    await expect(page.locator(".result h2")).toHaveText("Out of guesses");
    await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
  });

  test("practice doesn't disturb today's puzzle in progress", async ({ page }) => {
    await open(page);
    await guess(page, ["red", "red", "red", "red"]);
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await guess(page, ["green", "green", "green", "green"]);
    await page.locator(".game-header h1 a").click(); // title goes back to today's puzzle
    await expect(page.locator(".subtitle")).toHaveText("Daily #2");
    await expect(page.locator(".row-done")).toHaveCount(1);
    await expect(page.locator(".row-done .peg").first()).toHaveClass(/peg-red/);
  });
});
