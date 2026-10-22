import "./style.css";
import {
  CODE_LENGTH,
  COLORS,
  COLOR_LABEL,
  DAILY_GUESSES,
  MAX_GUESSES,
  MIN_GUESSES,
  type Code,
  type Color,
  type Feedback,
  dailyCode,
  dateKey,
  decodeChallenge,
  encodeChallenge,
  isSolved,
  puzzleNumber,
  scoreGuess,
  shareText,
} from "./logic";
import {
  currentStreak,
  hasSeenHelp,
  loadGuesses,
  loadStats,
  markHelpSeen,
  recordDaily,
  saveGuesses,
  PRACTICE_ID,
  loadPracticeCode,
  newPracticeCode,
} from "./storage";

// ---------- Shared Thorstein Games bar ----------
// VITE_TG_BAR_SRC="" turns it off (tests, offline dev); the tags stay so layout doesn't change.
const TG_BAR_SRC = import.meta.env.VITE_TG_BAR_SRC ?? "https://thorsteingames.com/tg-bar.js";
if (TG_BAR_SRC) {
  const s = document.createElement("script");
  s.src = TG_BAR_SRC;
  s.async = true;
  document.head.appendChild(s);
}

// ---------- Small DOM helpers ----------

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

function peg(color: Color | null, extra = ""): HTMLElement {
  return h("span", {
    class: `peg ${color ? `peg-${color}` : "peg-empty"} ${extra}`.trim(),
    role: "img",
    "aria-label": color ? COLOR_LABEL[color] : "Empty",
  });
}

function feedbackPins(fb: Feedback | null): HTMLElement {
  const box = h("span", {
    class: "pins",
    role: "img",
    "aria-label": fb ? `${fb.black} black, ${fb.white} white` : "No feedback yet",
  });
  for (let i = 0; i < CODE_LENGTH; i++) {
    const kind = !fb ? "none" : i < fb.black ? "black" : i < fb.black + fb.white ? "white" : "none";
    box.append(h("span", { class: `pin pin-${kind}` }));
  }
  return box;
}

// Line icons (24x24, stroke = currentColor).
const ICONS = {
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.5-2.8 4.2"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/>',
  stats: '<path d="M5 20V12M12 20V5M19 20v-9"/>',
  practice: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
  share: '<path d="M12 3v12"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-2"/>',
} as const;

function icon(name: keyof typeof ICONS): SVGElement {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

const app = document.getElementById("app")!;

// ---------- Routing ----------
// /            today's daily code
// ?c=<token>   a friend's challenge (&from=<name>)
// ?create      make a challenge
// ?practice    random codes, as many as you like (no stats)

const baseUrl = location.origin + location.pathname;

function go(search: string): void {
  // Same screen again (e.g. practice "Play again"): replace, so Back still leaves it.
  if (location.search === search) history.replaceState(null, "", baseUrl + search);
  else history.pushState(null, "", baseUrl + search);
  route();
}

// Only a change of query string is a new screen; a #hash change is just an
// in-page jump (the footer's How to Play / FAQ links).
let routedSearch: string | null = null;
window.addEventListener("popstate", () => {
  if (location.search !== routedSearch) route();
});

let cleanup: (() => void) | null = null;

function route(): void {
  cleanup?.();
  cleanup = null;
  routedSearch = location.search;
  const p = new URLSearchParams(location.search);
  if (!location.hash) window.scrollTo(0, 0);
  if (p.has("create")) return renderCreate();
  if (p.has("practice")) {
    return renderGame({
      id: PRACTICE_ID,
      secret: loadPracticeCode(),
      maxGuesses: DAILY_GUESSES,
      kind: "practice",
      heading: "Practice",
      shareTitle: "Mastermind practice",
      shareUrl: baseUrl,
    });
  }
  const token = p.get("c");
  if (token !== null) {
    const ch = decodeChallenge(token);
    if (!ch) return renderBadChallenge();
    const from = (p.get("from") ?? "").trim().slice(0, 24);
    return renderGame({
      id: `challenge:${token.toLowerCase()}`,
      secret: ch.code,
      maxGuesses: ch.maxGuesses,
      kind: "challenge",
      heading: from ? `Challenge from ${from}` : "Friend's challenge",
      shareTitle: from ? `Mastermind: ${from}'s challenge` : "Mastermind challenge",
      shareUrl: location.href,
    });
  }
  const key = dateKey();
  renderGame({
    id: `daily:${key}`,
    secret: dailyCode(key),
    maxGuesses: DAILY_GUESSES,
    kind: "daily",
    dayKey: key,
    heading: `Daily #${puzzleNumber(key)}`,
    shareTitle: `Mastermind #${puzzleNumber(key)}`,
    shareUrl: baseUrl,
  });
}

// ---------- Header + dialogs ----------

function header(subtitle: string): HTMLElement {
  return h(
    "header",
    { class: "game-header" },
    h(
      "div",
      { class: "title-block" },
      h(
        "h1",
        {},
        h(
          "a",
          {
            href: baseUrl,
            title: "Today's puzzle",
            onclick: (e: Event) => {
              e.preventDefault();
              go("");
            },
          },
          "Mastermind",
        ),
      ),
      h("p", { class: "subtitle" }, subtitle),
    ),
    h(
      "nav",
      { class: "header-actions", "aria-label": "Game menu" },
      h("button", { class: "icon-btn", "aria-label": "How to play", title: "How to play", onclick: openHelp }, icon("help")),
      h("button", { class: "icon-btn", "aria-label": "Statistics", title: "Statistics", onclick: openStats }, icon("stats")),
      h(
        "button",
        { class: "icon-btn", "aria-label": "Practice", title: "Practice: play a random code", onclick: () => go("?practice") },
        icon("practice"),
      ),
      h(
        "button",
        { class: "icon-btn", "aria-label": "Challenge a friend", title: "Challenge a friend", onclick: () => go("?create") },
        icon("share"),
      ),
    ),
  );
}

function dialog(title: string, ...body: (Node | string)[]): HTMLDialogElement {
  const d = h(
    "dialog",
    { class: "modal", "aria-label": title },
    h(
      "div",
      { class: "modal-head" },
      h("h2", {}, title),
      h("button", { class: "icon-btn", "aria-label": "Close", onclick: () => d.close() }, "✕"),
    ),
    ...body,
  );
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close(); // backdrop click
  });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

