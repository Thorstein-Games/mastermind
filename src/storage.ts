// localStorage I/O. Every read and write is guarded: private windows and
// blocked storage just mean progress isn't remembered.
import { COLORS, DAILY_GUESSES, type Code, dailyCode, isNextDay, isSolved, randomCode, scoreGuess } from "./logic";

const PREFIX = "mastermind.";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function validGuesses(value: unknown): Code[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (g): g is Code => Array.isArray(g) && g.length === 4 && g.every((c) => COLORS.includes(c)),
  );
}

/** Guesses made so far for a game: `daily:YYYY-MM-DD` or `challenge:<token>`. */
export function loadGuesses(gameId: string): Code[] {
  return validGuesses(read<unknown>(`game.${gameId}`));
}

export function saveGuesses(gameId: string, guesses: Code[]): void {
  write(`game.${gameId}`, guesses);
}

export interface Stats {
  played: number;
  wins: number;
  streak: number;
  bestStreak: number;
  /** Day of the last daily win, for the streak. */
  lastWinKey: string | null;
  /** Days already counted, so a reload never counts a day twice. */
  lastPlayedKey: string | null;
  /** distribution[n] = daily wins in n guesses. */
  distribution: Record<string, number>;
}

const EMPTY_STATS: Stats = {
  played: 0,
  wins: 0,
  streak: 0,
  bestStreak: 0,
  lastWinKey: null,
  lastPlayedKey: null,
  distribution: {},
};

export function loadStats(): Stats {
  const saved = read<Partial<Stats>>("stats") ?? {};
  // Fresh copy of distribution: recordDaily mutates it, and EMPTY_STATS must stay empty.
  return { ...EMPTY_STATS, ...saved, distribution: { ...(saved.distribution ?? {}) } };
}

/** Streak to show today: a streak that missed yesterday has already ended. */
export function currentStreak(stats: Stats, todayKey: string): number {
  if (!stats.lastWinKey) return 0;
  if (stats.lastWinKey === todayKey || isNextDay(stats.lastWinKey, todayKey)) return stats.streak;
  return 0;
}

/** Record a finished daily puzzle once. Returns the updated stats. */
export function recordDaily(dayKey: string, solved: boolean, guessCount: number): Stats {
  const stats = loadStats();
  if (stats.lastPlayedKey === dayKey) return stats;
  stats.played++;
  stats.lastPlayedKey = dayKey;
  if (solved) {
    stats.wins++;
    const continues = stats.lastWinKey !== null && isNextDay(stats.lastWinKey, dayKey);
    stats.streak = continues ? stats.streak + 1 : 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    stats.lastWinKey = dayKey;
    stats.distribution[guessCount] = (stats.distribution[guessCount] ?? 0) + 1;
  } else {
    stats.streak = 0;
  }
  write("stats", stats);
  saveResult(dayKey, { solved, guesses: guessCount });
  return stats;
}

/* ---- per-day results and cloud saves ---- */

/** How one daily puzzle ended. */
export interface DayResult {
  solved: boolean;
  guesses: number;
}
type Results = Record<string, DayResult>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validResults(value: unknown): Results {
  const out: Results = {};
  if (!value || typeof value !== "object") return out;
  for (const [day, r] of Object.entries(value as Record<string, unknown>)) {
    const { solved, guesses } = (r ?? {}) as Record<string, unknown>;
    if (DAY.test(day) && typeof solved === "boolean" && Number.isInteger(guesses) && (guesses as number) >= 1 && (guesses as number) <= DAILY_GUESSES) {
      out[day] = { solved, guesses: guesses as number };
    }
  }
  return out;
}

/** Every finished daily puzzle, by day. */
export function loadResults(): Results {
  return validResults(read<unknown>("daily.results"));
}

function saveResult(dayKey: string, result: DayResult): void {
  write("daily.results", { ...loadResults(), [dayKey]: result });
}

/**
 * Fills the per-day results in from each day's saved guesses, for games
 * finished before results were kept (the guesses say how each one ended).
 */
export function backfillResults(): void {
  const results = loadResults();
  let added = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const m = /^mastermind\.game\.daily:(\d{4}-\d{2}-\d{2})$/.exec(localStorage.key(i) ?? "");
      if (!m || results[m[1]]) continue;
      const guesses = loadGuesses(`daily:${m[1]}`).slice(0, DAILY_GUESSES);
      const solved = guesses.some((g) => isSolved(scoreGuess(dailyCode(m[1]), g)));
      if (!solved && guesses.length < DAILY_GUESSES) continue; // not finished
      results[m[1]] = { solved, guesses: solved ? guesses.findIndex((g) => isSolved(scoreGuess(dailyCode(m[1]), g))) + 1 : guesses.length };
      added = true;
    }
  } catch {
    return;
  }
  if (added) write("daily.results", results);
}

