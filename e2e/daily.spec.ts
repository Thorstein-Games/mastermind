import { dailyCode, puzzleNumber } from "../src/logic";
import {
  CODE,
  DAY,
  expect,
  goToDay,
  guess,
  open,
  pins,
  readStats,
  shared,
  storage,
  test,
  wrongCode,
} from "./helpers";

test.describe("daily puzzle", () => {
  test("first visit shows how to play once", async ({ page }) => {
    await open(page, "", { seenHelp: false });
    const help = page.locator("dialog[open]");
    await expect(help.getByRole("heading", { name: "How to play" })).toBeVisible();
    await help.getByRole("button", { name: "Close" }).click();
    await expect(help).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".subtitle")).toHaveText("Daily #2");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });

  test("shows today's puzzle number and 10 empty rows", async ({ page }) => {
    await open(page);
    await expect(page.locator(".subtitle")).toHaveText(`Daily #${puzzleNumber(DAY)}`);
    await expect(page.locator(".row")).toHaveCount(10);
    await expect(page.locator(".row-done")).toHaveCount(0);
    await expect(page.locator(".history-head")).toContainText("10 left");
    await expect(page.locator(".prompt")).toHaveText("Guess 1 of 10");
  });

  test("building a guess: tap to add, tap a peg or Delete to remove", async ({ page }) => {
    await open(page);
    const guessBtn = page.getByRole("button", { name: "Guess", exact: true });
    const deleteBtn = page.getByRole("button", { name: "⌫ Delete" });
    await expect(guessBtn).toBeDisabled();
    await expect(deleteBtn).toBeDisabled();

    await page.getByRole("button", { name: "Add Red" }).click();
    await page.getByRole("button", { name: "Add Blue" }).click();
    await expect(page.locator(".slots .slot.peg-red")).toHaveCount(1);
    await expect(page.locator(".slots .slot.peg-blue")).toHaveCount(1);
    await expect(guessBtn).toBeDisabled();

    // Tapping a filled peg clears it; the next color fills that gap.
    await page.getByRole("button", { name: /Spot 1: Red/ }).click();
    await expect(page.locator(".slots .slot.peg-red")).toHaveCount(0);
    await page.getByRole("button", { name: "Add Green" }).click();
    await expect(page.getByRole("button", { name: /Spot 1: Green/ })).toBeVisible();

    await deleteBtn.click(); // removes the last filled spot (Blue in spot 2)
    await expect(page.locator(".slots .slot.peg-blue")).toHaveCount(0);

    for (const c of ["Yellow", "Yellow", "Yellow"]) await page.getByRole("button", { name: `Add ${c}` }).click();
    await expect(guessBtn).toBeEnabled();
    // A full row ignores more colors.
    await page.getByRole("button", { name: "Add Red" }).click();
    await expect(page.locator(".slots .slot.peg-red")).toHaveCount(0);
    await guessBtn.click();
    await expect(page.locator(".row-done")).toHaveCount(1);
    await expect(page.locator(".row-done .peg").nth(0)).toHaveClass(/peg-green/);
  });

  test("keyboard: 1-4 and R/Y/G/B add, Backspace removes, Enter guesses", async ({ page }) => {
    await open(page);
    await page.keyboard.press("1");
    await page.keyboard.press("y");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("3");
    await page.keyboard.press("b");
    await page.keyboard.press("4");
    await page.keyboard.press("Enter");
    await expect(page.locator(".row-done")).toHaveCount(1);
    const pegs = page.locator(".row-done .peg");
    await expect(pegs.nth(0)).toHaveClass(/peg-red/);
    await expect(pegs.nth(1)).toHaveClass(/peg-green/);
    await expect(pegs.nth(2)).toHaveClass(/peg-blue/);
    await expect(pegs.nth(3)).toHaveClass(/peg-blue/);
  });

  test("Enter with an incomplete guess asks to fill all spots", async ({ page }) => {
    await open(page);
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
    await expect(page.locator(".status")).toHaveText("Fill all 4 spots first.");
    await expect(page.locator(".row-done")).toHaveCount(0);
  });

  test("pins score each guess correctly", async ({ page }) => {
    expect(CODE).toEqual(["blue", "red", "yellow", "green"]);
    await open(page);
    await guess(page, ["red", "red", "red", "red"]); // one red, in place
    await guess(page, ["red", "blue", "green", "yellow"]); // all four colors, none in place
    await guess(page, ["blue", "red", "green", "yellow"]); // 2 in place, 2 swapped
    await guess(page, ["green", "green", "green", "green"]);
    expect(await pins(page, 1)).toEqual({ black: 1, white: 0 });
    expect(await pins(page, 2)).toEqual({ black: 0, white: 4 });
    expect(await pins(page, 3)).toEqual({ black: 2, white: 2 });
    expect(await pins(page, 4)).toEqual({ black: 1, white: 0 });
    await expect(page.locator(".history-head")).toContainText("6 left");
  });

  test("winning: answer, share text, countdown, stats", async ({ page }) => {
    await open(page);
    await guess(page, ["red", "blue", "green", "yellow"]);
    await guess(page, CODE);

    const result = page.locator(".result");
    await expect(result.locator("h2")).toHaveText("Cracked it in 2!");
    await expect(result).toContainText("Answer:");
    const answer = result.locator(".reveal .peg");
    await expect(answer).toHaveCount(4);
    for (const [i, c] of CODE.entries()) await expect(answer.nth(i)).toHaveClass(new RegExp(`peg-${c}`));
    await expect(result.locator(".countdown")).toHaveText("Next code in 12:00:00");
    await expect(page.locator(".palette")).toHaveCount(0);

    await result.getByRole("button", { name: "Share result" }).click();
    await expect.poll(() => shared(page)).toHaveLength(1);
    const [text] = await shared(page);
    expect(text).toBe("Mastermind #2 2/10\n\n⚪⚪⚪⚪\n⚫⚫⚫⚫\n\nhttp://localhost:4317/mastermind");
    expect(text).not.toMatch(/[🟥🟨🟩🟦]/u);

    expect(await readStats(page)).toEqual({ Played: "1", "Win %": "100%", Streak: "1", "Best streak": "1" });
    await expect(page.locator(".finish-extras tg-more-games")).toHaveCount(1);
  });

  test("a finished puzzle stays finished after a reload, and counts once", async ({ page }) => {
    await open(page);
    await guess(page, CODE);
    await expect(page.locator(".result h2")).toHaveText("First try. Unreal!");
    await page.reload();
    await expect(page.locator(".result h2")).toHaveText("First try. Unreal!");
    await expect(page.locator(".row-done")).toHaveCount(1);
    expect(await readStats(page)).toMatchObject({ Played: "1", Streak: "1" });
  });

  test("progress mid-game survives a reload", async ({ page }) => {
    await open(page);
    await guess(page, ["red", "red", "red", "red"]);
    await guess(page, ["green", "green", "green", "green"]);
    await page.reload();
    await expect(page.locator(".row-done")).toHaveCount(2);
    await expect(page.locator(".prompt")).toHaveText("Guess 3 of 10");
  });

  test("losing after 10 guesses reveals the answer", async ({ page }) => {
    await open(page);
    const wrong = wrongCode(CODE);
    for (let i = 0; i < 10; i++) await guess(page, wrong);
    await expect(page.locator(".result h2")).toHaveText("Out of guesses");
    await expect(page.locator(".result .reveal .peg")).toHaveCount(4);
    await page.getByRole("button", { name: "Share result" }).click();
    await expect.poll(async () => (await shared(page))[0] ?? "").toMatch(/^Mastermind #2 X\/10\n/);
    expect(await readStats(page)).toEqual({ Played: "1", "Win %": "0%", Streak: "0", "Best streak": "0" });
  });

  test("a new day brings a new code; the streak grows and breaks", async ({ page }) => {
    await open(page, "", { day: "2026-10-22" });
    await guess(page, dailyCode("2026-10-22"));

    await goToDay(page, "2026-10-23");
    await expect(page.locator(".subtitle")).toHaveText("Daily #3");
    await expect(page.locator(".row-done")).toHaveCount(0);
    expect(await readStats(page)).toMatchObject({ Streak: "1" }); // still alive, today not played
    await guess(page, dailyCode("2026-10-23"));
    expect(await readStats(page)).toEqual({ Played: "2", "Win %": "100%", Streak: "2", "Best streak": "2" });

    // Yesterday's finished game is still saved under its own day.
    expect(JSON.parse((await storage(page, "game.daily:2026-10-22"))!)).toHaveLength(1);

    await goToDay(page, "2026-10-25"); // skipped the 24th
    expect(await readStats(page)).toMatchObject({ Streak: "0", "Best streak": "2" });
  });

  test("a finished puzzle left open past midnight switches to the new one", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-22T23:59:50Z") });
    await page.addInitScript(() => localStorage.setItem("mastermind.seenHelp", "true"));
    await page.goto("/mastermind");
    await guess(page, dailyCode("2026-10-22"));
    await expect(page.locator(".countdown")).toHaveText(/Next code in 00:00:\d\d/);
    await page.clock.runFor(15_000);
    await expect(page.locator(".subtitle")).toHaveText("Daily #3");
    await expect(page.locator(".palette")).toBeVisible();
  });

  test("Challenge a friend and Practice buttons on the finish screen", async ({ page }) => {
    await open(page);
    await guess(page, CODE);
    await page.locator(".result").getByRole("button", { name: "Practice" }).click();
    await expect(page).toHaveURL(/\?practice$/);
    await page.goBack();
    await page.locator(".result").getByRole("button", { name: "Challenge a friend" }).click();
    await expect(page).toHaveURL(/\?create$/);
  });
});
