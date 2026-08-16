import type { PoseStatus } from "../pose/GestureMapper";
import type { LeaderboardEntry } from "../leaderboard/Leaderboard";

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

  private boardPanel = $("board-panel");
  private boardNote = $("board-note");
  private boardList = $<HTMLOListElement>("board-list");

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
  private boardButton = $<HTMLButtonElement>("board-btn");
  private summaryBoard = $("summary-board");
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

  /** Called when the screen's main action button is pressed. */
  onAction?: () => void;
  /** Called when the mute toggle changes. */
  onMuteToggle?: (muted: boolean) => void;
  /** Called when the player posts their run to the leaderboard. */
  onSubmitScore?: (name: string) => void;
  /** Called when the summary's BOARD button is opened for the first time. */
  onBoardRequested?: () => void;

  private muted = false;
  /** The clock the time meter measures itself against, so bonuses read right. */
  private timeReference = 60;
  /** Summary hint for the board-closed state, restored when it closes again. */
  private closedHint = "";

  constructor() {
    this.button.addEventListener("click", () => this.onAction?.());
    this.againButton.addEventListener("click", () => this.onAction?.());

    this.boardButton.addEventListener("click", () => {
      const opening = this.summaryBoard.classList.contains("hidden");
      this.summaryBoard.classList.toggle("hidden", !opening);
      this.boardButton.textContent = opening ? "HIDE" : "BOARD";
      // The hint points at the BOARD button, so it would be telling the
      // player to do the thing they have just done. Put it back on close.
      this.summaryHint.textContent = opening ? "" : this.closedHint;
      if (opening) this.onBoardRequested?.();
    });

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

    // Enter activates whatever the screen is currently offering, so the game
    // is fully playable without reaching for the mouse.
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Enter") return;
      // Unless the player is typing their name, where Enter belongs to the
      // form -- otherwise posting a score would also fly again.
      if (e.target instanceof HTMLInputElement) return;
      const button = this.summaryScreen.classList.contains("hidden") ? this.button : this.againButton;
      if (button.closest(".hidden") || button.disabled) return;
      e.preventDefault();
      this.onAction?.();
    });
  }

  showPreview() {
    this.preview.classList.remove("hidden");
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
  }) {
    this.titleTop.textContent = opts.top;
    this.titleBottom.textContent = opts.bottom;
    this.titleMessage.textContent = opts.message ?? "";
    this.titleHint.textContent = opts.hint ?? "";
    this.controls.classList.toggle("hidden", !opts.controls);
    this.button.textContent = opts.button;
    this.button.disabled = false;

    this.titleScreen.classList.remove("hidden");
    this.summaryScreen.classList.add("hidden");
    this.hud.classList.add("hidden");
    this.setTposeProgress(0);
  }

  /** The first screen: nothing has been switched on yet. */
  intro() {
    this.showTitle({
      top: "HORNBILL",
      bottom: "FLIGHT",
      button: "START",
      hint: "Uses your webcam and plays sound. Nothing recorded leaves your device.",
      controls: true,
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

    const hasRank = typeof stats.rank === "number";
    this.ribbon.classList.toggle("hidden", !hasRank);
    if (hasRank) {
      this.ribbonRank.textContent = `#${stats.rank}`;
      this.ribbonMessage.textContent = stats.rankMessage ?? "";
    }

    // The board starts closed on every run, so the button and panel cannot
    // disagree about which state they are in.
    this.summaryBoard.classList.add("hidden");
    this.boardButton.textContent = "BOARD";
    this.hideScoreForm();
  }

  setSummaryHint(message: string) {
    this.closedHint = message;
    this.summaryHint.textContent = message;
  }

  /* ---------------- Leaderboard ---------------- */

  /**
   * Render the board. It appears in two places — the title screen and behind
   * the summary's BOARD button — which share one renderer so they can never
   * drift apart.
   */
  setLeaderboard(view: BoardView) {
    for (const target of [
      { panel: this.boardPanel, list: this.boardList, note: this.boardNote },
      { panel: this.summaryBoard, list: this.summaryBoardList, note: this.summaryBoardNote },
    ]) {
      // The summary board's visibility belongs to the BOARD button, not to
      // whether there is data; only the title panel hides itself here.
      if (target.panel === this.boardPanel) {
        target.panel.classList.toggle("hidden", view.kind === "hidden");
      }
      if (view.kind === "hidden") continue;

      target.list.replaceChildren();

      if (view.kind === "loading") {
        target.note.textContent = "Loading…";
        continue;
      }
      if (view.kind === "error") {
        target.note.textContent = view.message;
        continue;
      }
      if (view.entries.length === 0) {
        target.note.textContent = "No runs posted yet. Be the first.";
        continue;
      }

      target.note.textContent = "";
      view.entries.forEach((entry, i) => {
        target.list.append(this.buildRow(entry, i + 1, entry.id === view.highlightId));
      });
    }
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
  }

  hideScoreForm() {
    this.scoreForm.classList.add("hidden");
  }

  setSubmitBusy(busy: boolean) {
    this.submitButton.disabled = busy;
    this.submitButton.textContent = busy ? "…" : "POST";
  }

  /** A line above the board, for "Posted as X" and for submit failures. */
  setBoardNote(message: string) {
    this.boardNote.textContent = message;
    this.summaryBoardNote.textContent = message;
  }
}
