// Pure game logic: no DOM, no storage. Covered by tests/logic.test.ts.

export const COLORS = ["red", "yellow", "green", "blue"] as const;
export type Color = (typeof COLORS)[number];
export type Code = Color[];

export const CODE_LENGTH = 4;
export const DAILY_GUESSES = 10;
export const MIN_GUESSES = 10;
export const MAX_GUESSES = 15;

/** Puzzle #1 is this day; the daily number counts up from it. */
export const LAUNCH_KEY = "2026-10-21";

export const COLOR_LABEL: Record<Color, string> = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
};

export const COLOR_EMOJI: Record<Color, string> = {
  red: "🟥",
  yellow: "🟨",
  green: "🟩",
  blue: "🟦",
};

export interface Feedback {
  /** Right colour in the right spot. */
  black: number;
  /** Right colour in the wrong spot (each secret peg counts once). */
  white: number;
}

/**
 * Score a guess against the secret. A colour can only be matched as many
 * times as it appears in the secret, and an exact match (black) replaces the
 * white it would otherwise have earned.
 */
export function scoreGuess(secret: Code, guess: Code): Feedback {
  let black = 0;
  const secretLeft: Record<string, number> = {};
  const guessLeft: Record<string, number> = {};
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) {
      black++;
    } else {
      secretLeft[secret[i]] = (secretLeft[secret[i]] ?? 0) + 1;
      guessLeft[guess[i]] = (guessLeft[guess[i]] ?? 0) + 1;
    }
  }
  let white = 0;
  for (const c of Object.keys(guessLeft)) {
    white += Math.min(guessLeft[c], secretLeft[c] ?? 0);
  }
  return { black, white };
}

export function isSolved(fb: Feedback): boolean {
  return fb.black === CODE_LENGTH;
}

// ---------- Dates ----------

/** Local calendar day as YYYY-MM-DD (everyone gets the new code at their own midnight). */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function keyToUtcDays(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** 1 on launch day, 2 the day after, ... */
export function puzzleNumber(key: string): number {
  return keyToUtcDays(key) - keyToUtcDays(LAUNCH_KEY) + 1;
}

/** Whether `b` is the day right after `a`. */
export function isNextDay(a: string, b: string): boolean {
  return keyToUtcDays(b) - keyToUtcDays(a) === 1;
}

// ---------- Daily code ----------

/** FNV-1a 32-bit. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small seeded PRNG, returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The secret for a given day. Same day in, same code out, so nothing is stored. */
export function dailyCode(key: string): Code {
  const rand = mulberry32(hashString(`mastermind:${key}`));
  return Array.from({ length: CODE_LENGTH }, () => COLORS[Math.floor(rand() * COLORS.length)]);
}

// ---------- Challenge links ----------

export interface Challenge {
  code: Code;
  maxGuesses: number;
}

const CHALLENGE_SALT_BITS = 8;
const CHALLENGE_DATA_BITS = 11; // 8 bits of colours + 3 bits of (guesses - 10)
const CHALLENGE_CHECK_BITS = 5;

function challengeMask(salt: number): number {
  return hashString(`mm-mask:${salt}`) & ((1 << CHALLENGE_DATA_BITS) - 1);
}

function challengeCheck(salt: number, data: number): number {
  return hashString(`mm-check:${salt}:${data}`) & ((1 << CHALLENGE_CHECK_BITS) - 1);
}

/**
 * Pack a challenge into a short token for a link. It's scrambled with a
 * random salt so the friend can't read the code off the URL (and the same
 * code makes a different link each time), with a checksum so a mistyped
 * link is rejected instead of starting a wrong puzzle.
 */
export function encodeChallenge(ch: Challenge, salt = Math.floor(Math.random() * 256)): string {
  if (ch.code.length !== CODE_LENGTH) throw new Error("bad code length");
  if (ch.maxGuesses < MIN_GUESSES || ch.maxGuesses > MAX_GUESSES) throw new Error("bad guess count");
  let colours = 0;
  for (const c of ch.code) {
    const i = COLORS.indexOf(c);
    if (i < 0) throw new Error(`bad colour ${c}`);
    colours = (colours << 2) | i;
  }
  const data = colours | ((ch.maxGuesses - MIN_GUESSES) << 8);
  const s = salt & ((1 << CHALLENGE_SALT_BITS) - 1);
  const packed =
    (((s << CHALLENGE_DATA_BITS) | (data ^ challengeMask(s))) << CHALLENGE_CHECK_BITS) |
    challengeCheck(s, data);
  // 24 bits -> 5 base36 characters, padded so every token is the same length.
  return packed.toString(36).padStart(5, "0");
}

export function decodeChallenge(token: string | null | undefined): Challenge | null {
  if (!token || !/^[0-9a-z]{5}$/i.test(token)) return null;
  const packed = parseInt(token.toLowerCase(), 36);
  if (!Number.isFinite(packed) || packed >= 1 << 24) return null;
  const check = packed & ((1 << CHALLENGE_CHECK_BITS) - 1);
  const rest = packed >>> CHALLENGE_CHECK_BITS;
  const s = rest >>> CHALLENGE_DATA_BITS;
  const data = (rest & ((1 << CHALLENGE_DATA_BITS) - 1)) ^ challengeMask(s);
  if (challengeCheck(s, data) !== check) return null;
  const maxGuesses = MIN_GUESSES + (data >>> 8);
  if (maxGuesses > MAX_GUESSES) return null;
  const code: Code = [];
  for (let i = CODE_LENGTH - 1; i >= 0; i--) code.push(COLORS[(data >>> (i * 2)) & 3]);
  return { code, maxGuesses };
}

// ---------- Share text ----------

/** One row of feedback pegs: blacks first, then whites, then empties (order carries no meaning). */
export function feedbackEmoji(fb: Feedback): string {
  return "⚫".repeat(fb.black) + "⚪".repeat(fb.white) + "➖".repeat(CODE_LENGTH - fb.black - fb.white);
}

export interface ShareInput {
  title: string;
  feedback: Feedback[];
  solved: boolean;
  maxGuesses: number;
  url: string;
}

/** Wordle-style result: only the pegs, never the colours, so it can't spoil the code. */
export function shareText({ title, feedback, solved, maxGuesses, url }: ShareInput): string {
  const score = solved ? `${feedback.length}/${maxGuesses}` : `X/${maxGuesses}`;
  const rows = feedback.map(feedbackEmoji).join("\n");
  return `${title} ${score}\n\n${rows}\n\n${url}`;
}
