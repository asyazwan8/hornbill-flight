import type { InputSource } from "../game/Game";
import type { FlightInput } from "../game/types";
import { PoseTracker } from "./PoseTracker";
import { GestureMapper, type PoseStatus } from "./GestureMapper";
import { PoseOverlay } from "./PoseOverlay";

/**
 * The webcam control stack as a single input source.
 *
 * Pose detection runs on its own loop at the webcam's frame rate, which is
 * usually slower than the render loop. Flaps and T-poses are latched so the
 * game never misses one that landed between two of its own frames, and never
 * reads the same one twice.
 */
export class PoseInput implements InputSource {
  private tracker: PoseTracker;
  private mapper = new GestureMapper();
  private overlay: PoseOverlay;

  private lastTime = 0;
  private running = false;

  private pendingFlap = 0;
  private startLatched = false;
  private steer = 0;
  private dive = 0;

  status: PoseStatus = "no-pose";
  message = "Step into view";
  tposeProgress = 0;

  onUpdate?: (status: PoseStatus, message: string, tposeProgress: number) => void;
  /** Fired once when a dive begins, so the game can play the whoosh. */
  onDive?: () => void;
  /**
   * Fired once when both hands are held above the head. Delivered as a call
   * rather than a latch on purpose: it only means anything on the screen that
   * is up when it happens, and a latch would keep it alive to fire later on a
   * screen it was never meant for.
   */
  onHandsUp?: () => void;
  /** Where the raised hand points each frame, or null when neither is up. */
  onPointer?: (pointer: { x: number; y: number } | null) => void;

  constructor(video: HTMLVideoElement, overlayCanvas: HTMLCanvasElement) {
    this.tracker = new PoseTracker(video);
    this.overlay = new PoseOverlay(overlayCanvas);
  }

  async init() {
    await this.tracker.init();
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    this.tracker.detect();
    const gesture = this.mapper.update(this.tracker.landmarks, dt);

    // Latch: hold the flap until the game loop consumes it.
    if (gesture.input.flap > 0) this.pendingFlap = Math.max(this.pendingFlap, gesture.input.flap);
    if (gesture.tposeComplete) this.startLatched = true;
    if (gesture.diveStarted) this.onDive?.();
    if (gesture.handsUpComplete) this.onHandsUp?.();
    this.onPointer?.(gesture.pointer);
    this.steer = gesture.input.steer;
    this.dive = gesture.input.dive;

    this.status = gesture.status;
    this.message = gesture.message;
    this.tposeProgress = gesture.tposeProgress;

    this.overlay.draw(this.tracker.videoElement, this.tracker.landmarks, gesture.status);
    this.onUpdate?.(gesture.status, gesture.message, gesture.tposeProgress);
  };

  sample(): FlightInput {
    const flap = this.pendingFlap;
    this.pendingFlap = 0;
    return { flap, steer: this.steer, dive: this.dive };
  }

  startRequested(): boolean {
    const requested = this.startLatched;
    this.startLatched = false;
    return requested;
  }

  /** Clear the gesture history, e.g. between runs. */
  reset() {
    this.mapper.reset();
    this.pendingFlap = 0;
    this.startLatched = false;
  }
}
