import * as THREE from "three";
import { clamp, damp, type FlightInput } from "./types";

const FORWARD_SPEED = 36;
const GRAVITY = 21;
const FLAP_IMPULSE = 15;
const VY_MAX = 23;
const VY_MIN = -30;
const AIR_DRAG = 0.5;

const TURN_RATE = 1.5; // radians per second at full steer
const MAX_BANK = 0.62; // radians
const MAX_PITCH = 0.42;

/** Soft ceiling and floor. The bird is eased back rather than hard-clamped. */
const MIN_ALTITUDE = 40;
const MAX_ALTITUDE = 205;

/** Seconds without a flap before the bird counts as gliding. */
const GLIDE_AFTER = 0.55;

/**
 * The flight model. Deliberately arcade: constant forward speed, gravity you
 * beat by flapping, and steering that banks into the turn.
 */
export class Flight {
  readonly position = new THREE.Vector3(0, 90, 0);
  heading = 0;
  vy = 0;

  bank = 0;
  pitch = 0;
  steer = 0;

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
    this.position.set(0, 90, 0);
    this.heading = 0;
    this.vy = 0;
    this.bank = 0;
    this.pitch = 0;
    this.steer = 0;
    this.sinceFlap = 99;
  }

  /** @returns the flap strength applied this frame, for the wing animation */
  update(dt: number, input: FlightInput): number {
    this.sinceFlap += dt;

    let flapped = 0;
    if (input.flap > 0) {
      this.vy += FLAP_IMPULSE * input.flap;
      this.sinceFlap = 0;
      flapped = input.flap;
    }

    this.vy -= GRAVITY * dt;
    this.vy -= this.vy * AIR_DRAG * dt;
    this.vy = clamp(this.vy, VY_MIN, VY_MAX);

    // Steering. The raw input is smoothed here so a jittery pose signal still
    // produces a calm turn.
    this.steer = damp(this.steer, clamp(input.steer, -1, 1), 7, dt);
    // Facing +Z, increasing heading turns left, so a right steer subtracts.
    this.heading -= this.steer * TURN_RATE * dt;

    this.position.y += this.vy * dt;
    this.position.addScaledVector(this.forward, FORWARD_SPEED * dt);

    // Soft boundaries: push back gently instead of stopping dead.
    if (this.position.y < MIN_ALTITUDE) {
      const depth = MIN_ALTITUDE - this.position.y;
      this.vy += depth * 5.5 * dt;
      if (this.position.y < MIN_ALTITUDE - 12) this.position.y = MIN_ALTITUDE - 12;
    }
    if (this.position.y > MAX_ALTITUDE) {
      this.vy -= (this.position.y - MAX_ALTITUDE) * 4 * dt;
    }

    this.bank = this.steer * MAX_BANK;
    this.pitch = clamp(this.vy / VY_MAX, -1, 1) * MAX_PITCH;

    return flapped;
  }
}
