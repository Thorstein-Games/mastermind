import { test as base, expect, type Page } from "@playwright/test";
import { type Code, dailyCode } from "../src/logic";

/** Noon UTC (the browser runs in UTC), so the calendar day is unambiguous. */
export const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/** 2026-10-22 is puzzle #2; its code is pinned in tests/logic.test.ts. */
export const DAY = "2026-10-22";
export const CODE = dailyCode(DAY);

export const URL_PATH = "/mastermind";

/**
 * Every test fails on a browser error, a failed request, or any request that
 * leaves localhost (the e2e build has the shared bar script turned off).
 * Shared text (share sheet or clipboard) is captured in window.__shared.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
      });
      page.on("response", (r) => {
        if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
      });
      page.on("request", (r) => {
        const host = new URL(r.url()).hostname;
        if (!["localhost", "127.0.0.1"].includes(host) && !r.url().startsWith("data:")) {
          errors.push(`external request: ${r.url()}`);
        }
      });
      await page.addInitScript(() => {
        const record = async (text: string) => {
          (window as unknown as { __shared: string[] }).__shared.push(text);
        };
        (window as unknown as { __shared: string[] }).__shared = [];
        Object.defineProperty(navigator, "share", { value: (d: { text: string }) => record(d.text), configurable: true });
        Object.defineProperty(navigator, "clipboard", { value: { writeText: record }, configurable: true });
      });
      await use(errors);
      expect(errors, "browser errors or unexpected requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

interface OpenOptions {
  /** Calendar day (YYYY-MM-DD) the browser thinks it is. */
  day?: string;
  /** Pretend the player has already seen the how-to-play popup. */
  seenHelp?: boolean;
}

/** Open a page of the game on a fixed day. */
export async function open(page: Page, query = "", { day = DAY, seenHelp = true }: OpenOptions = {}) {
  await page.clock.setFixedTime(noon(day));
  if (seenHelp) {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem("e2e.init")) {
          localStorage.setItem("mastermind.seenHelp", "true");
          sessionStorage.setItem("e2e.init", "1");
        }
      } catch {
        /* ignore */
      }
    });
  }
  await page.goto(URL_PATH + query);
  await expect(page.locator(".game-header h1")).toHaveText("Mastermind");
}

/** Move the browser's clock to another day and reload. */
export async function goToDay(page: Page, day: string) {
  await page.clock.setFixedTime(noon(day));
  await page.reload();
}

const LABEL: Record<Code[number], string> = { red: "Red", yellow: "Yellow", green: "Green", blue: "Blue" };

/** Enter a guess by tapping the color buttons, then Guess. */
export async function guess(page: Page, code: Code) {
  for (const c of code) await page.getByRole("button", { name: `Add ${LABEL[c]}` }).click();
  await page.getByRole("button", { name: "Guess", exact: true }).click();
}

/** A code that is not `secret`. */
export function wrongCode(secret: Code): Code {
  const all: Code = ["red", "red", "red", "red"];
  return all.join() === secret.join() ? ["blue", "blue", "blue", "blue"] : all;
}

/** Pins shown for a finished row (1-based). */
export async function pins(page: Page, row: number) {
  const r = page.locator(".row").nth(row - 1);
  return { black: await r.locator(".pin-black").count(), white: await r.locator(".pin-white").count() };
}

export async function shared(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __shared: string[] }).__shared);
}

export async function storage(page: Page, key: string) {
  return page.evaluate((k) => localStorage.getItem(k), `mastermind.${key}`);
}

/** Stats dialog numbers: { Played, "Win %", Streak, "Best streak" }. */
export async function readStats(page: Page) {
  await page.getByRole("button", { name: "Statistics" }).click();
  const dialog = page.locator("dialog[open]");
  const out: Record<string, string> = {};
  for (const stat of await dialog.locator(".stat").all()) {
    out[(await stat.locator("span").textContent())!] = (await stat.locator("strong").textContent())!;
  }
  await dialog.getByRole("button", { name: "Close" }).click();
  return out;
}

/** Fails if the page scrolls sideways. */
export async function expectNoSideways(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  expect(scroll, "page is wider than the screen").toBeLessThanOrEqual(width);
}
