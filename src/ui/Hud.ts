import type { PoseStatus } from "../pose/GestureMapper";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

type PanelOptions = {
  help?: boolean;
  hint?: string;
  /** Label for the panel's action button; omitted hides the button. */
  button?: string;
};

/** All the DOM chrome: score, timer, panels, buttons and the pose caption. */
export class Hud {
  private hud = $("hud");
  private timer = $("hud-timer");
  private timerValue = $("hud-timer").querySelector(".value") as HTMLElement;
  private scoreValue = $("hud-score").querySelector(".value") as HTMLElement;

  private panel = $("panel");
  private title = $("panel-title");
  private body = $("panel-body");
  private hint = $("panel-hint");
  private help = $("panel-help");
  private meter = $("tpose-meter");
  private meterFill = $("tpose-meter").querySelector(".meter-fill") as HTMLElement;
  private button = $<HTMLButtonElement>("primary-btn");
  private muteButton = $<HTMLButtonElement>("mute");
  private reticle = $("reticle");
  private bonus = $("bonus");

  private preview = $("preview");
  private poseStatus = $("pose-status");

  readonly overlayCanvas = $<HTMLCanvasElement>("overlay");

  /** Called when the panel's action button is pressed. */
  onAction?: () => void;
  /** Called when the mute toggle changes. */
  onMuteToggle?: (muted: boolean) => void;

  private muted = false;

  constructor() {
    this.button.addEventListener("click", () => this.onAction?.());

    this.muteButton.addEventListener("click", () => {
      this.muted = !this.muted;
      this.muteButton.textContent = this.muted ? "🔇" : "🔊";
      this.muteButton.setAttribute("aria-pressed", String(this.muted));
      this.muteButton.setAttribute("aria-label", this.muted ? "Unmute sound" : "Mute sound");
      this.onMuteToggle?.(this.muted);
    });

    // Enter activates whatever the panel is currently offering, so the game is
    // fully playable without reaching for the mouse.
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Enter") return;
      if (this.button.classList.contains("hidden") || this.button.disabled) return;
      e.preventDefault();
      this.onAction?.();
    });
  }

  showPreview() {
    this.preview.classList.remove("hidden");
  }

  setScore(score: number) {
    this.scoreValue.textContent = String(score);
  }

  setTime(seconds: number) {
    this.timerValue.textContent = String(seconds);
    this.timer.classList.toggle("urgent", seconds <= 10);
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

  /** Flash the bonus time award. Restarting the animation needs a reflow. */
  flashBonus(seconds: number) {
    this.bonus.textContent = `+${seconds}s`;
    this.bonus.classList.remove("show");
    void this.bonus.offsetWidth;
    this.bonus.classList.add("show");
  }

  setPoseStatus(status: PoseStatus, message: string) {
    this.poseStatus.textContent = message;
    this.poseStatus.classList.toggle("good", status === "tpose" || status === "tracking");
    this.poseStatus.classList.toggle("warn", status === "partial" || status === "no-pose");
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

  private showPanel(title: string, bodyHtml: string, opts: PanelOptions = {}) {
    this.title.textContent = title;
    this.body.innerHTML = bodyHtml;
    this.help.classList.toggle("hidden", !opts.help);
    this.hint.textContent = opts.hint ?? "";

    const hasButton = typeof opts.button === "string";
    this.button.classList.toggle("hidden", !hasButton);
    this.button.disabled = false;
    if (hasButton) this.button.textContent = opts.button as string;

    this.panel.classList.remove("hidden");
    this.hud.classList.add("hidden");
  }

  /** The first screen: nothing has been switched on yet. */
  intro() {
    this.showPanel(
      "Hornbill Flight",
      "You are a hornbill over the rainforest. Collect as many stars as you can in <b>60 seconds</b>, flying with your body.",
      {
        help: true,
        button: "Start",
        hint: "Uses your webcam and plays sound. Nothing you record ever leaves your device.",
      }
    );
    this.setTposeProgress(0);
  }

  error(message: string) {
    this.showPanel("Camera unavailable", message, {
      button: "Play with keyboard",
      hint: "Space to flap, arrow keys to steer, down arrow to divebomb.",
    });
    this.setTposeProgress(0);
  }

  /** Camera is live and the player can launch. */
  waiting(poseAvailable: boolean) {
    this.showPanel(
      "Ready to fly",
      poseAvailable
        ? "Stand back so your head, arms and hips are all in frame, then <b>T-pose</b> to launch."
        : "Press the button below to launch.",
      {
        help: true,
        button: "Fly now",
        hint: poseAvailable
          ? "No room to move? Use the button, or Space to flap and arrow keys to steer."
          : "Keyboard: Space to flap, arrow keys to steer, down arrow to divebomb.",
      }
    );
  }

  playing() {
    this.panel.classList.add("hidden");
    this.hud.classList.remove("hidden");
    this.setTposeProgress(0);
  }

  gameover(score: number, best: number, crashed: boolean) {
    const noun = score === 1 ? "star" : "stars";
    const note =
      score >= best && score > 0
        ? "<div class='best'>New best!</div>"
        : best > 0
          ? `<div class='best'>Best: ${best}</div>`
          : "";
    this.showPanel(
      crashed ? "Crashed!" : "Time!",
      `<div class="score-big">${score}</div><div>${noun} collected</div>${note}`,
      {
        button: "Fly again",
        hint: crashed ? "You flew into the canopy. Keep flapping to stay above the trees." : "",
      }
    );
    this.setTposeProgress(0);
    this.hideReticle();
  }
}
