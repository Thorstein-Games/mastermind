import { CODE, expect, expectNoSideways, guess, open, test } from "./helpers";

test.describe("page and hosting", () => {
  test("loads with styles and script at /mastermind (no trailing slash)", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Add Red" })).toBeVisible();
    // CSS applied: the red button is actually red.
    const bg = await page.getByRole("button", { name: "Add Red" }).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).toBe("rgb(229, 72, 77)");
    // Every asset is requested under /mastermind/.
    const assets = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLLinkElement | HTMLScriptElement>("link[href], script[src]")]
        .map((e) => ("href" in e && e.href) || (e as HTMLScriptElement).src)
        .filter((u) => u.startsWith(location.origin)),
    );
    for (const u of assets) expect(new URL(u).pathname).toMatch(/^\/mastermind\//);
  });

  test("shared bar, footer and ad tags are in place", async ({ page }) => {
    await open(page);
    await expect(page.locator('tg-bar[game="mastermind"]')).toHaveCount(1);
    await expect(page.locator('tg-footer[game="mastermind"]')).toHaveCount(1);
    await expect(page.locator('tg-ad[format="banner"]')).toHaveCount(1);
    // Before the bar's script loads, its 40px is held so nothing jumps.
    expect(await page.locator("tg-bar").evaluate((e) => e.getBoundingClientRect().height)).toBe(40);
    // The game fills the first screen, so the footer starts below the fold.
    const footerTop = await page.locator("tg-footer").evaluate((e) => e.getBoundingClientRect().top);
    expect(footerTop).toBeGreaterThanOrEqual(page.viewportSize()!.height);
  });

  test("footer How to Play / FAQ links jump down without resetting the game", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Add Red" }).click();
    await page.locator('tg-footer a[href="#faq"]').click();
    await expect(page).toHaveURL(/#faq$/);
    await expect(page.locator("#faq")).toBeInViewport();
    await expect(page.locator(".slots .slot.peg-red")).toHaveCount(1);
    await page.locator('tg-footer a[href="#how-to-play"]').click();
    await expect(page.locator("#how-to-play")).toBeInViewport();
    await expect(page.locator(".slots .slot.peg-red")).toHaveCount(1);
  });

  test("header buttons open help, stats, practice and challenge", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "How to play" }).click();
    await expect(page.locator("dialog[open]")).toContainText("Crack the secret code");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Statistics" }).click();
    await expect(page.locator("dialog[open]")).toContainText("Daily guesses");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Challenge a friend" }).click();
    await expect(page.locator(".subtitle")).toHaveText("Make a challenge");
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await expect(page.locator(".subtitle")).toHaveText("Practice");
  });

  test("keys typed in a dialog don't play the game", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "How to play" }).click();
    await page.keyboard.press("1");
    await page.keyboard.press("Escape");
    await expect(page.locator(".slots .slot[class*='peg-']")).toHaveCount(0);
  });

  test("nothing scrolls sideways on a small phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    await expectNoSideways(page);
    await guess(page, CODE);
    await expectNoSideways(page);
    await page.locator(".header-actions").getByRole("button", { name: "Challenge a friend" }).click();
    await page.getByRole("button", { name: "Create challenge link" }).click();
    await expectNoSideways(page);
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await expectNoSideways(page);
  });
});

test.describe("SEO and link previews", () => {
  test("title, description, canonical and social tags", async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle(/Mastermind/);
    const meta = (sel: string) => page.locator(sel).getAttribute("content");
    expect((await meta('meta[name="description"]'))!.length).toBeGreaterThan(80);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://thorsteingames.com/mastermind");
    expect(await meta('meta[property="og:url"]')).toBe("https://thorsteingames.com/mastermind");
    expect(await meta('meta[property="og:image"]')).toBe("https://thorsteingames.com/mastermind/og-image.png");
    expect(await meta('meta[name="twitter:image"]')).toBe("https://thorsteingames.com/mastermind/og-image.png");
    expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(await meta('meta[property="og:image:width"]')).toBe("1200");
    expect(await meta('meta[property="og:image:height"]')).toBe("630");
  });

  test("share image is a 1200x630 PNG", async ({ request }) => {
    const res = await request.get("/mastermind/og-image.png");
    expect(res.status()).toBe(200);
    const png = await res.body();
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  test("icons, manifest and sitemap are served", async ({ request }) => {
    for (const path of ["favicon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "site.webmanifest", "sitemap.xml"]) {
      expect((await request.get(`/mastermind/${path}`)).status(), path).toBe(200);
    }
    const sitemap = await (await request.get("/mastermind/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://thorsteingames.com/mastermind</loc>");
  });

  test("structured data parses and its FAQ matches the visible FAQ", async ({ page }) => {
    await open(page);
    const raw = await page.locator('script[type="application/ld+json"]').textContent();
    const data = JSON.parse(raw!);
    const types = data["@graph"].map((g: { "@type": unknown }) => g["@type"]);
    expect(types).toContainEqual(["VideoGame", "WebApplication"]);
    const faq = data["@graph"].find((g: { "@type": unknown }) => g["@type"] === "FAQPage");

    const visible = await page.locator(".about h3").evaluateAll((hs) =>
      hs.map((h) => ({
        q: h.textContent!.replace(/\s+/g, " ").trim(),
        a: h.nextElementSibling!.textContent!.replace(/\s+/g, " ").trim(),
      })),
    );
    expect(faq.mainEntity.map((m: { name: string; acceptedAnswer: { text: string } }) => ({ q: m.name, a: m.acceptedAnswer.text }))).toEqual(visible);
  });
});
