import type { PoseStatus } from "../pose/GestureMapper";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

/** All the DOM chrome: score, timer, panels and the pose preview caption. */
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

  private preview = $("preview");
  private poseStatus = $("pose-status");

  readonly overlayCanvas = $<HTMLCanvasElement>("overlay");

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

  setPoseStatus(status: PoseStatus, message: string) {
    this.poseStatus.textContent = message;
    this.poseStatus.classList.toggle("good", status === "tpose" || status === "tracking");
    this.poseStatus.classList.toggle("warn", status === "partial" || status === "no-pose");
  }

  setTposeProgress(progress: number) {
    this.meter.classList.toggle("hidden", progress <= 0.001);
    this.meterFill.style.width = `${Math.round(progress * 100)}%`;
  }

  private showPanel(title: string, bodyHtml: string, opts: { help?: boolean; hint?: string } = {}) {
    this.title.textContent = title;
    this.body.innerHTML = bodyHtml;
    this.help.classList.toggle("hidden", !opts.help);
    this.hint.textContent = opts.hint ?? "";
    this.panel.classList.remove("hidden");
    this.hud.classList.add("hidden");
  }

  loading(message = "Waking up the camera and the pose model…") {
    this.showPanel("Hornbill Flight", message);
  }

  error(message: string) {
    this.showPanel("Camera unavailable", message, {
      hint: "You can still fly with the keyboard: Space to flap, arrow keys to steer, Enter to start.",
    });
    this.setTposeProgress(0);
  }

  waiting(poseAvailable: boolean) {
    this.showPanel(
      "Hornbill Flight",
      "You are a hornbill over the rainforest. Collect as many stars as you can in <b>60 seconds</b>.",
      {
        help: true,
        hint: poseAvailable
          ? "Stand back so your head, arms and hips are all in frame."
          : "Keyboard: Space to flap, arrow keys to steer, Enter to start.",
      }
    );
  }

  playing() {
    this.panel.classList.add("hidden");
    this.hud.classList.remove("hidden");
    this.setTposeProgress(0);
  }

  gameover(score: number, poseAvailable: boolean) {
    const noun = score === 1 ? "star" : "stars";
    this.showPanel(
      "Time!",
      `<div class="score-big">${score}</div><div>${noun} collected</div>`,
      {
        hint: poseAvailable ? "T-pose to fly again." : "Press Enter to fly again.",
      }
    );
  }
}
