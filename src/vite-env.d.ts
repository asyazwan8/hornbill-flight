/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the MediaPipe wasm runtime. Defaults to /mediapipe/wasm. */
  readonly VITE_MEDIAPIPE_WASM?: string;
  /** URL of the pose landmarker .task model. Defaults to /models/…lite.task. */
  readonly VITE_POSE_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
