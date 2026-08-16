import "./style.css";
import { Game, type InputSource } from "./game/Game";
import type { FlightInput } from "./game/types";
import { Hud } from "./ui/Hud";
import { KeyboardInput } from "./input/Keyboard";
import { PoseInput } from "./pose/PoseInput";
import { GameAudio } from "./audio/Audio";
import {
  PREFLIGHT_ROWS,
  TOP_N,
  cleanName,
  fetchTop,
  isConfigured as leaderboardConfigured,
  readBest,
  readName,
  submit,
  writeBest,
  writeName,
} from "./leaderboard/Leaderboard";

/** Pose and keyboard at the same time; whichever moves, moves the bird. */
class CombinedInput implements InputSource {
  constructor(private sources: InputSource[]) {}

  sample(dt: number): FlightInput {
    let flap = 0;
    let steer = 0;
    let dive = 0;
    for (const s of this.sources) {
      const i = s.sample(dt);
      flap = Math.max(flap, i.flap);
      dive = Math.max(dive, i.dive);
      // The larger deflection wins, so a resting source never cancels an
      // active one.
      if (Math.abs(i.steer) > Math.abs(steer)) steer = i.steer;
    }
    return { flap, steer, dive };
  }

  startRequested(): boolean {
    // Poll every source: each one clears its own latch.
    let requested = false;
    for (const s of this.sources) if (s.startRequested()) requested = true;
    return requested;
  }
}

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError")
    return "Camera permission was denied. Allow it in your browser's site settings and reload to use body controls.";
  if (name === "NotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError")
    return "The camera is already in use by another app. Close it and reload.";
  if (!window.isSecureContext)
    return "Webcam access needs HTTPS or localhost. Open the site over a secure connection.";
  return `The pose model could not start: ${err instanceof Error ? err.message : String(err)}`;
}

async function main() {
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  const video = document.getElementById("webcam") as HTMLVideoElement;
  const hud = new Hud();
  const audio = new GameAudio();

  const keyboard = new KeyboardInput();
  let poseInput: PoseInput | null = null;
  let poseAvailable = false;
  let best = readBest();
  /** What the action button does right now. */
  let stage: "intro" | "waiting" | "gameover" = "intro";
  /** The finished run the submit button would post, captured at game over. */
  let lastRun: { stars: number; durationSeconds: number } | null = null;

  // Panels come and go faster than a request completes, so every load carries
  // a token and a stale response is dropped rather than drawn over a screen
  // that has already moved on.
  let boardToken = 0;

  /**
   * Fetch and draw the board. Failure is not an error the player needs to act
   * on -- the panel says so quietly and the local best score still stands.
   */
  const loadBoard = async (rows: number, highlightId?: string) => {
    if (!leaderboardConfigured()) return;
    const token = ++boardToken;
    hud.setLeaderboard({ kind: "loading" });
    try {
      const entries = await fetchTop(TOP_N);
      if (token !== boardToken) return;
      hud.setLeaderboard({ kind: "entries", entries: entries.slice(0, rows), highlightId });
    } catch (err) {
      if (token !== boardToken) return;
      console.warn("Leaderboard unavailable", err);
      hud.setLeaderboard({ kind: "error", message: "Leaderboard unavailable right now." });
    }
  };

  const game = new Game(canvas, {
    onScore: (s) => hud.setScore(s),
    onTime: (t) => hud.setTime(t),
    onCollect: (streak) => audio.star(streak),
    onFlap: (strength) => audio.flap(strength),
    onBonus: (seconds) => {
      hud.flashBonus(seconds);
      audio.bonus();
    },
    onCrash: () => audio.crash(),
    onCall: () => audio.call(),
    onReticle: (r) => hud.setReticle(r.x, r.y, r.visible, r.locked),
    onPhase: (phase) => {
      if (phase === "waiting") {
        stage = "waiting";
        hud.waiting(poseAvailable);
        void loadBoard(PREFLIGHT_ROWS);
      } else if (phase === "playing") {
        stage = "waiting";
        hud.playing();
        poseInput?.reset();
        audio.launch();
      } else if (phase === "gameover") {
        stage = "gameover";
        audio.gameOver();
        const score = game.score;
        lastRun = { stars: score, durationSeconds: game.runSeconds };
        // Drawn before the best score is updated, so "New best!" compares
        // against the score to beat rather than the one just set.
        hud.gameover(score, best, game.crashed, poseAvailable);
        if (score > best) {
          best = score;
          writeBest(best);
        }

        // A scoreless run has nothing worth posting, but the board is still
        // worth showing: it is what the player is trying to get onto.
        if (score > 0 && leaderboardConfigured()) hud.showScoreForm(readName());
        void loadBoard(TOP_N);
      }
    },
  });

  game.setInputSource(new CombinedInput([keyboard]));
  game.run();

  hud.onMuteToggle = (muted) => audio.setMuted(muted);

  hud.onSubmitScore = async (rawName) => {
    if (!lastRun) return;
    const name = cleanName(rawName);
    // Remembered so the next run only needs the button.
    writeName(name);
    hud.setSubmitBusy(true);
    try {
      const stored = await submit({ ...lastRun, name });
      // Re-read rather than splicing the row in locally: other people may have
      // posted while this run was in the air, and the server decides the order.
      hud.hideScoreForm();
      await loadBoard(TOP_N, stored.id);
      hud.setBoardNote(`Posted as ${name}.`);
    } catch (err) {
      console.warn("Could not post score", err);
      hud.setSubmitBusy(false);
      hud.setBoardNote("Could not post that score. Try again?");
    }
  };

  /** Everything that needs a user gesture: audio unlock, then the camera. */
  const enableAndStart = async () => {
    hud.setButtonBusy(true, "Starting…");

    // Audio first: it is instant, and doing it inside the click keeps the
    // gesture "live" for browsers that require one to unlock playback.
    try {
      await audio.init();
      audio.startMusic();
    } catch (err) {
      console.warn("Audio unavailable", err);
    }

    try {
      const pose = new PoseInput(video, hud.overlayCanvas);
      await pose.init();
      poseInput = pose;
      poseAvailable = true;

      pose.onUpdate = (status, message, progress) => {
        hud.setPoseStatus(status, message);
        if (game.phase !== "playing") hud.setTposeProgress(progress);
      };
      pose.onDive = () => audio.dive();

      hud.showPreview();
      game.setInputSource(new CombinedInput([pose, keyboard]));
    } catch (err) {
      console.error("Pose setup failed", err);
      hud.error(describeCameraError(err));
      stage = "waiting";
      // Leave the message up; the button now reads "Play with keyboard".
      game.ready();
      return;
    }

    game.ready();
  };

  hud.onAction = () => {
    if (stage === "intro") {
      void enableAndStart();
    } else {
      // Both "Fly now" and "Fly again" launch a run directly. Restarting is
      // deliberately button-only, so leftover arm positions cannot relaunch.
      void audio.init();
      audio.startMusic();
      game.startRun();
    }
  };

  // Dev-only handle so the browser tests can fly the real game with a scripted
  // autopilot. Vite strips this branch entirely from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as { __hornbill?: unknown }).__hornbill = { game, hud, audio };
  }

  hud.intro();
  void loadBoard(PREFLIGHT_ROWS);
}

main();
