# Mastermind

A daily code-breaking puzzle from [Thorstein Games](https://thorsteingames.com).

Crack the secret code: 4 pegs, each **Red, Yellow, Green or Blue** (colours can repeat, so
Blue Blue Green Blue is a valid code). You get 10 guesses. After each guess the pins beside it say
how close you are, in no particular order:

- ⚫ **Black**: right colour in the right spot.
- ⚪ **White**: right colour, wrong spot. Each secret peg counts once, and a black replaces the white it would otherwise earn.

## Features

- **Daily code**: everyone gets the same code each day, derived from the date (no server, nothing stored).
- **Wordle-style sharing**: the result shows only the pins, never the colours, so it doesn't spoil the code.
- **Challenges**: set your own code and guess limit (10–15) and send a friend a link. The code is
  scrambled in the link so it can't be read off the URL.
- Progress, stats and streaks are kept in the browser (localStorage).
- Keyboard: `1`–`4` or `R`/`Y`/`G`/`B`, `Backspace`, `Enter`.

## Development

```bash
npm install
npm run dev      # Vite dev server
npm run verify   # typecheck + unit tests
npm run build    # static site in dist/
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
