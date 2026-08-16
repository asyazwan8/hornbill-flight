import * as THREE from "three";
import { clamp, damp, lerp, type FlightInput } from "./types";

// Vertical motion is kept gentle on purpose. With a violent climb and dive
// the bird overshoots every star, because shoulder-steering is nowhere near
// precise enough to correct a 30 unit/second plunge.
const FORWARD_SPEED = 32;
// Heavy drag against a modest gravity gives a slow steady sink (about 12
// units/second) instead of an accelerating fall, so a bird left alone drifts
// gently down toward the canopy and one wingbeat visibly lifts it again.
const GRAVITY = 11;
const FLAP_IMPULSE = 10;
const VY_MAX = 15;
const VY_MIN = -18;
const AIR_DRAG = 0.9;

/** Divebomb: extra downward pull, a speed bonus, and a deeper terminal drop. */
const DIVE_ACCEL = 46;
const DIVE_SPEED_BONUS = 0.7;
const DIVE_VY_MIN = -44;

const TURN_RATE = 1.5; // radians per second at full steer
/** Diving stiffens the turn — a tucked bird does not carve. */
const DIVE_TURN_SCALE = 0.55;
const MAX_BANK = 0.62; // radians
const MAX_PITCH = 0.42;
const MAX_PITCH_DIVE = 0.95;

/**
 * The bird now flies down among the treetops, so there is deliberately no soft
 * floor holding it up: sink far enough and you hit the canopy. GROUND_Y only
 * stops the bird falling through the world before the crash check runs.
 */
export const START_ALTITUDE = 55;
export const GROUND_Y = 5;
export const MAX_ALTITUDE = 135;

/** Seconds without a flap before the bird counts as gliding. */
const GLIDE_AFTER = 0.55;

/**
 * The flight model. Deliberately arcade: constant forward speed, gravity you
 * beat by flapping, and steering that banks into the turn.
 */
export class Flight {
  readonly position = new THREE.Vector3(0, START_ALTITUDE, 0);
  heading = 0;
  vy = 0;

  bank = 0;
  pitch = 0;
  steer = 0;
  /** Smoothed dive amount, 0..1. Exposed so the bird and camera can react. */
  dive = 0;

  private sinceFlap = 99;

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get gliding(): boolean {
    return this.sinceFlap > GLIDE_AFTER;
  }

  get altitude(): number {
    return this.position.y;
  }

  reset() {
    this.position.set(0, START_ALTITUDE, 0);
    this.heading = 0;
    this.vy = 0;
    this.bank = 0;
    this.pitch = 0;
    this.steer = 0;
    this.dive = 0;
    this.sinceFlap = 99;
  }

  /** @returns the flap strength applied this frame, for the wing animation */
  update(dt: number, input: FlightInput): number {
    this.sinceFlap += dt;

    // Dive is held, not pulsed, so it is eased in and out. That also stops a
    // flickering pose signal from stuttering the bird between states.
    this.dive = damp(this.dive, clamp(input.dive, 0, 1), 9, dt);

    let flapped = 0;
    // A tucked bird cannot beat its wings; ignoring the flap here means a
    // stray arm movement mid-dive does not cancel the drop.
    if (input.flap > 0 && this.dive < 0.5) {
      this.vy += FLAP_IMPULSE * input.flap;
      this.sinceFlap = 0;
      flapped = input.flap;
    }

    this.vy -= (GRAVITY + DIVE_ACCEL * this.dive) * dt;
    this.vy -= this.vy * AIR_DRAG * dt;
    this.vy = clamp(this.vy, lerp(VY_MIN, DIVE_VY_MIN, this.dive), VY_MAX);

    // Steering. The raw input is smoothed here so a jittery pose signal still
    // produces a calm turn.
    this.steer = damp(this.steer, clamp(input.steer, -1, 1), 7, dt);
    // Facing +Z, increasing heading turns left, so a right steer subtracts.
    this.heading -= this.steer * TURN_RATE * (1 - this.dive * (1 - DIVE_TURN_SCALE)) * dt;

    this.position.y += this.vy * dt;
    this.position.addScaledVector(this.forward, FORWARD_SPEED * (1 + DIVE_SPEED_BONUS * this.dive) * dt);

    // Hard floor only, so the bird cannot drop through the world while the
    // crash check is deciding. There is no soft floor: sinking is a real risk.
    if (this.position.y < GROUND_Y) {
      this.position.y = GROUND_Y;
      this.vy = Math.max(this.vy, 0);
    }
    if (this.position.y > MAX_ALTITUDE) {
      this.vy -= (this.position.y - MAX_ALTITUDE) * 4 * dt;
    }

    this.bank = this.steer * MAX_BANK;
    // Diving points the nose much further down than ordinary sink ever does.
    const pitchRange = lerp(MAX_PITCH, MAX_PITCH_DIVE, this.dive);
    this.pitch = clamp(this.vy / VY_MAX, -1, 1) * pitchRange;

    return flapped;
  }

  /** True while the bird is meaningfully tucked into a dive. */
  get isDiving(): boolean {
    return this.dive > 0.35;
  }

  /**
   * Where the bird will be if the player holds the current course and does not
   * flap.
   *
   * This runs the real `update()` on a throwaway copy rather than
   * reimplementing the integration, so the aiming reticle cannot drift out of
   * agreement with the flight model — there is only one set of physics.
   */
  predictPath(seconds: number, samples: number, into: THREE.Vector3[] = []): THREE.Vector3[] {
    const ghost = Flight.ghost;
    ghost.position.copy(this.position);
    ghost.vy = this.vy;
    ghost.heading = this.heading;
    ghost.steer = this.steer;
    ghost.dive = this.dive;

    const dt = seconds / samples;
    for (let i = 0; i < samples; i++) {
      ghost.update(dt, { flap: 0, steer: this.steer, dive: this.dive });
      if (into[i]) into[i].copy(ghost.position);
      else into[i] = ghost.position.clone();
    }
    into.length = samples;
    return into;
  }

  /** Reused so predicting a path every frame does not allocate. */
  private static ghost = new Flight();
}