function exampleRow(code: Code, fb: Feedback, text: string): HTMLElement {
  return h(
    "div",
    { class: "example" },
    h("div", { class: "row-pegs" }, ...code.map((c) => peg(c, "peg-sm"))),
    feedbackPins(fb),
    h("p", {}, text),
  );
}

function openHelp(): void {
  markHelpSeen();
  dialog(
    "How to play",
    h(
      "p",
      {},
      "Crack the secret code: 4 pegs, each Red, Yellow, Green or Blue. Colors can repeat, so ",
      h("em", {}, "Blue Blue Green Blue"),
      " is a possible code.",
    ),
    h("p", {}, `You have ${DAILY_GUESSES} guesses. After each one, the pins beside it tell you how close you are:`),
    h(
      "ul",
      { class: "pin-legend" },
      h("li", {}, h("span", { class: "pin pin-black" }), " Black: right color in the right spot."),
      h("li", {}, h("span", { class: "pin pin-white" }), " White: right color, wrong spot."),
    ),
    h("p", {}, "The pins are in no particular order, so they don't say which peg they mean. Each secret peg counts once."),
    exampleRow(["red", "red", "blue", "green"], { black: 1, white: 1 }, "If the code is Red Yellow Green Yellow: one Red is exact (black), the Green is in the wrong spot (white)."),
    h(
      "p",
      {},
      "A new code every day at midnight. Want more? ",
      h("span", { class: "inline-icon" }, icon("practice")),
      " Practice plays random codes. ",
      h("span", { class: "inline-icon" }, icon("share")),
      " sends a friend your own code to crack.",
    ),
    h("p", { class: "muted" }, "Keyboard: 1–4 or R/Y/G/B to add a color, Backspace to remove, Enter to guess."),
  );
}

function openStats(): void {
  const stats = loadStats();
  const today = dateKey();
  const maxCount = Math.max(1, ...Object.values(stats.distribution));
  const bars = h("div", { class: "dist" });
  for (let n = 1; n <= DAILY_GUESSES; n++) {
    const count = stats.distribution[n] ?? 0;
    bars.append(
      h(
        "div",
        { class: "dist-row" },
        h("span", { class: "dist-n" }, String(n)),
        h(
          "span",
          { class: "dist-bar", style: `width: ${Math.max(8, (count / maxCount) * 100)}%` },
          String(count),
        ),
      ),
    );
  }
  const stat = (value: number | string, label: string) =>
    h("div", { class: "stat" }, h("strong", {}, String(value)), h("span", {}, label));
  dialog(
    "Statistics",
    h(
      "div",
      { class: "stats-grid" },
      stat(stats.played, "Played"),
      stat(stats.played ? `${Math.round((stats.wins / stats.played) * 100)}%` : "0%", "Win %"),
      stat(currentStreak(stats, today), "Streak"),
      stat(stats.bestStreak, "Best streak"),
    ),
    h("h3", {}, "Daily guesses"),
    bars,
  );
}

