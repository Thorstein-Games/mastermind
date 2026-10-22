import { describe, expect, it } from "vitest";
import {
  COLORS,
  type Code,
  dailyCode,
  dateKey,
  decodeChallenge,
  encodeChallenge,
  feedbackEmoji,
  isNextDay,
  randomCode,
  puzzleNumber,
  scoreGuess,
  shareText,
} from "../src/logic";

const c = (s: string): Code =>
  s.split(" ").map((w) => ({ R: "red", Y: "yellow", G: "green", B: "blue" })[w] as Code[number]);

describe("scoreGuess", () => {
  it.each([
    ["R Y G B", "R Y G B", 4, 0],
    ["R Y G B", "B G Y R", 0, 4],
    ["R Y G B", "R R R R", 1, 0],
    ["B B G B", "B G B B", 2, 2],
    ["R Y G Y", "R R B G", 1, 1],
    ["Y R G G", "G G Y R", 0, 4],
    ["R R Y Y", "Y Y Y R", 1, 2],
    ["G G G G", "R Y B R", 0, 0],
    ["R Y R Y", "Y R Y R", 0, 4],
    ["R R R Y", "Y R R R", 2, 2],
  ])("secret %s, guess %s -> %i black %i white", (secret, guess, black, white) => {
    expect(scoreGuess(c(secret), c(guess))).toEqual({ black, white });
  });

  it("never gives more pins than pegs", () => {
    for (let i = 0; i < 500; i++) {
      const rand = () => Array.from({ length: 4 }, () => COLORS[Math.floor(Math.random() * 4)]);
      const fb = scoreGuess(rand(), rand());
      expect(fb.black + fb.white).toBeLessThanOrEqual(4);
    }
  });
});

describe("daily code", () => {
  it("is the same for the same day and differs across days", () => {
    expect(dailyCode("2026-10-21")).toEqual(dailyCode("2026-10-21"));
    const codes = new Set<string>();
    for (let d = 1; d <= 60; d++) {
      const day = new Date(2026, 9, d);
      codes.add(dailyCode(dateKey(day)).join(","));
    }
    expect(codes.size).toBeGreaterThan(45);
  });

  it("only uses the four colors, four pegs", () => {
    const code = dailyCode("2027-01-01");
    expect(code).toHaveLength(4);
    for (const col of code) expect(COLORS).toContain(col);
  });

  it("uses every color in every position over time", () => {
    const seen = new Set<string>();
    for (let d = 0; d < 200; d++) {
      dailyCode(dateKey(new Date(2026, 9, 21 + d))).forEach((col, i) => seen.add(`${i}:${col}`));
    }
    expect(seen.size).toBe(16);
  });
});

describe("dates", () => {
  it("numbers puzzles from launch", () => {
    expect(puzzleNumber("2026-10-21")).toBe(1);
    expect(puzzleNumber("2026-10-22")).toBe(2);
    expect(puzzleNumber("2027-10-21")).toBe(366);
  });
  it("detects consecutive days across month and DST boundaries", () => {
    expect(isNextDay("2026-10-31", "2026-11-01")).toBe(true);
    expect(isNextDay("2027-03-13", "2027-03-14")).toBe(true);
    expect(isNextDay("2026-10-21", "2026-10-23")).toBe(false);
  });
  it("formats local dates", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("challenge links", () => {
  it("round-trips every code and guess count", () => {
    for (let n = 0; n < 256; n++) {
      const code = [6, 4, 2, 0].map((s) => COLORS[(n >> s) & 3]);
      for (let g = 10; g <= 15; g++) {
        const token = encodeChallenge({ code, maxGuesses: g });
        expect(token).toMatch(/^[0-9a-z]{5}$/);
        expect(decodeChallenge(token)).toEqual({ code, maxGuesses: g });
      }
    }
  });

  it("makes different links for the same code", () => {
    const ch = { code: c("R R R R"), maxGuesses: 10 };
    expect(encodeChallenge(ch, 1)).not.toBe(encodeChallenge(ch, 2));
  });

  it("rejects garbage and most typos", () => {
    expect(decodeChallenge(null)).toBeNull();
    expect(decodeChallenge("")).toBeNull();
    expect(decodeChallenge("abc")).toBeNull();
    expect(decodeChallenge("!!!!!")).toBeNull();
    const token = encodeChallenge({ code: c("B Y G R"), maxGuesses: 12 }, 77);
    let accepted = 0;
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    for (let i = 0; i < 5; i++) {
      for (const ch of alphabet) {
        if (ch === token[i]) continue;
        if (decodeChallenge(token.slice(0, i) + ch + token.slice(i + 1))) accepted++;
      }
    }
    expect(accepted).toBeLessThan(175 / 8);
  });

  it("rejects bad input when encoding", () => {
    expect(() => encodeChallenge({ code: c("R Y G"), maxGuesses: 10 })).toThrow();
    expect(() => encodeChallenge({ code: c("R Y G B"), maxGuesses: 16 })).toThrow();
  });
});

describe("share text", () => {
  it("shows pins but never the colors", () => {
    const text = shareText({
      title: "Mastermind #1",
      feedback: [
        { black: 1, white: 2 },
        { black: 4, white: 0 },
      ],
      solved: true,
      maxGuesses: 10,
      url: "https://thorsteingames.com/mastermind",
    });
    expect(text).toBe(
      "Mastermind #1 2/10\n\n⚫⚪⚪➖\n⚫⚫⚫⚫\n\nhttps://thorsteingames.com/mastermind",
    );
    expect(text).not.toMatch(/[🟥🟨🟩🟦]/u);
  });

  it("marks a loss with X", () => {
    const text = shareText({ title: "T", feedback: [{ black: 0, white: 0 }], solved: false, maxGuesses: 12, url: "u" });
    expect(text.startsWith("T X/12")).toBe(true);
    expect(feedbackEmoji({ black: 0, white: 0 })).toBe("➖➖➖➖");
  });
});

describe("randomCode", () => {
  it("makes 4-peg codes from the four colors", () => {
    for (let i = 0; i < 50; i++) {
      const code = randomCode();
      expect(code).toHaveLength(4);
      for (const col of code) expect(COLORS).toContain(col);
    }
    expect(randomCode(() => 0.99)).toEqual(["blue", "blue", "blue", "blue"]);
  });
});
