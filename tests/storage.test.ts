import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLORS, type Code, dailyCode } from "../src/logic";
import {
  PRACTICE_ID,
  SYNC_KEYS,
  backfillResults,
  currentStreak,
  loadResults,
  mergeSaves,
  hasSeenHelp,
  loadGuesses,
  loadPracticeCode,
  loadStats,
  markHelpSeen,
  newPracticeCode,
  recordDaily,
  saveGuesses,
} from "../src/storage";

/** Minimal in-memory localStorage. */
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal("localStorage", store);
});
afterEach(() => vi.unstubAllGlobals());

describe("guesses", () => {
  it("round-trips per game id", () => {
    saveGuesses("daily:2026-10-22", [["red", "red", "blue", "green"]]);
    saveGuesses("challenge:abcde", [["blue", "blue", "blue", "blue"]]);
    expect(loadGuesses("daily:2026-10-22")).toEqual([["red", "red", "blue", "green"]]);
    expect(loadGuesses("challenge:abcde")).toEqual([["blue", "blue", "blue", "blue"]]);
    expect(loadGuesses("daily:2026-10-23")).toEqual([]);
  });

  it("uses the mastermind. key prefix", () => {
    saveGuesses("daily:2026-10-22", []);
    expect(store.getItem("mastermind.game.daily:2026-10-22")).toBe("[]");
  });

  it("ignores corrupt or tampered data", () => {
    store.setItem("mastermind.game.x", "{not json");
    expect(loadGuesses("x")).toEqual([]);
    store.setItem("mastermind.game.y", JSON.stringify([["red", "pink", "blue", "green"], ["red", "red", "red", "red"], "nope"]));
    expect(loadGuesses("y")).toEqual([["red", "red", "red", "red"]]);
    store.setItem("mastermind.game.z", JSON.stringify({ a: 1 }));
    expect(loadGuesses("z")).toEqual([]);
  });

  it("works when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    expect(() => saveGuesses("a", [])).not.toThrow();
    expect(loadGuesses("a")).toEqual([]);
    expect(loadStats().played).toBe(0);
    expect(() => recordDaily("2026-10-22", true, 3)).not.toThrow();
    expect(loadPracticeCode()).toHaveLength(4);
  });
});

describe("daily stats and streaks", () => {
  it("starts empty", () => {
    expect(loadStats()).toMatchObject({ played: 0, wins: 0, streak: 0, bestStreak: 0, distribution: {} });
  });

  it("records a win once per day", () => {
    recordDaily("2026-10-22", true, 4);
    recordDaily("2026-10-22", true, 4); // reload of a finished game
    const s = loadStats();
    expect(s).toMatchObject({ played: 1, wins: 1, streak: 1, bestStreak: 1 });
    expect(s.distribution).toEqual({ 4: 1 });
  });

  it("builds a streak on consecutive days, across a month boundary", () => {
    recordDaily("2026-10-30", true, 3);
    recordDaily("2026-10-31", true, 5);
    recordDaily("2026-11-01", true, 3);
    const s = loadStats();
    expect(s).toMatchObject({ played: 3, wins: 3, streak: 3, bestStreak: 3 });
    expect(s.distribution).toEqual({ 3: 2, 5: 1 });
  });

  it("restarts the streak after a missed day, keeping the best", () => {
    recordDaily("2026-10-20", true, 3);
    recordDaily("2026-10-21", true, 3);
    recordDaily("2026-10-23", true, 3);
    expect(loadStats()).toMatchObject({ streak: 1, bestStreak: 2 });
  });

  it("ends the streak on a loss", () => {
    recordDaily("2026-10-21", true, 3);
    recordDaily("2026-10-22", false, 10);
    const s = loadStats();
    expect(s).toMatchObject({ played: 2, wins: 1, streak: 0, bestStreak: 1 });
    expect(currentStreak(s, "2026-10-22")).toBe(0);
    recordDaily("2026-10-23", true, 2);
    expect(loadStats().streak).toBe(1);
  });

  it("shows a streak only while it is still alive", () => {
    recordDaily("2026-10-21", true, 3);
    const s = loadStats();
    expect(currentStreak(s, "2026-10-21")).toBe(1); // solved today
    expect(currentStreak(s, "2026-10-22")).toBe(1); // today not played yet
    expect(currentStreak(s, "2026-10-23")).toBe(0); // missed a day
  });

  it("fills in fields missing from older saved stats", () => {
    store.setItem("mastermind.stats", JSON.stringify({ played: 5, wins: 4 }));
    expect(loadStats()).toMatchObject({ played: 5, wins: 4, streak: 0, bestStreak: 0, distribution: {} });
  });
});

describe("practice", () => {
  it("keeps the same code until a new round starts", () => {
    const first = loadPracticeCode();
    expect(first).toHaveLength(4);
    for (const col of first) expect(COLORS).toContain(col);
    expect(loadPracticeCode()).toEqual(first);
  });

  it("clears guesses when a new round starts", () => {
    loadPracticeCode();
    saveGuesses(PRACTICE_ID, [["red", "red", "red", "red"]]);
    newPracticeCode();
    expect(loadGuesses(PRACTICE_ID)).toEqual([]);
  });

  it("never touches daily stats", () => {
    newPracticeCode();
    saveGuesses(PRACTICE_ID, [["red", "red", "red", "red"]]);
    expect(store.getItem("mastermind.stats")).toBeNull();
  });
});