/** localStorage keys that follow a signed-in player to other devices (Thorstein Games accounts). */
export const SYNC_KEYS = [PREFIX + "stats", PREFIX + "daily.results"];

/**
 * Combines two devices' saves ({ localStorage key: parsed value }): every
 * finished day (a win beats a loss, then fewer guesses), with the stats
 * worked out again from them. Counts from before results were kept are
 * never lowered. Order doesn't matter: merge(a, b) = merge(b, a).
 */
export function mergeSaves(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const [STATS, RESULTS] = SYNC_KEYS;
  const ra = validResults(a[RESULTS]);
  const rb = validResults(b[RESULTS]);
  const results: Results = {};
  for (const day of [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort()) {
    const x = ra[day];
    const y = rb[day];
    results[day] =
      !x || !y ? x || y : x.solved !== y.solved ? (x.solved ? x : y) : x.guesses <= y.guesses ? x : y;
  }

  const stats = (v: unknown): Stats => {
    const s = (v && typeof v === "object" ? v : {}) as Partial<Stats>;
    const n = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : 0);
    const day = (x: unknown) => (typeof x === "string" && DAY.test(x) ? x : null);
    const distribution: Record<string, number> = {};
    for (const [k, c] of Object.entries(s.distribution && typeof s.distribution === "object" ? s.distribution : {})) {
      if (/^\d+$/.test(k) && n(c)) distribution[k] = n(c);
    }
    return {
      played: n(s.played),
      wins: n(s.wins),
      streak: n(s.streak),
      bestStreak: n(s.bestStreak),
      lastWinKey: day(s.lastWinKey),
      lastPlayedKey: day(s.lastPlayedKey),
      distribution,
    };
  };
  const sa = stats(a[STATS]);
  const sb = stats(b[STATS]);
  const days = Object.keys(results);
  const wins = days.filter((d) => results[d].solved);
  const latest = (...keys: (string | null | undefined)[]) =>
    keys.filter((k): k is string => !!k).sort().pop() ?? null;
  const lastWinKey = latest(sa.lastWinKey, sb.lastWinKey, wins[wins.length - 1]);
  const lastPlayedKey = latest(sa.lastPlayedKey, sb.lastPlayedKey, days[days.length - 1]);

  // Winning runs: consecutive days, all won.
  let best = 0;
  let run = 0;
  let runAtLastWin = 0;
  days.forEach((d, i) => {
    if (!results[d].solved) run = 0;
    else run = run > 0 && isNextDay(days[i - 1], d) ? run + 1 : 1;
    best = Math.max(best, run);
    if (d === lastWinKey) runAtLastWin = run;
  });
  // A loss after the last win ended the streak.
  const lostSince = lastPlayedKey !== null && lastWinKey !== null && lastPlayedKey > lastWinKey && results[lastPlayedKey]?.solved === false;
  const own = (s: Stats) => (s.lastWinKey === lastWinKey && s.lastPlayedKey === lastPlayedKey ? s.streak : 0);
  const streak = lastWinKey === null || lostSince ? 0 : Math.max(runAtLastWin, own(sa), own(sb));

  const distribution: Record<string, number> = {};
  for (const d of wins) distribution[results[d].guesses] = (distribution[results[d].guesses] ?? 0) + 1;
  for (const k of new Set([...Object.keys(sa.distribution), ...Object.keys(sb.distribution)])) {
    distribution[k] = Math.max(distribution[k] ?? 0, sa.distribution[k] ?? 0, sb.distribution[k] ?? 0);
  }

  const out: Record<string, unknown> = {};
  if (STATS in a || STATS in b || days.length) {
    out[STATS] = {
      played: Math.max(sa.played, sb.played, days.length),
      wins: Math.max(sa.wins, sb.wins, wins.length),
      streak,
      bestStreak: Math.max(sa.bestStreak, sb.bestStreak, best, streak),
      lastWinKey,
      lastPlayedKey,
      distribution,
    } satisfies Stats;
  }
  if (RESULTS in a || RESULTS in b) out[RESULTS] = results;
  return out;
}

export function hasSeenHelp(): boolean {
  return read<boolean>("seenHelp") === true;
}

export function markHelpSeen(): void {
  write("seenHelp", true);
}

/** Game id for the current practice round's guesses. */
export const PRACTICE_ID = "practice";

/** The current practice code, or a new one (with no guesses) if there isn't one. */
export function loadPracticeCode(): Code {
  const saved = validGuesses([read<unknown>("practice.code")])[0];
  return saved ?? newPracticeCode();
}

/** Start a new practice round: a fresh random code and no guesses. */
export function newPracticeCode(): Code {
  const code = randomCode();
  write("practice.code", code);
  saveGuesses(PRACTICE_ID, []);
  return code;
}
