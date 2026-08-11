import "./style.css";
import { Game, type InputSource } from "./game/Game";
import type { FlightInput } from "./game/types";
import { Hud } from "./ui/Hud";
import { KeyboardInput } from "./input/Keyboard";
import { PoseInput } from "./pose/PoseInput";

/** Pose and keyboard at the same time; whichever moves, moves the bird. */
class CombinedInput implements InputSource {
  constructor(private sources: InputSource[]) {}

  sample(dt: number): FlightInput {
    let flap = 0;
    let steer = 0;
    for (const s of this.sources) {
      const i = s.sample(dt);
      flap = Math.max(flap, i.flap);
      // The larger deflection wins, so a resting source never cancels an
      // active one.
      if (Math.abs(i.steer) > Math.abs(steer)) steer = i.steer;
    }
    return { flap, steer };
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

  const keyboard = new KeyboardInput();
  let poseInput: PoseInput | null = null;
  let poseAvailable = false;

  const game = new Game(canvas, {
    onScore: (s) => hud.setScore(s),
    onTime: (t) => hud.setTime(t),
    onPhase: (phase) => {
      if (phase === "waiting") hud.waiting(poseAvailable);
      else if (phase === "playing") {
        hud.playing();
        poseInput?.reset();
      } else if (phase === "gameover") hud.gameover(game.score, poseAvailable);
    },
  });

  game.setInputSource(new CombinedInput([keyboard]));
  game.run();

  // The camera prompt lands much better after a deliberate click, and some
  // browsers will not start a webcam without one.
  hud.loading("Click anywhere to turn on your camera, then stand back and strike a T-pose.");

  const enable = async () => {
    document.removeEventListener("click", enable);
    document.removeEventListener("keydown", enable);
    hud.loading("Starting the camera and loading the pose model…");

    try {
      const pose = new PoseInput(video, hud.overlayCanvas);
      await pose.init();
      poseInput = pose;
      poseAvailable = true;

      pose.onUpdate = (status, message, progress) => {
        hud.setPoseStatus(status, message);
        if (game.phase !== "playing") hud.setTposeProgress(progress);
      };

      hud.showPreview();
      game.setInputSource(new CombinedInput([pose, keyboard]));
    } catch (err) {
      console.error("Pose setup failed", err);
      hud.error(describeCameraError(err));
      // Give the player a moment to read it before the menu takes over.
      await new Promise((r) => setTimeout(r, 4000));
    }

    game.ready();
  };

  document.addEventListener("click", enable);
  document.addEventListener("keydown", enable);
}

main();