describe("help", () => {
  it("remembers that help was seen", () => {
    expect(hasSeenHelp()).toBe(false);
    markHelpSeen();
    expect(hasSeenHelp()).toBe(true);
  });
});

describe("per-day results and cloud saves", () => {
  const [STATS, RESULTS] = SYNC_KEYS;
  const wrong = (day: string): Code => {
    const c = dailyCode(day);
    return c.map((x) => (x === "red" ? "blue" : "red")) as Code;
  };

  it("syncs the stats and the per-day results", () => {
    expect(SYNC_KEYS).toEqual(["mastermind.stats", "mastermind.daily.results"]);
  });

  it("records each finished daily's result", () => {
    recordDaily("2026-10-21", true, 4);
    recordDaily("2026-10-22", false, 10);
    expect(loadResults()).toEqual({ "2026-10-21": { solved: true, guesses: 4 }, "2026-10-22": { solved: false, guesses: 10 } });
  });

  it("fills in results for days finished before they were kept, from the saved guesses", () => {
    saveGuesses("daily:2026-10-21", [wrong("2026-10-21"), dailyCode("2026-10-21")]);
    saveGuesses("daily:2026-10-22", Array(10).fill(wrong("2026-10-22")));
    saveGuesses("daily:2026-10-23", [wrong("2026-10-23")]); // still being played
    saveGuesses("challenge:abcde", [dailyCode("2026-10-21")]);
    backfillResults();
    expect(loadResults()).toEqual({ "2026-10-21": { solved: true, guesses: 2 }, "2026-10-22": { solved: false, guesses: 10 } });
  });

  const save = (results: Record<string, [boolean, number]>, stats: Record<string, unknown> = {}) => ({
    [RESULTS]: Object.fromEntries(Object.entries(results).map(([d, [solved, guesses]]) => [d, { solved, guesses }])),
    [STATS]: { played: 0, wins: 0, streak: 0, bestStreak: 0, lastWinKey: null, lastPlayedKey: null, distribution: {}, ...stats },
  });

  it("joins a winning streak played on two devices", () => {
    const phone = save({ "2026-10-21": [true, 3], "2026-10-22": [true, 5] }, { played: 2, wins: 2, streak: 2, bestStreak: 2, lastWinKey: "2026-10-22", lastPlayedKey: "2026-10-22", distribution: { 3: 1, 5: 1 } });
    const laptop = save({ "2026-10-23": [true, 4] }, { played: 1, wins: 1, streak: 1, bestStreak: 1, lastWinKey: "2026-10-23", lastPlayedKey: "2026-10-23", distribution: { 4: 1 } });
    const merged = mergeSaves(phone, laptop);
    expect(merged[STATS]).toEqual({ played: 3, wins: 3, streak: 3, bestStreak: 3, lastWinKey: "2026-10-23", lastPlayedKey: "2026-10-23", distribution: { 3: 1, 4: 1, 5: 1 } });
    expect(mergeSaves(laptop, phone)).toEqual(merged);
    expect(mergeSaves(merged, merged)).toEqual(merged);
  });

  it("a loss after the last win ends the streak; a win on either device beats a loss that day", () => {
    const lost = mergeSaves(save({ "2026-10-21": [true, 3] }), save({ "2026-10-22": [false, 10] }));
    expect(lost[STATS]).toMatchObject({ streak: 0, bestStreak: 1, wins: 1, played: 2, lastPlayedKey: "2026-10-22" });
    const both = mergeSaves(save({ "2026-10-22": [false, 10] }), save({ "2026-10-22": [true, 6] }));
    expect((both[RESULTS] as Record<string, unknown>)["2026-10-22"]).toEqual({ solved: true, guesses: 6 });
    expect(both[STATS]).toMatchObject({ streak: 1, played: 1, wins: 1 });
  });

  it("never lowers counts the results don't cover, and ignores damaged data", () => {
    const old = save({}, { played: 20, wins: 18, streak: 5, bestStreak: 9, lastWinKey: "2026-10-22", lastPlayedKey: "2026-10-22", distribution: { 4: 10, 5: 8 } });
    expect(mergeSaves(old, {})).toEqual(mergeSaves(old, old));
    expect(mergeSaves(old, {})[STATS]).toEqual(old[STATS]);
    const junk = { [RESULTS]: { nope: { solved: true, guesses: 2 }, "2026-10-22": { solved: "yes" } }, [STATS]: "x" };
    expect(mergeSaves(old, junk)).toEqual(mergeSaves(old, old));
    expect(mergeSaves({}, {})).toEqual({});
  });

  it("the merged stats load and keep counting", () => {
    const merged = mergeSaves(save({ "2026-10-21": [true, 3] }, { played: 1, wins: 1, streak: 1, bestStreak: 1, lastWinKey: "2026-10-21", lastPlayedKey: "2026-10-21", distribution: { 3: 1 } }), save({ "2026-10-22": [true, 2] }));
    for (const [k, v] of Object.entries(merged)) store.setItem(k, JSON.stringify(v));
    expect(recordDaily("2026-10-23", true, 5)).toMatchObject({ played: 3, wins: 3, streak: 3, bestStreak: 3 });
    expect(currentStreak(loadStats(), "2026-10-23")).toBe(3);
  });
});
