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

/**
 * Divebomb: bring both hands together and the bird tucks and drops.
 *
 * Measured as the gap between the wrists in shoulder-widths. Arms hanging at
 * your sides leave a gap of roughly one shoulder-width, and a T-pose is wider
 * still, so a deliberate "hands together" is unambiguous — and it is the exact
 * opposite of the T-pose, which is why the two can never be confused.
 */
const DIVE_GAP_FULL = 0.35;
const DIVE_GAP_NONE = 0.7;

/**
 * Hands up: both wrists lifted clear above the head, which is how a finished
 * player says they are done.
 *
 * Measured against the nose rather than the shoulders, so it cannot be
 * reached by a flap — arms swing to about shoulder height on a downstroke and
 * nowhere near above the head. The hold is what separates it from the top of
 * an enthusiastic upstroke.
 */
const HANDS_UP_CLEARANCE = 0.25;
const HANDS_UP_HOLD = 1.0;

/**
 * Pointer: a raised hand drives a cursor, for typing a name onto the board.
 *
 * The band is the slice of the camera frame a standing player can comfortably
 * reach, stretched to fill the screen. Mapping the raw frame instead would put
 * the screen corners at the very edge of the image, where a hand is usually
 * out of shot, and the player would have to lunge for the outer keys.
 */
const POINTER_X_MIN = 0.22;
const POINTER_X_MAX = 0.78;
const POINTER_Y_MIN = 0.12;
const POINTER_Y_MAX = 0.72;

/** Landmarks jitter, and a jittering cursor cannot be aimed. */
const POINTER_SMOOTHING = 14;

/** Shoulder tilt below this is treated as standing straight. */
const STEER_DEADZONE = 0.09;
const STEER_GAIN = 2.6;
/** Flip this if steering feels inverted on your setup. */
const STEER_SIGN = -1;
/** How much the head's sideways lean contributes next to shoulder tilt. */
const STEER_LEAN_WEIGHT = 0.35;

const MIN_VISIBILITY = 0.5;

export type PoseStatus = "no-pose" | "partial" | "tracking" | "tpose" | "dive";

export type GestureState = {
  input: FlightInput;
  /** 0..1 progress of the T-pose hold. */
  tposeProgress: number;
  /** True on the single frame the T-pose completes. */
  tposeComplete: boolean;
  /** True on the frame a dive begins, for the whoosh. */
  diveStarted: boolean;
  /**
   * Where the raised hand points, as a 0..1 fraction of the screen, already
   * mirrored so moving a hand right moves the cursor right. Null when neither
   * hand is raised.
   */
  pointer: { x: number; y: number } | null;
  /** 0..1 progress of the hands-above-head hold. */
  handsUpProgress: number;
  /** True on the single frame both hands have been held up long enough. */
  handsUpComplete: boolean;
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
  private handsUpHeld = 0;
  private handsUpWasComplete = false;
  private pointerX = 0.5;
  private pointerY = 0.5;
  private hasPointer = false;
  private wasDiving = false;

  private pendingFlap = 0;

  reset() {
    this.tposeHeld = 0;
    this.tposeWasComplete = false;
    this.handsUpHeld = 0;
    this.handsUpWasComplete = false;
    this.hasPointer = false;
    this.wasDiving = false;
    this.pendingFlap = 0;
    this.steer = 0;
    this.hasHistory = false;
  }

  update(landmarks: Landmarks | null, dt: number): GestureState {
    const idle: GestureState = {
      input: { flap: 0, steer: 0, dive: 0 },
      tposeProgress: 0,
      tposeComplete: false,
      pointer: null,
      handsUpProgress: 0,
      handsUpComplete: false,
      diveStarted: false,
      status: "no-pose",
      message: "Step into view",
    };

    if (!landmarks || landmarks.length < 25 || dt <= 0) {
      this.tposeHeld = 0;
      this.handsUpHeld = 0;
      this.hasHistory = false;
      this.wasDiving = false;
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
      this.handsUpHeld = 0;
      this.hasHistory = false;
      this.wasDiving = false;
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

    /* ---------------- pointer: a raised hand drives a cursor ---------------- */

    // Whichever hand is higher is the one doing the pointing, and it has to be
    // raised at all: an arm hanging at the player's side is not aiming at
    // anything, and letting it drive the cursor would make the thing twitch
    // every time somebody shifted their weight.
    let pointer: { x: number; y: number } | null = null;
    const hipY = (lh.y + rh.y) / 2;
    const raised = wristsSeen ? (lw.y < rw.y ? lw : rw) : null;

    if (raised && raised.y < hipY) {
      // Mirrored: the camera sees the player face on, so their right hand
      // sits on the left of the frame. The preview is mirrored for the same
      // reason, and a cursor running the other way would be unusable.
      const mirroredX = 1 - raised.x;
      const targetX = clamp((mirroredX - POINTER_X_MIN) / (POINTER_X_MAX - POINTER_X_MIN), 0, 1);
      const targetY = clamp((raised.y - POINTER_Y_MIN) / (POINTER_Y_MAX - POINTER_Y_MIN), 0, 1);

      if (this.hasPointer) {
        this.pointerX = damp(this.pointerX, targetX, POINTER_SMOOTHING, dt);
        this.pointerY = damp(this.pointerY, targetY, POINTER_SMOOTHING, dt);
      } else {
        // Snap on the first frame, or the cursor slides in from wherever it
        // was left and the player watches it drift instead of aiming.
        this.pointerX = targetX;
        this.pointerY = targetY;
        this.hasPointer = true;
      }
      pointer = { x: this.pointerX, y: this.pointerY };
    } else {
      this.hasPointer = false;
    }

    /* ---------------- hands up: "I am finished" ---------------- */

    // y grows downward, so "above the head" is a smaller y than the nose.
    const handsUp =
      wristsSeen &&
      lw.y < nose.y - unit * HANDS_UP_CLEARANCE &&
      rw.y < nose.y - unit * HANDS_UP_CLEARANCE;

    this.handsUpHeld = handsUp ? this.handsUpHeld + dt : 0;
    const handsUpProgress = clamp(this.handsUpHeld / HANDS_UP_HOLD, 0, 1);
    const handsUpDone = handsUpProgress >= 1;
    const handsUpComplete = handsUpDone && !this.handsUpWasComplete;
    this.handsUpWasComplete = handsUpDone;

    /* ---------------- divebomb: hands brought together ---------------- */

    let dive = 0;
    if (wristsSeen) {
      const gap = Math.hypot(lw.x - rw.x, lw.y - rw.y) / unit;
      // Ramps in over a band rather than switching, so easing the hands
      // together gives a proportional dive instead of a hard snap.
      dive = clamp((DIVE_GAP_NONE - gap) / (DIVE_GAP_NONE - DIVE_GAP_FULL), 0, 1);
    }
    const isDiving = dive > 0.5;
    const diveStarted = isDiving && !this.wasDiving;
    this.wasDiving = isDiving;

    /* ---------------- flapping ---------------- */

    this.sinceFlap += dt;
    // Hands held together travel up and down as one, which would otherwise
    // read as a perfectly good wingbeat. Diving suppresses flap detection.
    if (wristsSeen && !isDiving) {
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
    } else if (isDiving) {
      status = "dive";
      message = "Divebomb!";
    } else if (!wristsSeen) {
      status = "partial";
      message = "Show both hands";
    }

    return {
      input: { flap, steer: this.steer, dive },
      tposeProgress,
      tposeComplete,
      pointer,
      handsUpProgress,
      handsUpComplete,
      diveStarted,
      status,
      message,
    };
  }
}
