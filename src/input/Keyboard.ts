import type { InputSource } from "../game/Game";
import type { FlightInput } from "../game/types";

/**
 * Keyboard controls. Always active alongside the webcam so the game can be
 * developed, demoed and debugged on a machine with no camera.
 *
 *   Space / ArrowUp    — flap
 *   Arrows / A,D       — steer
 *   ArrowDown / S / ⇧  — divebomb
 *   Enter              — start
 */
export class KeyboardInput implements InputSource {
  private down = new Set<string>();
  private flapQueued = false;
  private startQueued = false;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) {
        // Holding space should not machine-gun flaps.
        if (e.code === "Space") e.preventDefault();
        return;
      }
      this.down.add(e.code);
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        this.flapQueued = true;
        e.preventDefault();
      }
      if (e.code === "Enter" || e.code === "KeyR") this.startQueued = true;
    });

    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
  }

  sample(): FlightInput {
    let steer = 0;
    if (this.down.has("ArrowLeft") || this.down.has("KeyA")) steer -= 1;
    if (this.down.has("ArrowRight") || this.down.has("KeyD")) steer += 1;

    const diving =
      this.down.has("ArrowDown") ||
      this.down.has("KeyS") ||
      this.down.has("ShiftLeft") ||
      this.down.has("ShiftRight");

    const flap = this.flapQueued ? 0.85 : 0;
    this.flapQueued = false;
    return { flap, steer, dive: diving ? 1 : 0 };
  }

  startRequested(): boolean {
    const requested = this.startQueued;
    this.startQueued = false;
    return requested;
  }
}
