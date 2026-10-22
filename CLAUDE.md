# CLAUDE.md

Mastermind: a single-player daily code-breaking puzzle (4 pegs, colors Red/Yellow/Green/Blue, repeats allowed, 10 guesses). Static site, Vite + TypeScript, no framework and no backend.

## Commands

```bash
npm run dev      # Vite dev server
npm run verify   # tsc --noEmit + vitest — run before committing
npm run build    # typecheck + static build to dist/
```

## Layout

- `src/logic.ts`: all game rules, pure and unit-tested in `tests/logic.test.ts`: `scoreGuess` (black/white pins), `dailyCode(dateKey)` (seeded from the local date, so the same day always gives the same code and nothing is stored), `puzzleNumber` (#1 = `LAUNCH_KEY`, 2026-10-21), challenge tokens (`encodeChallenge`/`decodeChallenge`: 5 base36 chars = 8-bit random salt + scrambled code and guess count + 5-bit checksum), `shareText` (pins only, never colors).
- `src/storage.ts`: localStorage (`mastermind.*` keys), every access guarded. Guesses per game id (`daily:YYYY-MM-DD`, `challenge:<token>`), daily stats/streak/distribution (`recordDaily` counts each day once).
- `src/main.ts`: the UI, built with a tiny `h()` helper. Routes by query string: `/` daily, `?c=<token>&from=<name>` a friend's challenge, `?create` make a challenge, `?practice` random codes (`loadPracticeCode`/`newPracticeCode` in storage; no stats). Header icons are inline SVGs in `ICONS`. Links use `location.origin + pathname`, so they work on github.io and through the thorsteingames.com proxy.
- Changing `dailyCode`, the hash, or `LAUNCH_KEY` changes past and present daily codes (and breaks shared results); changing the challenge token format breaks links already sent. Don't, unless that's the intent.

## Hosting

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages (`https://thorstein-games.github.io/mastermind/`); thorsteingames.com/mastermind proxies it (`_redirects` in the website repo). `vite.config.ts` sets `base: "/mastermind/"`: keep asset paths absolute, because the proxied page is served without a trailing slash and relative paths would resolve to thorsteingames.com/assets/. The dev server is at `/mastermind/` too.

## Shared Thorstein Games bar and footer

`src/main.ts` loads `https://thorsteingames.com/tg-bar.js` (contract in the thorstein-games-website repo's CLAUDE.md). `index.html` has `<tg-bar game="mastermind">`, a `banner` ad between the game and `<tg-footer>`; the finish screen adds `<tg-more-games>` and a `box` ad (`.finish-ad`) under it. Never put ads on the board or mid-game. The bar is 40px: `style.css` reserves it (`tg-bar:not(:defined)`) and `.app-shell` is `100dvh - 40px`. `VITE_TG_BAR_SRC=""` at build time turns the script off (tests). The hub lists it as id `mastermind` (`GAMES` in tg-bar.js, home page, sitemap, `_redirects`).

## SEO and link previews

All in `index.html`: title/description, canonical `https://thorsteingames.com/mastermind` (challenge and `?create` URLs point to it), Open Graph + Twitter tags, JSON-LD (`VideoGame`, `BreadcrumbList`, and an `FAQPage` that must match the visible FAQ), and a static "How to play" / FAQ section below the game that the footer links jump to (`#how-to-play`, `#faq`; the router ignores hash-only changes). Social/OG URLs are absolute on thorsteingames.com. `public/og-image.png` (1200×630) is a screenshot of `scripts/og-image.html` at that viewport; edit the HTML and re-render it if the look changes, keeping its pins correct for the code shown. `public/sitemap.xml` is listed in the hub's `robots.ts`.
