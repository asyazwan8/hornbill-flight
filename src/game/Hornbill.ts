import * as THREE from "three";
import { damp } from "./types";

// A rhinoceros hornbill is black, but a true black bird reads as a hole
// against the forest. These are dark slate blues: still unmistakably a dark
// bird, with enough internal contrast to show the wings and head in flight.
const BODY = "#3a4260";
const DARK = "#272e44";
const CREAM = "#f7eed6";
const BEAK = "#ffc154";
const CASQUE = "#f2603a";

function part(geo: THREE.BufferGeometry, color: string) {
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
}

/**
 * Extrude a flat outline into a thin horizontal panel.
 *
 * The outline is written in the XY plane (y = along the bird, +y forward) and
 * rotated flat, which makes tapered wings and tail feathers easy to describe
 * as a handful of points.
 */
function panel(points: [number, number][], thickness: number, color: string) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); // shape y -> world z, extrusion -> world thickness
  geo.translate(0, thickness / 2, 0);
  return part(geo, color);
}

/**
 * A low-poly rhinoceros hornbill — the Sarawak kenyalang.
 *
 * Local space: +Z is forward, +Y is up, +X is the bird's left. Wings pivot at
 * the shoulders so a flap is a single rotation per side.
 */
export class Hornbill {
  readonly group = new THREE.Group();

  /** Wings named by the axis they extend along, to keep the maths honest. */
  private wingPosX = new THREE.Group();
  private wingNegX = new THREE.Group();
  private head = new THREE.Group();
  private tail!: THREE.Mesh;

  /** 0 = wings level, driven by flaps and decaying on its own. */
  private flapPhase = 0;
  private flapEnergy = 0;
  private glide = 0;
  private tuck = 0;

  constructor() {
    // Roll has to come before yaw or the bird banks around the world axis
    // instead of its own.
    this.group.rotation.order = "YXZ";
    this.buildBody();
    this.buildHead();
    this.buildWings();
    this.group.add(this.wingPosX, this.wingNegX, this.head);
    // Sized for the chase camera: big enough to read its shape at 46 units.
    this.group.scale.setScalar(1.4);
  }

  private buildBody() {
    const body = part(new THREE.IcosahedronGeometry(2.2, 1), BODY);
    body.scale.set(1, 0.94, 1.7);
    this.group.add(body);

    const chest = part(new THREE.IcosahedronGeometry(1.6, 0), "#4c5578");
    chest.scale.set(0.95, 0.8, 1.2);
    chest.position.set(0, -0.55, 1.2);
    this.group.add(chest);

    // Tail: white with the black band the species is known for. Tapered, and
    // the closest part of the bird to the chase camera, so it does a lot of
    // the work of showing which way the bird is banking.
    this.tail = panel(
      [
        [-1.5, 0],
        [1.5, 0],
        [1.1, -5.2],
        [-1.1, -5.2],
      ],
      0.3,
      CREAM
    );
    this.tail.position.set(0, 0.1, -2.6);
    this.group.add(this.tail);

    const band = panel(
      [
        [-1.2, 0],
        [1.2, 0],
        [1.1, -1.1],
        [-1.1, -1.1],
      ],
      0.36,
      DARK
    );
    band.position.set(0, 0.08, -6.7);
    this.group.add(band);
  }

  private buildHead() {
    // The head sits clearly forward of the body. Buried in it, the whole bird
    // reads as a featureless blob from behind.
    const skull = part(new THREE.IcosahedronGeometry(1.45, 0), DARK);
    skull.scale.set(1, 1.05, 1.15);
    skull.position.set(0, 1.62, 4.6);
    this.head.add(skull);

    // Pale collar — the one bright thing visible from directly behind.
    const collar = part(new THREE.CylinderGeometry(1.35, 1.55, 1.5, 7), CREAM);
    collar.position.set(0, 0.95, 3.2);
    collar.rotation.x = 0.5;
    this.head.add(collar);

    // The bill: long, deep and tapered. On a real hornbill it is close to
    // head-and-body length, and it is what makes the silhouette legible.
    const bill = panel(
      [
        [-0.62, 0],
        [0.62, 0],
        [0.16, 6.6],
        [-0.16, 6.6],
      ],
      1.15,
      BEAK
    );
    bill.position.set(0, 1.08, 5.1);
    bill.rotation.x = -0.07;
    this.head.add(bill);

    // The casque — the upcurved horn along the top of the bill, and the whole
    // point of a hornbill silhouette. Bright, so it shows up from behind.
    const casque = panel(
      [
        [-0.5, 0],
        [0.5, 0],
        [0.34, 3.9],
        [-0.34, 3.9],
      ],
      0.95,
      CASQUE
    );
    casque.position.set(0, 1.98, 5.0);
    casque.rotation.x = 0.16;
    this.head.add(casque);

    // Upcurved tip of the casque. Seated on the front of the casque panel —
    // any higher and it floats above the head like a party hat.
    const horn = new THREE.ConeGeometry(0.52, 2.0, 5);
    horn.rotateX(Math.PI / 2.4);
    const hornMesh = part(horn, CASQUE);
    hornMesh.position.set(0, 2.26, 8.1);
    this.head.add(hornMesh);

    for (const side of [-1, 1]) {
      const eye = part(new THREE.SphereGeometry(0.26, 6, 5), CREAM);
      eye.position.set(side * 1.0, 1.92, 5.15);
      this.head.add(eye);
      const pupil = part(new THREE.SphereGeometry(0.14, 5, 4), "#14161c");
      pupil.position.set(side * 1.12, 1.92, 5.35);
      this.head.add(pupil);
    }
  }

