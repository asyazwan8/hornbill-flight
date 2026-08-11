import { LM, type Landmarks } from "./PoseTracker";
import { clamp, damp, type FlightInput } from "../game/types";

/* ------------------------------------------------------------------ *
 * Tuning. These are the knobs worth touching after a real play test.
 * ------------------------------------------------------------------ */

/** How long a T-pose must be held before a run starts. */
const TPOSE_HOLD = 1.0;
/** Wrists must sit within this fraction of a shoulder-width of shoulder height. */
const TPOSE_Y_TOLERANCE = 0.45;
/** …and reach out at least this far past the shoulder. */
const TPOSE_X_REACH = 0.7;

/** Vertical travel of a downstroke, in shoulder-widths, before it counts. */
const FLAP_MIN_TRAVEL = 0.3;
/** Ignore direction changes slower than this (shoulder-widths per second). */
const FLAP_VEL_EPSILON = 0.35;
/** Downstroke speeds mapping to the weakest and strongest flap. */
const FLAP_SPEED_WEAK = 1.0;
const FLAP_SPEED_STRONG = 5.0;
/** Minimum gap between two flaps. */
const FLAP_REFRACTORY = 0.18;

/** Shoulder tilt below this is treated as standing straight. */
const STEER_DEADZONE = 0.09;
const STEER_GAIN = 2.6;
/** Flip this if steering feels inverted on your setup. */
const STEER_SIGN = -1;
/** How much the head's sideways lean contributes next to shoulder tilt. */
const STEER_LEAN_WEIGHT = 0.35;

const MIN_VISIBILITY = 0.5;

export type PoseStatus = "no-pose" | "partial" | "tracking" | "tpose";

export type GestureState = {
  input: FlightInput;
  /** 0..1 progress of the T-pose hold. */
  tposeProgress: number;
  /** True on the single frame the T-pose completes. */
  tposeComplete: boolean;
  status: PoseStatus;
  message: string;
};

/**
 * Turns pose landmarks into flight controls.
 *
 * Everything is measured in shoulder-widths rather than pixels, so the
 * thresholds hold whether the player is close to the camera or across the room.
 */
export class GestureMapper {
  private smoothWristY = 0;
  private prevWristY = 0;
  private hasHistory = false;

  private strokeDirection: "up" | "down" = "up";
  /** Highest point (smallest y) reached in the current upstroke. */
  private strokeTop = 0;
  private strokeFired = false;
  private sinceFlap = 99;

  private steer = 0;
  private tposeHeld = 0;
  private tposeWasComplete = false;

  private pendingFlap = 0;

  reset() {
    this.tposeHeld = 0;
    this.tposeWasComplete = false;
    this.pendingFlap = 0;
    this.steer = 0;
    this.hasHistory = false;
  }