document.addEventListener("click", (e) => {
  const link = (e.target as Element | null)?.closest?.("[data-open-help]");
  if (link) {
    e.preventDefault();
    openHelp();
  }
});

// ---------- Sharing ----------

async function shareOrCopy(text: string, button: HTMLButtonElement): Promise<void> {
  const label = button.textContent;
  // Phones get the share sheet; desktops copy, which is what people expect there.
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied!";
  } catch {
    window.prompt("Copy this:", text);
  }
  setTimeout(() => (button.textContent = label), 1800);
}

// ---------- The game ----------

interface GameConfig {
  id: string;
  secret: Code;
  maxGuesses: number;
  kind: "daily" | "challenge" | "practice";
  dayKey?: string;
  heading: string;
  shareTitle: string;
  shareUrl: string;
}

function renderGame(cfg: GameConfig): void {
  const guesses = loadGuesses(cfg.id).slice(0, cfg.maxGuesses);
  let feedback = guesses.map((g) => scoreGuess(cfg.secret, g));
  let current: (Color | null)[] = Array(CODE_LENGTH).fill(null);

  let stopTimer: (() => void) | null = null;
  const solved = () => feedback.some(isSolved);
  const over = () => solved() || guesses.length >= cfg.maxGuesses;

  const boardEl = h("section", { class: "history", "aria-label": "Your guesses" });
  const panelEl = h("section", { class: "play-panel" });
  const statusEl = h("p", { class: "status", role: "status", "aria-live": "polite" });

  app.replaceChildren(
    h(
      "main",
      { class: "game" },
      header(cfg.heading),
      h("div", { class: "workspace" }, panelEl, boardEl),
    ),
  );

  function renderBoard(): void {
    const rows: HTMLElement[] = [];
    for (let i = 0; i < cfg.maxGuesses; i++) {
      const g = guesses[i];
      const active = i === guesses.length && !over();
      rows.push(
        h(
          "li",
          { class: `row ${g ? "row-done" : ""} ${active ? "row-active" : ""}`.trim() },
          h("span", { class: "row-n" }, String(i + 1)),
          h(
            "span",
            { class: "row-pegs" },
            ...(g ?? (active ? current : Array(CODE_LENGTH).fill(null))).map((c) => peg(c, "peg-sm")),
          ),
          feedbackPins(g ? feedback[i] : null),
        ),
      );
    }
    const left = cfg.maxGuesses - guesses.length;
    boardEl.replaceChildren(
      h(
        "div",
        { class: "history-head" },
        h("h2", {}, "Guesses"),
        h("span", { class: "muted" }, over() ? `${guesses.length}/${cfg.maxGuesses}` : `${left} left`),
      ),
      h("ol", { class: "rows" }, ...rows),
    );
  }

  function addColor(c: Color): void {
    if (over()) return;
    const i = current.indexOf(null);
    if (i < 0) return;
    current[i] = c;
    statusEl.textContent = "";
    refresh();
  }

  function removeLast(): void {
    if (over()) return;
    for (let i = CODE_LENGTH - 1; i >= 0; i--) {
      if (current[i]) {
        current[i] = null;
        break;
      }
    }
    refresh();
  }

  function submit(): void {
    if (over()) return;
    if (current.includes(null)) {
      statusEl.textContent = "Fill all 4 spots first.";
      return;
    }
    const g = current as Code;
    guesses.push(g);
    feedback = guesses.map((x) => scoreGuess(cfg.secret, x));
    current = Array(CODE_LENGTH).fill(null);
    saveGuesses(cfg.id, guesses);
    if (over() && cfg.kind === "daily" && cfg.dayKey) recordDaily(cfg.dayKey, solved(), guesses.length);
    refresh();
    if (over()) panelEl.querySelector<HTMLElement>(".result h2")?.focus();
  }

  function renderInput(): void {
    const slots = h(
      "div",
      { class: "slots", "aria-label": "Your next guess" },
      ...current.map((c, i) =>
        h(
          "button",
          {
            class: `slot ${c ? `peg-${c}` : ""}`,
            "aria-label": c ? `Spot ${i + 1}: ${COLOR_LABEL[c]} (tap to clear)` : `Spot ${i + 1}: empty`,
            onclick: () => {
              if (current[i]) {
                current[i] = null;
                refresh();
              }
            },
          },
        ),
      ),
    );
    const palette = h(
      "div",
      { class: "palette", "aria-label": "Colors" },
      ...COLORS.map((c, i) =>
        h(
          "button",
          { class: `swatch peg-${c}`, "aria-label": `Add ${COLOR_LABEL[c]}`, title: `${COLOR_LABEL[c]} (${i + 1})`, onclick: () => addColor(c) },
          h("span", { class: "swatch-key" }, String(i + 1)),
        ),
      ),
    );
    const full = !current.includes(null);
    const empty = current.every((c) => c === null);
    panelEl.replaceChildren(
      h("p", { class: "prompt" }, `Guess ${guesses.length + 1} of ${cfg.maxGuesses}`),
      slots,
      palette,
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn btn-ghost", onclick: removeLast, disabled: empty }, "⌫ Delete"),
        h("button", { class: "btn btn-primary", onclick: submit, disabled: !full }, "Guess"),
      ),
      statusEl,
      h(
        "p",
        { class: "legend muted" },
        h("span", { class: "pin pin-black" }),
        " right color & spot  ",
        h("span", { class: "pin pin-white" }),
        " right color, wrong spot",
      ),
    );
  }

  function renderResult(): void {
    const won = solved();
    const text = shareText({
      title: cfg.shareTitle,
      feedback,
      solved: won,
      maxGuesses: cfg.maxGuesses,
      url: cfg.shareUrl,
    });
    const practice = cfg.kind === "practice";
    const shareBtn = h(
      "button",
      { class: `btn ${practice ? "btn-ghost" : "btn-primary"}`, onclick: () => shareOrCopy(text, shareBtn) },
      "Share result",
    );
    const practiceBtn = h(
      "button",
      {
        class: `btn ${practice ? "btn-primary" : "btn-ghost"}`,
        onclick: () => {
          if (practice) newPracticeCode();
          go("?practice");
        },
      },
      practice ? "Play again" : "Practice",
    );
    const countdown = h("p", { class: "countdown muted" });
    const result = h(
      "div",
      { class: `result ${won ? "won" : "lost"}` },
      h(
        "h2",
        { tabindex: -1 },
        won ? (guesses.length === 1 ? "First try. Unreal!" : `Cracked it in ${guesses.length}!`) : "Out of guesses",
      ),
      h("p", { class: "muted" }, "Answer:"),
      h("div", { class: "row-pegs reveal" }, ...cfg.secret.map((c) => peg(c))),
      h("pre", { class: "share-preview", "aria-label": "Share preview" }, text.split("\n\n").slice(0, 2).join("\n\n")),
      h(
        "div",
        { class: "actions" },
        ...(practice ? [practiceBtn, shareBtn] : [shareBtn, practiceBtn]),
        cfg.kind === "daily"
          ? h("button", { class: "btn btn-ghost", onclick: () => go("?create") }, "Challenge a friend")
          : h("button", { class: "btn btn-ghost", onclick: () => go("") }, "Today's puzzle"),
      ),
      cfg.kind === "daily" ? countdown : null,
    );
    if (cfg.kind === "daily") {
      const tick = () => {
        if (dateKey() !== cfg.dayKey) return route(); // past midnight: today's new puzzle
        const now = new Date();
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const s = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 1000));
        const pad = (n: number) => String(n).padStart(2, "0");
        countdown.textContent = `Next code in ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
      };
      tick();
      stopTimer?.();
      const timer = setInterval(tick, 1000);
      stopTimer = () => clearInterval(timer);
    }
    panelEl.replaceChildren(
      result,
      h(
        "div",
        { class: "finish-extras" },
        h("tg-more-games" as keyof HTMLElementTagNameMap, { game: "mastermind" }),
        h("tg-ad" as keyof HTMLElementTagNameMap, { game: "mastermind", format: "box", class: "finish-ad" }),
      ),
    );
  }

  function refresh(): void {
    renderBoard();
    if (over()) {
      if (!panelEl.querySelector(".result")) renderResult();
    } else {
      renderInput();
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
    const t = e.target as HTMLElement;
    if (t.matches("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    const byKey: Record<string, Color> = { "1": "red", "2": "yellow", "3": "green", "4": "blue", r: "red", y: "yellow", g: "green", b: "blue" };
    if (byKey[k]) addColor(byKey[k]);
    else if (k === "backspace" || k === "delete") removeLast();
    else if (k === "enter" && !t.matches("button")) submit();
    else return;
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  cleanup = () => {
    document.removeEventListener("keydown", onKey);
    stopTimer?.();
  };

  refresh();

  if (cfg.kind === "daily" && guesses.length === 0 && !hasSeenHelp()) openHelp();
}

function renderBadChallenge(): void {
  app.replaceChildren(
    h(
      "main",
      { class: "game" },
      header("Challenge"),
      h(
        "div",
        { class: "card center" },
        h("h2", {}, "That challenge link doesn't work"),
        h("p", { class: "muted" }, "It may have been cut off when it was copied. Ask your friend to send it again."),
        h(
          "div",
          { class: "actions" },
          h("button", { class: "btn btn-primary", onclick: () => go("") }, "Play today's puzzle"),
        ),
      ),
    ),
  );
}

// ---------- Make a challenge ----------

function renderCreate(): void {
  const code: Color[] = ["red", "yellow", "green", "blue"];
  let maxGuesses = 10;
  let link = "";

  const slots = h("div", { class: "slots" });
  const out = h("div", { class: "challenge-out" });
  const nameInput = h("input", {
    type: "text",
    id: "from-name",
    maxlength: 24,
    placeholder: "Optional",
    autocomplete: "nickname",
  }) as HTMLInputElement;

  function renderSlots(): void {
    slots.replaceChildren(
      ...code.map((c, i) =>
        h("button", {
          class: `slot peg-${c}`,
          "aria-label": `Spot ${i + 1}: ${COLOR_LABEL[c]}. Tap to change color.`,
          onclick: () => {
            code[i] = COLORS[(COLORS.indexOf(code[i]) + 1) % COLORS.length];
            invalidate();
          },
        }),
      ),
    );
  }

  function invalidate(): void {
    link = "";
    renderSlots();
    out.replaceChildren();
  }

  function randomize(): void {
    for (let i = 0; i < CODE_LENGTH; i++) code[i] = COLORS[Math.floor(Math.random() * COLORS.length)];
    invalidate();
  }

  const guessSelect = h(
    "select",
    { id: "max-guesses", onchange: (e: Event) => ((maxGuesses = Number((e.target as HTMLSelectElement).value)), invalidate()) },
    ...Array.from({ length: MAX_GUESSES - MIN_GUESSES + 1 }, (_, i) => {
      const n = MIN_GUESSES + i;
      return h("option", { value: n, selected: n === maxGuesses }, `${n} guesses`);
    }),
  );
  nameInput.addEventListener("input", () => (link ? makeLink() : undefined));

  function makeLink(): void {
    const name = nameInput.value.trim();
    const qs = new URLSearchParams({ c: encodeChallenge({ code: [...code], maxGuesses }) });
    if (name) qs.set("from", name);
    link = `${baseUrl}?${qs}`;
    const message = `Can you crack my Mastermind code? You get ${maxGuesses} guesses.\n${link}`;
    const shareBtn = h("button", { class: "btn btn-primary", onclick: () => shareOrCopy(message, shareBtn) }, "Send to a friend");
    out.replaceChildren(
      h("label", { for: "challenge-link" }, "Your challenge link"),
      h("input", { id: "challenge-link", type: "text", readonly: true, value: link, onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
      h("div", { class: "actions" }, shareBtn),
      h("p", { class: "muted small" }, "Opening the link yourself starts the puzzle, so don't peek at it with your friend's phone."),
    );
  }

  renderSlots();
  app.replaceChildren(
    h(
      "main",
      { class: "game" },
      header("Make a challenge"),
      h(
        "div",
        { class: "card create" },
        h("h2", {}, "Set a secret code"),
        h("p", { class: "muted" }, "Tap a peg to change its color. Colors can repeat."),
        slots,
        h(
          "div",
          { class: "actions" },
          h("button", { class: "btn btn-ghost", onclick: randomize }, "🎲 Random"),
        ),
        h(
          "div",
          { class: "fields" },
          h("label", { for: "max-guesses" }, "Guesses allowed"),
          guessSelect,
          h("label", { for: "from-name" }, "Your name"),
          nameInput,
        ),
        h("div", { class: "actions" }, h("button", { class: "btn btn-primary", onclick: makeLink }, "Create challenge link")),
        out,
        h("div", { class: "actions" }, h("button", { class: "btn btn-link", onclick: () => go("") }, "← Back to today's puzzle")),
      ),
    ),
  );
}

route();
