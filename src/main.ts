import "./style.css";
import { Game, STARS_PER_BONUS, ROUND_SECONDS, type InputSource } from "./game/Game";
import type { FlightInput } from "./game/types";
import { Hud } from "./ui/Hud";
import { KeyboardInput } from "./input/Keyboard";
import { PoseInput } from "./pose/PoseInput";
import { GameAudio } from "./audio/Audio";
import type { SummaryStats } from "./ui/Hud";
import type { LeaderboardEntry } from "./leaderboard/Leaderboard";
import {
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
  /**
   * Set when the player pressed START, which is what earns the coaching
   * screen. A camera that came up on its own leaves the title in place, so a
   * kiosk shows its title rather than an instruction panel nobody asked for.
   */
  let coachingRequested = false;
  /** The finished run the submit button would post, captured at game over. */
  let lastRun: { stars: number; durationSeconds: number } | null = null;

  // Panels come and go faster than a request completes, so every load carries
  // a token and a stale response is dropped rather than drawn over a screen
  // that has already moved on.
  let boardToken = 0;
  /** Last board read, kept so a rank can be worked out without a round trip. */
  let boardCache: LeaderboardEntry[] | null = null;

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
      boardCache = entries;
      hud.setLeaderboard({ kind: "entries", entries: entries.slice(0, rows), highlightId });
    } catch (err) {
      if (token !== boardToken) return;
      console.warn("Leaderboard unavailable", err);
      hud.setLeaderboard({ kind: "error", message: "Leaderboard unavailable right now." });
    }
  };

  /**
   * Where this run would sit on the board, for the summary's rank ribbon.
   *
   * Worked out against the cached top ten rather than by asking the server,
   * because the ribbon has to be on screen the instant the run ends. A run
   * that beats nobody in a full top ten is simply off the board, and says so
   * instead of claiming an eleventh place it cannot actually know.
   */
  const placement = (stars: number, duration: number): Partial<SummaryStats> => {
    if (!leaderboardConfigured() || !boardCache || boardCache.length === 0) return {};

    const better = boardCache.filter(
      (e) => e.stars > stars || (e.stars === stars && e.duration_seconds > duration)
    ).length;
    const rank = better + 1;
    if (rank > boardCache.length && boardCache.length >= TOP_N) return {};

    const leader = boardCache[0];
    if (rank === 1) return { rank, rankMessage: "Top of the board — nobody has flown better" };

    const gap = leader.stars - stars;
    return {
      rank,
      rankMessage:
        gap > 0
          ? `${gap} star${gap === 1 ? "" : "s"} off ${leader.name}`
          : `Just behind ${leader.name}`,
    };
  };

  const game = new Game(canvas, {
    onScore: (s) => hud.setScore(s),
    onTime: (t) => hud.setTime(t),
    onAltitude: (fraction) => hud.setAltitude(fraction),
    onCollect: (streak) => {
      audio.star(streak);
      hud.popScore();
      // The streak counts extra stars in the chain; the player is shown the
      // multiplier, which is one more.
      hud.flashCombo(streak + 1);
    },
    onFlap: (strength) => audio.flap(strength),
    onBonus: (seconds) => {
      hud.flashBonus(seconds, STARS_PER_BONUS);
      audio.bonus();
    },
    onCrash: () => audio.crash(),
    onCall: () => audio.call(),
    onReticle: (r) => hud.setReticle(r.x, r.y, r.visible, r.locked),
    onPhase: (phase) => {
      if (phase === "waiting") {
        stage = "waiting";
        if (coachingRequested) hud.waiting(poseAvailable);
        else hud.attract(poseAvailable);
      } else if (phase === "playing") {
        stage = "waiting";
        hud.setTimeReference(ROUND_SECONDS);
        hud.setScore(0);
        hud.setTime(ROUND_SECONDS);
        hud.playing();
        poseInput?.reset();
        audio.launch();
      } else if (phase === "gameover") {
        stage = "gameover";
        audio.gameOver();
        const score = game.score;
        lastRun = { stars: score, durationSeconds: game.runSeconds };
        if (score > best) {
          best = score;
          writeBest(best);
        }

        hud.summary({
          stars: score,
          airtimeSeconds: game.runSeconds,
          bestCombo: game.bestCombo,
          crashed: game.crashed,
          ...placement(score, game.runSeconds),
        });
        hud.setSummaryHint(poseAvailable ? "Hold a T-pose to fly again." : "");
        if (score > 0 && leaderboardConfigured()) hud.showScoreForm(readName());
        // The ribbon is drawn twice on purpose: once immediately from the
        // cached board so it is there the instant the screen appears, and
        // again once a fresh read lands, in case somebody posted mid-flight.
        void loadBoard(TOP_N).then(() => {
          const fresh = placement(score, game.runSeconds);
          hud.setRank(fresh.rank, fresh.rankMessage);
        });
      }
    },
  });

  game.setInputSource(new CombinedInput([keyboard]));
  game.run();

  hud.onMuteToggle = (muted) => audio.setMuted(muted);

  // Reopening the board refreshes it, in case someone else posted meanwhile.
  hud.onBoardRequested = () => {
    if (lastRun && lastRun.stars > 0 && leaderboardConfigured()) hud.showScoreForm(readName());
    void loadBoard(TOP_N);
  };

  // Nobody has touched the summary for a while, so put the title back up for
  // whoever walks up next. The run itself is already over -- this only swaps
  // the screen, so a T-pose still launches straight from here.
  hud.onIdle = () => hud.attract(poseAvailable);

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

  /** Bring the pose stack up. Safe to call twice; the second is a no-op. */
  const startPose = async () => {
    if (poseInput) return;
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
  };

  /** Everything that needs a user gesture: audio unlock, then the camera. */
  const enableAndStart = async () => {
    coachingRequested = true;
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
      await startPose();
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

  /**
   * Start the camera without waiting for a click, but only where permission
   * was already granted for this origin -- a machine that has run this before.
   *
   * That is what lets the title screen accept a T-pose like every other
   * screen: a player standing across the room can walk up to a cold page and
   * launch without touching anything. On a first visit the query comes back
   * "prompt" and nothing happens, so the permission dialog still only ever
   * appears behind a deliberate press of START.
   *
   * Audio is untouched here. Browsers will not unlock an AudioContext without
   * a gesture, so sound waits for the first press or the first launch.
   */
  const startPoseIfAlreadyPermitted = async () => {
    try {
      const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
      if (status?.state !== "granted") return;
    } catch {
      // Firefox and Safari reject "camera" as a permission name. No query, no
      // auto-start: the button still works.
      return;
    }

    try {
      await startPose();
      game.ready();
    } catch (err) {
      console.warn("Camera was permitted but would not start", err);
    }
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
  // Warm the board so the first run's rank ribbon has something to rank
  // against. Nothing is on screen to show it yet; this is purely the cache.
  void loadBoard(TOP_N);
  void startPoseIfAlreadyPermitted();
}

main();