  update(landmarks: Landmarks | null, dt: number): GestureState {
    const idle: GestureState = {
      input: { flap: 0, steer: 0 },
      tposeProgress: 0,
      tposeComplete: false,
      status: "no-pose",
      message: "Step into view",
    };

    if (!landmarks || landmarks.length < 25 || dt <= 0) {
      this.tposeHeld = 0;
      this.hasHistory = false;
      return idle;
    }

    const ls = landmarks[LM.leftShoulder];
    const rs = landmarks[LM.rightShoulder];
    const lw = landmarks[LM.leftWrist];
    const rw = landmarks[LM.rightWrist];
    const nose = landmarks[LM.nose];
    const lh = landmarks[LM.leftHip];
    const rh = landmarks[LM.rightHip];

    const shouldersSeen = ls.visibility > MIN_VISIBILITY && rs.visibility > MIN_VISIBILITY;
    if (!shouldersSeen) {
      this.tposeHeld = 0;
      this.hasHistory = false;
      return { ...idle, status: "partial", message: "Show your shoulders" };
    }

    // Scale unit: shoulder width, with the torso as a backstop for when the
    // player turns and their shoulders foreshorten.
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    const torso = Math.abs(hipMidY - shoulderMidY);
    const unit = Math.max(shoulderWidth, torso * 0.6, 0.06);

    const wristsSeen = lw.visibility > MIN_VISIBILITY && rw.visibility > MIN_VISIBILITY;

    /* ---------------- steering: shoulder tilt + head lean ---------------- */

    const shoulderTilt = (ls.y - rs.y) / unit;
    const shoulderMidX = (ls.x + rs.x) / 2;
    const headLean = (nose.x - shoulderMidX) / unit;
    const raw = shoulderTilt * (1 - STEER_LEAN_WEIGHT) + headLean * STEER_LEAN_WEIGHT;

    const magnitude = Math.max(0, Math.abs(raw) - STEER_DEADZONE);
    const target = clamp(Math.sign(raw) * magnitude * STEER_GAIN, -1, 1) * STEER_SIGN;
    this.steer = damp(this.steer, target, 12, dt);

    /* ---------------- T-pose ---------------- */

    let isTpose = false;
    if (wristsSeen) {
      const armsLevel =
        Math.abs(lw.y - ls.y) < unit * TPOSE_Y_TOLERANCE &&
        Math.abs(rw.y - rs.y) < unit * TPOSE_Y_TOLERANCE;
      const armsOut =
        Math.abs(lw.x - ls.x) > unit * TPOSE_X_REACH && Math.abs(rw.x - rs.x) > unit * TPOSE_X_REACH;
      // Both wrists must be on their own side of the body, not crossed over.
      const notCrossed = Math.sign(lw.x - shoulderMidX) === Math.sign(ls.x - shoulderMidX) &&
        Math.sign(rw.x - shoulderMidX) === Math.sign(rs.x - shoulderMidX);
      isTpose = armsLevel && armsOut && notCrossed;
    }

    this.tposeHeld = isTpose ? this.tposeHeld + dt : 0;
    const tposeProgress = clamp(this.tposeHeld / TPOSE_HOLD, 0, 1);
    const complete = tposeProgress >= 1;
    const tposeComplete = complete && !this.tposeWasComplete;
    this.tposeWasComplete = complete;

    /* ---------------- flapping ---------------- */

    this.sinceFlap += dt;
    if (wristsSeen) {
      const wristY = (lw.y + rw.y) / 2;
      if (!this.hasHistory) {
        this.smoothWristY = wristY;
        this.prevWristY = wristY;
        this.strokeTop = wristY;
        this.hasHistory = true;
      }
      this.smoothWristY = damp(this.smoothWristY, wristY, 26, dt);

      // Positive velocity means the hands are travelling downward.
      const velocity = (this.smoothWristY - this.prevWristY) / dt / unit;
      this.prevWristY = this.smoothWristY;

      if (velocity < -FLAP_VEL_EPSILON) {
        // Rising. Remember the highest point of this upstroke.
        if (this.strokeDirection !== "up") {
          this.strokeDirection = "up";
          this.strokeFired = false;
        }
        this.strokeTop = Math.min(this.strokeTop, this.smoothWristY);
      } else if (velocity > FLAP_VEL_EPSILON) {
        if (this.strokeDirection !== "down") {
          this.strokeDirection = "down";
          this.strokeTop = Math.min(this.strokeTop, this.smoothWristY);
        }
        const travel = (this.smoothWristY - this.strokeTop) / unit;
        if (!this.strokeFired && travel > FLAP_MIN_TRAVEL && this.sinceFlap > FLAP_REFRACTORY) {
          const t = clamp(
            (velocity - FLAP_SPEED_WEAK) / (FLAP_SPEED_STRONG - FLAP_SPEED_WEAK),
            0,
            1
          );
          this.pendingFlap = 0.55 + t * 0.45;
          this.strokeFired = true;
          this.sinceFlap = 0;
          this.strokeTop = this.smoothWristY;
        }
      }
    } else {
      this.hasHistory = false;
    }

    const flap = this.pendingFlap;
    this.pendingFlap = 0;

    let status: PoseStatus = "tracking";
    let message = "Flap to fly";
    if (isTpose) {
      status = "tpose";
      message = complete ? "Go!" : "Hold it…";
    } else if (!wristsSeen) {
      status = "partial";
      message = "Show both hands";
    }

    return {
      input: { flap, steer: this.steer },
      tposeProgress,
      tposeComplete,
      status,
      message,
    };
  }
}
