/** Everything the flight model needs, whatever produced it. */
export type FlightInput = {
  /** Lift impulse requested this frame, 0..1. Non-zero only on the frame a flap fires. */
  flap: number;
  /** Steering, -1 (hard left) .. 1 (hard right). */
  steer: number;
};

export const NO_INPUT: FlightInput = { flap: 0, steer: 0 };

export type GamePhase = "loading" | "waiting" | "playing" | "gameover";

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate independent smoothing: the fraction of the way to `b` per second. */
export const damp = (a: number, b: number, rate: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-rate * dt));