  private buildWings() {
    for (const side of [1, -1] as const) {
      const wing = side === 1 ? this.wingPosX : this.wingNegX;
      wing.position.set(side * 1.4, 0.45, 0.3);

      // Tapered and swept back, rather than a rectangular plank.
      const outline: [number, number][] = [
        [0, 2.9],
        [side * 5.0, 2.4],
        [side * 9.5, 1.4],
        [side * 12.8, 0.0],
        [side * 9.8, -1.6],
        [side * 4.8, -2.7],
        [0, -3.0],
      ];
      wing.add(panel(outline, 0.45, BODY));

      // Darker primaries laid over the outer third.
      const primaries: [number, number][] = [
        [side * 7.2, 1.8],
        [side * 12.8, 0.0],
        [side * 9.8, -1.6],
        [side * 7.0, -2.1],
      ];
      const tip = panel(primaries, 0.5, DARK);
      tip.position.y = 0.04;
      wing.add(tip);

      // White trailing flash, the field mark on the real bird.
      const flash = panel(
        [
          [side * 5.0, -2.2],
          [side * 9.4, -1.35],
          [side * 9.6, -1.9],
          [side * 5.0, -2.8],
        ],
        0.52,
        CREAM
      );
      flash.position.y = 0.05;
      wing.add(flash);
    }
  }

  /** Called when the flight model registers a flap, 0..1 strength. */
  onFlap(strength: number) {
    this.flapEnergy = Math.min(this.flapEnergy + strength * 0.9, 1.2);
    this.flapPhase = 0;
  }

  /**
   * @param bank    roll angle in radians, from steering
   * @param pitch   pitch angle in radians, from vertical speed
   * @param gliding true when the bird has not flapped recently
   * @param dive    0..1 divebomb amount, which tucks and sweeps the wings
   */
  update(dt: number, bank: number, pitch: number, gliding: boolean, dive = 0) {
    // A flap is one cycle of `flapPhase`; energy decays so the wings settle
    // into a glide when the player stops flapping.
    if (this.flapEnergy > 0.001) {
      this.flapPhase += dt * 7.5;
      this.flapEnergy = Math.max(0, this.flapEnergy - dt * 1.35);
      if (this.flapPhase > Math.PI * 2) {
        this.flapPhase -= Math.PI * 2;
        this.flapEnergy = Math.max(0, this.flapEnergy - 0.25);
      }
    }

    this.glide = damp(this.glide, gliding ? 1 : 0, 4, dt);
    this.tuck = damp(this.tuck, dive, 9, dt);

    // Idle glide keeps a slow breathing motion so the bird never looks frozen.
    const t = performance.now() * 0.001;
    const idle = Math.sin(t * 1.6) * 0.09 * this.glide;
    // Wing beats fade out as the bird tucks: a diving hornbill is not flapping.
    const beat = Math.sin(this.flapPhase) * this.flapEnergy * 0.9 * (1 - this.tuck);
    // Positive dihedral raises both wings; tucking pulls them down and in.
    const dihedral = 0.15 + idle + beat - this.tuck * 0.75;

    this.wingPosX.rotation.z = dihedral;
    this.wingNegX.rotation.z = -dihedral;
    // Wings sweep back a little at the top of the stroke, and hard back in a
    // dive, which is what makes the tucked silhouette read as speed.
    this.wingPosX.rotation.y = -beat * 0.14 - this.tuck * 1.0;
    this.wingNegX.rotation.y = beat * 0.14 + this.tuck * 1.0;

    // Draw the wings in toward the body as they sweep, so a dive narrows the
    // whole silhouette rather than just rotating two planks.
    const span = 1 - this.tuck * 0.3;
    this.wingPosX.scale.set(span, 1, 1);
    this.wingNegX.scale.set(span, 1, 1);

    this.group.rotation.z = damp(this.group.rotation.z, bank, 6, dt);
    this.group.rotation.x = damp(this.group.rotation.x, pitch, 5, dt);

    // The head counter-rolls a little, which reads as the bird looking where
    // it is going rather than being a rigid model.
    this.head.rotation.z = -this.group.rotation.z * 0.35;
    this.tail.rotation.y = -this.group.rotation.z * 0.25;
  }
}
