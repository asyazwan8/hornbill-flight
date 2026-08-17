import type { PoseStatus } from "../pose/GestureMapper";
import type { LeaderboardEntry } from "../leaderboard/Leaderboard";
import { PoseKeyboard } from "./PoseKeyboard";

/** What the leaderboard section should currently be showing. */
export type BoardView =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "entries"; entries: LeaderboardEntry[]; highlightId?: string };

/** Everything the run summary puts on screen. */
export type SummaryStats = {
  stars: number;
  airtimeSeconds: number;
  bestCombo: number;
  crashed: boolean;
  /** Placement on the board, when it is known. */
  rank?: number;
  rankMessage?: string;
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

/** Seconds as m:ss, which is how the design shows the clock. */
export const asClock = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** Below this the altitude meter goes into its low-altitude alarm. */
const LOW_ALTITUDE = 0.3;

/**
 * How long the run summary sits before the game drops back to its attract
 * screen. This is a game played standing in a room: whoever just flew has
 * walked off, and the next person should find the title inviting them in
 * rather than a stranger's score.
 */
const IDLE_RETURN_MS = 10000;

/** How long the result must have been up before hands-up can end the flight. */
const END_GESTURE_ARM_MS = 1500;

/** Matches the CHECK constraint on the table; see supabase/schema.sql. */
const MAX_NAME = 16;

/** The pose captions, in the design's clipped uppercase voice. */
const POSE_CAPTION: Record<PoseStatus, string> = {
  "no-pose": "STEP INTO VIEW",
  partial: "GET FULLY IN FRAME",
  tracking: "READY",
  tpose: "WINGS OUT",
  dive: "DIVING",
};

/** All the DOM chrome: HUD meters, screens, panels and buttons. */
export class Hud {
  private hud = $("hud");
  private scoreCounter = $("hud-score");
  private scoreValue = $("hud-score").querySelector(".value") as HTMLElement;
  private timerPanel = $("hud-timer");
  private timerValue = $("hud-timer").querySelector(".value") as HTMLElement;
  private timerFill = $("hud-timer").querySelector(".meter-fill") as HTMLElement;
  private altPanel = $("hud-altitude");
  private altValue = $("hud-altitude").querySelector(".value") as HTMLElement;
  private altFill = $("hud-altitude").querySelector(".meter-fill") as HTMLElement;
  private combo = $("combo");
  private bonus = $("bonus");
  private bonusGain = $("bonus").querySelector(".toast-gain") as HTMLElement;
  private bonusNote = $("bonus").querySelector(".toast-note") as HTMLElement;

  private titleScreen = $("title-screen");
  private titleTop = $("title-top");
  private titleBottom = $("title-bottom");
  private titleMessage = $("title-message");
  private titleHint = $("title-hint");
  private controls = $("controls");
  private meter = $("tpose-meter");
  private meterFill = $("tpose-meter").querySelector(".tpose-fill") as HTMLElement;
  private button = $<HTMLButtonElement>("primary-btn");

  private summaryScreen = $("summary-screen");
  private summaryTitle = $("summary-title");
  private summarySubtitle = $("summary-subtitle");
  private summaryHint = $("summary-hint");
  private statStars = $("stat-stars");
  private statAirtime = $("stat-airtime");
  private statCombo = $("stat-combo");
  private ribbon = $("rank-ribbon");
  private ribbonRank = $("ribbon-rank");
  private ribbonMessage = $("ribbon-message");
  private againButton = $<HTMLButtonElement>("again-btn");
  private endButton = $<HTMLButtonElement>("end-btn");
  private doneButton = $<HTMLButtonElement>("done-btn");
  private summaryResult = $("summary-result");
  private summaryRanking = $("summary-ranking");
  private summaryBoardNote = $("summary-board-note");
  private summaryBoardList = $<HTMLOListElement>("summary-board-list");
  private scoreForm = $<HTMLFormElement>("score-form");
  private nameInput = $<HTMLInputElement>("player-name");
  private submitButton = $<HTMLButtonElement>("submit-score");

  private muteButton = $<HTMLButtonElement>("mute");
  private reticle = $("reticle");
  private preview = $("preview");
  private poseStatus = $("pose-status");
  private trackPill = $("track-pill");
  private trackText = $("track-pill").querySelector(".track-text") as HTMLElement;

  readonly overlayCanvas = $<HTMLCanvasElement>("overlay");

  private keyboard = new PoseKeyboard($("pose-keyboard"), $("pose-cursor"), $("cursor-fill"));
  private keyboardHint = $("keyboard-hint");
  /** Only offered when a camera is actually driving the cursor. */
  private keyboardAvailable = false;

  /** Called when the screen's main action button is pressed. */
  onAction?: () => void;
  /** Called when the mute toggle changes. */
  onMuteToggle?: (muted: boolean) => void;
  /** Called when the player posts their run to the leaderboard. */
  onSubmitScore?: (name: string) => void;
  /** Called when the player ends the flight and wants to see the board. */
  onEndFlight?: () => void;
  /** Called when the player is finished with the board. */
  onDone?: () => void;
  /** Called when the summary has been left alone long enough to go idle. */
  onIdle?: () => void;

  private muted = false;
  /** The clock the time meter measures itself against, so bonuses read right. */
  private timeReference = 60;
  private idleTimer: number | null = null;
  private summaryShownAt = 0;

  constructor() {
    this.button.addEventListener("click", () => this.onAction?.());
    this.againButton.addEventListener("click", () => this.onAction?.());

    this.endButton.addEventListener("click", () => this.showRanking());
    this.doneButton.addEventListener("click", () => this.onDone?.());

    // Any sign of a person resets the countdown back to the attract screen.
    // Pointer movement counts: someone at a laptop is still here even if they
    // have not clicked anything.
    for (const event of ["pointerdown", "pointermove", "keydown", "wheel"]) {
      window.addEventListener(
        event,
        () => {
          if (!this.summaryScreen.classList.contains("hidden")) this.armIdleReturn();
        },
        { passive: true }
      );
    }

    this.muteButton.addEventListener("click", () => {
      this.muted = !this.muted;
      this.muteButton.textContent = this.muted ? "🔇" : "🔊";
      this.muteButton.setAttribute("aria-pressed", String(this.muted));
      this.muteButton.setAttribute("aria-label", this.muted ? "Unmute sound" : "Mute sound");
      this.onMuteToggle?.(this.muted);
    });

    this.scoreForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.onSubmitScore?.(this.nameInput.value);
    });

    this.keyboard.onKey = (key) => {
      if (key.kind === "post") {
        this.onSubmitScore?.(this.nameInput.value);
        return;
      }
      const current = this.nameInput.value;
      this.nameInput.value =
        key.kind === "delete" ? current.slice(0, -1) : (current + key.value).slice(0, MAX_NAME);
      // A keyboard press is a sign of life; without this the board could time
      // out and vanish while somebody was still spelling their name.
      this.armIdleReturn();
    };

    // Enter activates whatever the screen is currently offering, so the game
    // is fully playable without reaching for the mouse.
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Enter") return;
      // Unless the player is typing their name, where Enter belongs to the
      // form -- otherwise posting a score would also fly again.
      if (e.target instanceof HTMLInputElement) return;
      const onSummary = !this.summaryScreen.classList.contains("hidden");
      const onRanking = onSummary && !this.summaryRanking.classList.contains("hidden");
      const button = onRanking ? this.doneButton : onSummary ? this.againButton : this.button;
      if (button.closest(".hidden") || button.disabled) return;
      e.preventDefault();
      if (onRanking) this.onDone?.();
      else this.onAction?.();
    });
  }

  showPreview() {
    this.preview.classList.remove("hidden");
  }

  /**
   * True when the big title is up rather than the ready screen. Both are the
   * same element, told apart by the oversized `hero` treatment, and the START
   * button has to behave differently on each.
   */
  /** True while the result step of the summary is up. */
  get onSummaryResult(): boolean {
    return (
      !this.summaryScreen.classList.contains("hidden") &&
      !this.summaryResult.classList.contains("hidden")
    );
  }

  /**
   * Whether a hands-up gesture should be honoured right now. The delay stops
   * a player whose arms are still above their head from the last flap ending
   * the flight before they have seen the score.
   */
  get canEndByGesture(): boolean {
    return (
      this.onSummaryResult &&
      !this.endButton.classList.contains("hidden") &&
      performance.now() - this.summaryShownAt > END_GESTURE_ARM_MS
    );
  }

  get onTitle(): boolean {
    return (
      !this.titleScreen.classList.contains("hidden") && this.titleScreen.classList.contains("hero")
    );
  }

  /* ---------------- In-flight HUD ---------------- */

  setScore(score: number) {
    this.scoreValue.textContent = String(score);
  }

  /** Pop the counter on a pickup. Restarting the animation needs a reflow. */
  popScore() {
    this.scoreCounter.classList.remove("pop");
    void this.scoreCounter.offsetWidth;
    this.scoreCounter.classList.add("pop");
  }

  /** The clock the time bar fills against; reset at the start of a run. */
  setTimeReference(seconds: number) {
    this.timeReference = Math.max(1, seconds);
  }

  setTime(seconds: number) {
    this.timerValue.textContent = asClock(seconds);
    this.timerPanel.classList.toggle("urgent", seconds <= 10);
    // Bonus time can push the clock past where it started, so the bar is
    // capped rather than allowed to overflow its track.
    const fraction = Math.min(1, Math.max(0, seconds / this.timeReference));
    this.timerFill.style.width = `${fraction * 100}%`;
  }

  /** Altitude as 0 at the treetops to 1 at the ceiling. */
  setAltitude(fraction: number) {
    const low = fraction < LOW_ALTITUDE;
    this.altFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    this.altValue.textContent = low ? "LOW" : fraction > 0.7 ? "HIGH" : "OK";
    this.altPanel.classList.toggle("low", low);
  }

  /** Shout a chain. `multiplier` is what the player sees, so x2 and up. */
  flashCombo(multiplier: number) {
    if (multiplier < 2) return;
    this.combo.textContent = `x${multiplier} COMBO!`;
    this.combo.classList.remove("show");
    void this.combo.offsetWidth;
    this.combo.classList.add("show");
  }

  /** Flash the bonus time award. */
  flashBonus(seconds: number, starsPerBonus: number) {
    this.bonusGain.textContent = `+${seconds}s`;
    this.bonusNote.textContent = `${starsPerBonus} stars banked — clock extended`;
    this.bonus.classList.remove("show");
    void this.bonus.offsetWidth;
    this.bonus.classList.add("show");
  }

  /** Move the aiming cross to a projected screen position. */
  setReticle(x: number, y: number, visible: boolean, locked: boolean) {
    this.reticle.classList.toggle("hidden", !visible);
    if (!visible) return;
    this.reticle.style.transform = `translate(${x}px, ${y}px)`;
    this.reticle.classList.toggle("locked", locked);
  }

  hideReticle() {
    this.reticle.classList.add("hidden");
  }

  setPoseStatus(status: PoseStatus, message: string) {
    // The caption is the detected pose; the raw message is kept as the
    // tooltip so the longer coaching text is not simply thrown away.
    this.poseStatus.textContent = POSE_CAPTION[status];
    this.poseStatus.title = message;

    const lost = status === "no-pose" || status === "partial";
    this.trackPill.classList.toggle("lost", lost);
    this.trackText.textContent = lost ? "STEP BACK" : "TRACKING";

    // Somebody standing in front of the camera is not an idle machine. The
    // countdown is meant to catch a screen nobody is looking at, and a player
    // still deciding what to do is not that -- without this the summary went
    // home while they were reading it, and the name step was never reached.
    if (status !== "no-pose" && !this.summaryScreen.classList.contains("hidden")) {
      this.armIdleReturn();
    }
  }

  setTposeProgress(progress: number) {
    this.meter.classList.toggle("hidden", progress <= 0.001);
    this.meterFill.style.width = `${Math.round(progress * 100)}%`;
  }

  /** Disable the action button while something is loading behind it. */
  setButtonBusy(busy: boolean, label?: string) {
    this.button.disabled = busy;
    if (label) this.button.textContent = label;
  }

  /* ---------------- Screens ---------------- */

  private showTitle(opts: {
    top: string;
    bottom: string;
    message?: string;
    button: string;
    hint?: string;
    controls: boolean;
    /** Title and attract only: a big wordmark dropped down over the bird. */
    hero?: boolean;
  }) {
    this.titleTop.textContent = opts.top;
    this.titleBottom.textContent = opts.bottom;
    this.titleMessage.textContent = opts.message ?? "";
    this.titleHint.textContent = opts.hint ?? "";
    this.controls.classList.toggle("hidden", !opts.controls);
    // The ready screen reuses this wordmark for "READY TO FLY" above a full
    // column of chips, so the oversized treatment is opt-in rather than the
    // default -- there is no room for it there.
    this.titleScreen.classList.toggle("hero", opts.hero === true);
    this.button.textContent = opts.button;
    this.button.disabled = false;

    this.titleScreen.classList.remove("hidden");
    this.summaryScreen.classList.add("hidden");
    this.hud.classList.add("hidden");
    this.setTposeProgress(0);
    this.clearIdleReturn();
  }

  /**
   * The first screen: nothing has been switched on yet.
   *
   * No control chips here. Nobody can act on "swing your arms down" before
   * the camera is even running, and the ready screen teaches the gestures at
   * the moment they become useful. Leaving them off keeps the title to a
   * wordmark and one button, with the bird visible behind it.
   */
  intro() {
    this.showTitle({ top: "HORNBILL", bottom: "FLIGHT", button: "START", controls: false, hero: true });
  }

  /**
   * The title with the camera already live: after a run once the summary has
   * been left alone, or on load when permission was granted previously. A
   * T-pose launches from here, so it is worth saying so.
   */
  attract(poseAvailable: boolean) {
    this.showTitle({
      top: "HORNBILL",
      bottom: "FLIGHT",
      button: "START",
      hint: poseAvailable ? "Hold a T-pose, or press START." : "",
      controls: false,
      hero: true,
    });
  }

  error(message: string) {
    this.showTitle({
      top: "NO CAMERA",
      bottom: "FLIGHT",
      message,
      button: "USE KEYBOARD",
      hint: "Space to flap, arrow keys to steer, down arrow to divebomb.",
      controls: false,
    });
  }

  /** Camera is live and the player can launch. */
  waiting(poseAvailable: boolean) {
    this.showTitle({
      top: "READY",
      bottom: "TO FLY",
      message: poseAvailable
        ? "Stand back so your head, arms and hips are all in frame, then T-pose to launch."
        : "Press the button below to launch.",
      button: "FLY NOW",
      hint: poseAvailable
        ? "No room to move? Use the button, or Space to flap and arrow keys to steer."
        : "Keyboard: Space to flap, arrow keys to steer, down arrow to divebomb.",
      controls: true,
    });
  }

  playing() {
    this.titleScreen.classList.add("hidden");
    this.summaryScreen.classList.add("hidden");
    this.hud.classList.remove("hidden");
    this.setTposeProgress(0);
    this.clearIdleReturn();
  }

  /** The run summary. */
  summary(stats: SummaryStats) {
    this.titleScreen.classList.add("hidden");
    this.hud.classList.add("hidden");
    this.summaryScreen.classList.remove("hidden");
    this.hideReticle();
    this.setTposeProgress(0);

    this.summaryTitle.textContent = stats.crashed ? "FLIGHT OVER" : "TIME UP";
    this.summarySubtitle.textContent = stats.crashed
      ? `You sank into the canopy at ${asClock(stats.airtimeSeconds)}`
      : `You flew the whole ${asClock(stats.airtimeSeconds)}`;

    this.statStars.textContent = String(stats.stars);
    this.statAirtime.textContent = `${Math.round(stats.airtimeSeconds)}s`;
    this.statCombo.textContent = `x${stats.bestCombo}`;

    // The ribbon belongs to the ranking page, but the placement is known
    // now, so it is filled in ready for whenever that page is opened.
    this.setRank(stats.rank, stats.rankMessage);

    // Always back to step one: the result. The board is a second page,
    // reached by ending the flight.
    this.summaryResult.classList.remove("hidden");
    this.summaryRanking.classList.add("hidden");
    this.hideScoreForm();

    this.summaryShownAt = performance.now();
    this.armIdleReturn();
  }

  /** Whether the board can be reached at all; hides END FLIGHT if not. */
  setEndFlightAvailable(available: boolean) {
    this.endButton.classList.toggle("hidden", !available);
  }

  /**
   * Step two: the board. Swaps the card's contents rather than opening a
   * panel underneath, so the ranking gets the whole card and a long board
   * never pushes the buttons off a short screen.
   */
  showRanking() {
    this.summaryResult.classList.add("hidden");
    this.summaryRanking.classList.remove("hidden");
    this.armIdleReturn();
    this.onEndFlight?.();
  }

  /* ---------------- Attract countdown ---------------- */

  private armIdleReturn(after = IDLE_RETURN_MS) {
    this.clearIdleReturn();
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      this.onIdle?.();
    }, after);
  }

  private clearIdleReturn() {
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  setSummaryHint(message: string) {
    this.summaryHint.textContent = message;
  }

  /**
   * Show, update or drop the rank ribbon. Called once from `summary()` with
   * whatever placement was already known, and again when a fresh board lands.
   */
  setRank(rank?: number, message?: string) {
    const hasRank = typeof rank === "number";
    this.ribbon.classList.toggle("hidden", !hasRank);
    if (!hasRank) return;
    this.ribbonRank.textContent = `#${rank}`;
    this.ribbonMessage.textContent = message ?? "";
  }

  /* ---------------- Leaderboard ---------------- */

  /**
   * Render the board, which lives on the run summary and nowhere else. Its
   * visibility belongs to the BOARD button rather than to whether there is
   * data, so this only ever fills it in.
   */
  setLeaderboard(view: BoardView) {
    if (view.kind === "hidden") return;

    this.summaryBoardList.replaceChildren();

    if (view.kind === "loading") {
      this.summaryBoardNote.textContent = "Loading…";
      return;
    }
    if (view.kind === "error") {
      this.summaryBoardNote.textContent = view.message;
      return;
    }
    if (view.entries.length === 0) {
      this.summaryBoardNote.textContent = "No runs posted yet. Be the first.";
      return;
    }

    this.summaryBoardNote.textContent = "";
    view.entries.forEach((entry, i) => {
      this.summaryBoardList.append(this.buildRow(entry, i + 1, entry.id === view.highlightId));
    });
  }

  /**
   * One row, built node by node. Names come from whoever else has played, so
   * they are set as text and never as markup.
   */
  private buildRow(entry: LeaderboardEntry, rank: number, isYou: boolean): HTMLLIElement {
    const row = document.createElement("li");
    row.className = "board-row";
    row.classList.toggle("is-you", isYou);

    const cell = (className: string, text: string) => {
      const el = document.createElement("span");
      el.className = className;
      el.textContent = text;
      return el;
    };

    row.append(
      cell("board-rank", String(rank)),
      cell("board-name", entry.name),
      cell("board-stars", `${entry.stars}★`),
      cell("board-time", `${Math.round(entry.duration_seconds)}s`)
    );
    return row;
  }

  /** Offer to post the run just finished, with the last name used filled in. */
  showScoreForm(name: string) {
    this.nameInput.value = name;
    this.submitButton.disabled = false;
    this.submitButton.textContent = "POST";
    this.scoreForm.classList.remove("hidden");
    // The hand controls are only worth explaining when a hand can drive them.
    this.keyboardHint.classList.toggle("hidden", !this.keyboardAvailable);
    if (this.keyboardAvailable) this.keyboard.show();
  }

  hideScoreForm() {
    this.scoreForm.classList.add("hidden");
    this.keyboardHint.classList.add("hidden");
    this.keyboard.hide();
  }

  /** Turn the hand-driven keyboard on once a camera is running. */
  setKeyboardAvailable(available: boolean) {
    this.keyboardAvailable = available;
  }

  /** Feed the cursor. Ignored unless the keyboard is actually up. */
  setPointer(pointer: { x: number; y: number } | null) {
    // A raised hand counts as presence. Aiming at a key takes longer than the
    // idle countdown, so without this the board would vanish mid-word from
    // somebody who is very obviously still there.
    if (pointer && !this.summaryScreen.classList.contains("hidden")) this.armIdleReturn();
    this.keyboard.setPointer(pointer);
  }

  setSubmitBusy(busy: boolean) {
    this.submitButton.disabled = busy;
    this.submitButton.textContent = busy ? "…" : "POST";
  }

  /** A line above the board, for "Posted as X" and for submit failures. */
  setBoardNote(message: string) {
    this.summaryBoardNote.textContent = message;
  }
}
