import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

/** Landmark indices we actually care about. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

export type Landmarks = NormalizedLandmark[];

/**
 * Where the MediaPipe runtime and the pose model are loaded from.
 *
 * By default both come from this app's own /public directory: no CDN, and the
 * game keeps working offline after first load. Hosts that would rather not
 * serve ~17MB of static assets can point these at the official CDN instead by
 * setting VITE_MEDIAPIPE_WASM and VITE_POSE_MODEL at build time.
 */
const WASM_BASE = import.meta.env.VITE_MEDIAPIPE_WASM ?? "/mediapipe/wasm";
const MODEL_URL = import.meta.env.VITE_POSE_MODEL ?? "/models/pose_landmarker_lite.task";

/**
 * Owns the webcam and the MediaPipe pose model.
 *
 * Both the wasm runtime and the model file are served from this app's own
 * /public directory, so the game keeps working with no CDN and no network
 * once it has loaded.
 */
export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private video: HTMLVideoElement;
  private lastVideoTime = -1;

  /** Most recent pose, or null when nobody is detected. */
  landmarks: Landmarks | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get videoElement() {
    return this.video;
  }

  get ready() {
    return this.landmarker !== null;
  }

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);

    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    // Safari reports readyState before dimensions are known.
    if (!this.video.videoWidth) {
      await new Promise<void>((resolve) => {
        this.video.addEventListener("loadeddata", () => resolve(), { once: true });
      });
    }
  }

  /**
   * Run detection if the webcam has produced a new frame.
   * Cheap to call every animation frame.
   */
  detect(): void {
    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    this.landmarks = result.landmarks.length > 0 ? result.landmarks[0] : null;
  }
}
