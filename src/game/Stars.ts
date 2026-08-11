import * as THREE from "three";
import { clamp } from "./types";

const STAR_COUNT = 16;
/** Generous on purpose: steering with your shoulders is not precise. */
const COLLECT_RADIUS = 8.0;

/** Where new stars appear, measured along the bird's heading. */
const SPAWN_AHEAD_MIN = 110;
const SPAWN_AHEAD_MAX = 320;
const SPAWN_SIDE = 120;
/**
 * Stars spawn in a band around the bird's current height rather than at fixed
 * altitudes. A player who flaps hard climbs to the ceiling, and with a fixed
 * band every star would sit below them, unreachable, for the whole round.
 */
const SPAWN_BELOW = 55;
const SPAWN_ABOVE = 45;
const SPAWN_Y_MIN = 46;
const SPAWN_Y_MAX = 195;
/** A star this far behind the bird is out of play and gets recycled ahead. */
const RECYCLE_BEHIND = 90;

type Burst = {
  mesh: THREE.Mesh;
  life: number;
};

/**
 * The collectables. A fixed pool of stars is recycled ahead of the bird, so
 * there is always something to chase and the scene never accumulates objects.
 */
export class Stars {
  readonly group = new THREE.Group();

  private stars: THREE.Mesh[] = [];
  private spin: number[] = [];
  private bursts: Burst[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.OctahedronGeometry(2.4, 0);
    const mat = new THREE.MeshLambertMaterial({
      color: "#ffd257",
      emissive: "#ffae1a",
      emissiveIntensity: 0.75,
      flatShading: true,
    });

    for (let i = 0; i < STAR_COUNT; i++) {
      const star = new THREE.Mesh(geo, mat);
      star.scale.setScalar(1);

      // A soft halo so stars stay findable against a bright sky.
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(4.4, 8, 6),
        new THREE.MeshBasicMaterial({
          color: "#ffd98a",
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        })
      );
      star.add(halo);

      this.stars.push(star);
      this.spin.push(Math.random() * Math.PI * 2);
      this.group.add(star);
    }

    const burstGeo = new THREE.IcosahedronGeometry(2.2, 0);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        burstGeo,
        new THREE.MeshBasicMaterial({
          color: "#fff0b8",
          transparent: true,
          opacity: 0,
          wireframe: true,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      this.bursts.push({ mesh, life: 0 });
      this.group.add(mesh);
    }

    scene.add(this.group);
  }

  /** Live star positions. Used by the headless tests and for debugging. */
  get positions(): readonly THREE.Vector3[] {
    return this.stars.map((s) => s.position);
  }

  /** Scatter the whole pool ahead of the bird for a fresh run. */
  reset(birdPos: THREE.Vector3, heading: number) {
    for (let i = 0; i < this.stars.length; i++) {
      this.placeAhead(this.stars[i], birdPos, heading, i / this.stars.length);
      this.stars[i].visible = true;
      this.stars[i].scale.setScalar(1);
    }
    for (const b of this.bursts) {
      b.life = 0;
      b.mesh.visible = false;
    }
  }

  private placeAhead(star: THREE.Mesh, birdPos: THREE.Vector3, heading: number, bias = Math.random()) {
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);

    const ahead = SPAWN_AHEAD_MIN + bias * (SPAWN_AHEAD_MAX - SPAWN_AHEAD_MIN);
    const side = (Math.random() - 0.5) * 2 * SPAWN_SIDE;
    const y = clamp(
      birdPos.y - SPAWN_BELOW + Math.random() * (SPAWN_BELOW + SPAWN_ABOVE),
      SPAWN_Y_MIN,
      SPAWN_Y_MAX
    );

    star.position
      .copy(birdPos)
      .addScaledVector(forward, ahead)
      .addScaledVector(right, side);
    star.position.y = y;
  }

  private spawnBurst(at: THREE.Vector3) {
    const burst = this.bursts.find((b) => b.life <= 0) ?? this.bursts[0];
    burst.mesh.position.copy(at);
    burst.mesh.scale.setScalar(1);
    burst.mesh.visible = true;
    burst.life = 1;
  }

  /**
   * Advance the stars and collect any the bird touched.
   * @returns how many stars were collected this frame
   */
  update(dt: number, birdPos: THREE.Vector3, heading: number): number {
    let collected = 0;
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const toStar = new THREE.Vector3();
    const t = performance.now() * 0.001;

    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      star.rotation.y = this.spin[i] + t * 1.2;
      star.rotation.x = Math.sin(t * 0.8 + i) * 0.3;
      star.position.y += Math.sin(t * 1.5 + i * 2.1) * dt * 2.2;

      toStar.subVectors(star.position, birdPos);

      if (toStar.length() < COLLECT_RADIUS) {
        collected++;
        this.spawnBurst(star.position);
        this.placeAhead(star, birdPos, heading);
        continue;
      }

      // Recycle stars that have fallen behind, drifted far to the side, or
      // been left stranded far above or below by a climbing player.
      const along = toStar.dot(forward);
      if (
        along < -RECYCLE_BEHIND ||
        toStar.length() > SPAWN_AHEAD_MAX + 220 ||
        Math.abs(star.position.y - birdPos.y) > 115
      ) {
        this.placeAhead(star, birdPos, heading);
      }
    }

    for (const b of this.bursts) {
      if (b.life <= 0) continue;
      b.life = Math.max(0, b.life - dt * 1.8);
      const grow = 1 + (1 - b.life) * 3.2;
      b.mesh.scale.setScalar(grow);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = clamp(b.life, 0, 1) * 0.9;
      if (b.life <= 0) b.mesh.visible = false;
    }

    return collected;
  }
}
