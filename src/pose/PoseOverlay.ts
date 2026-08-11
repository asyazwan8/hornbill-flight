import { LM, type Landmarks } from "./PoseTracker";
import type { PoseStatus } from "./GestureMapper";

/** Upper-body skeleton: the joints this game actually reads. */
const BONES: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
];

const JOINTS = [
  LM.nose,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
];

const COLORS: Record<PoseStatus, string> = {
  "no-pose": "#8b95a8",
  partial: "#ffd43b",
  tracking: "#7ee0ff",
  tpose: "#8ce99a",
  dive: "#ff9f43",
};

/**
 * The little webcam preview with the skeleton drawn on top, so the player can
 * see what the game sees. Mirrored, because a preview that is not mirrored
 * feels broken to look at.
 */
export class PoseOverlay {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not available for the pose preview");
    this.ctx = ctx;
  }

  draw(video: HTMLVideoElement, landmarks: Landmarks | null, status: PoseStatus) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();
    // Mirror everything, video and skeleton alike, so the preview reads like
    // a mirror rather than a stranger facing you.
    ctx.translate(w, 0);
    ctx.scale(-1, 1);

    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      ctx.fillStyle = "#12182b";
      ctx.fillRect(0, 0, w, h);
    }

    if (landmarks && landmarks.length >= 25) {
      const color = COLORS[status];
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";

      ctx.beginPath();
      for (const [a, b] of BONES) {
        const p = landmarks[a];
        const q = landmarks[b];
        if (p.visibility < 0.4 || q.visibility < 0.4) continue;
        ctx.moveTo(p.x * w, p.y * h);
        ctx.lineTo(q.x * w, q.y * h);
      }
      ctx.stroke();

      ctx.fillStyle = color;
      for (const i of JOINTS) {
        const p = landmarks[i];
        if (p.visibility < 0.4) continue;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, i === LM.leftWrist || i === LM.rightWrist ? 7 : 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}
