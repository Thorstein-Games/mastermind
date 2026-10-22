// localStorage I/O. Every read and write is guarded: private windows and
// blocked storage just mean progress isn't remembered.
import { COLORS, type Code, isNextDay, randomCode } from "./logic";

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
  return stats;
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
