/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the MediaPipe wasm runtime. Defaults to /mediapipe/wasm. */
  readonly VITE_MEDIAPIPE_WASM?: string;
  /** URL of the pose landmarker .task model. Defaults to /models/…lite.task. */
  readonly VITE_POSE_MODEL?: string;
  /** Supabase project URL. Unset disables the online leaderboard. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon key. Public by design; see supabase/schema.sql. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
