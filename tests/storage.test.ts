import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLORS } from "../src/logic";
import {
  PRACTICE_ID,
  currentStreak,
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
