import * as THREE from "three";

/** Half-width of the tile the forest wraps around. Trees teleport at this
 *  distance from the bird, which fog keeps well out of sight. */
const TILE = 620;
const TREE_COUNT = 900;

/**
 * Crown geometry, kept here so collision and rendering cannot disagree.
 * ConeGeometry(5.2, 16) is centred, then translated +16, so in local space the
 * crown runs from y=8 up to a point at y=24 with a base radius of 5.2. Every
 * instance is then scaled and dropped to y=-2.
 */
const CROWN_RADIUS = 5.2;
const CROWN_BASE_Y = 8;
const CROWN_APEX_Y = 24;
const TREE_BASE_OFFSET = -2;

const SKY_TOP = new THREE.Color("#2a6bc4");
const SKY_BOTTOM = new THREE.Color("#cbe8f7");
/** Matches the bottom of the sky gradient, so the horizon dissolves instead of
 *  ending in a visible band of fog. */
export const FOG_COLOR = new THREE.Color("#cbe8f7");

/** A seeded RNG so the forest looks the same on every run. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * The sky, the ground and an endless low-poly forest.
 *
 * The ground is a single large static plane; the trees are two instanced
 * meshes whose instances wrap around the bird, so the forest has constant
 * density no matter how far you fly without ever growing the instance count.
 */
export class World {
  readonly group = new THREE.Group();

  private treeTrunks!: THREE.InstancedMesh;
  private treeCrowns!: THREE.InstancedMesh;
  /** Base position of each tree, before wrapping. */
  private treeBase: THREE.Vector3[] = [];
  private treeScale: number[] = [];
  /** Wrap offset currently baked into each instance matrix, in tiles. */
  private wrapX: Int16Array = new Int16Array(TREE_COUNT);
  private wrapZ: Int16Array = new Int16Array(TREE_COUNT);
  private dummy = new THREE.Object3D();

  /** Live collision shape for each tree, kept in step with the matrices. */
  private treeX = new Float32Array(TREE_COUNT);
  private treeZ = new Float32Array(TREE_COUNT);
  private treeApex = new Float32Array(TREE_COUNT);
  private treeCrownBase = new Float32Array(TREE_COUNT);
  private treeRadius = new Float32Array(TREE_COUNT);

  constructor(scene: THREE.Scene) {
    scene.fog = new THREE.Fog(FOG_COLOR, 320, 1150);
    this.buildSky();
    this.buildGround();
    this.buildForest();
    this.buildLights();
    scene.add(this.group);
  }

  private buildSky() {
    // A big inverted sphere with a vertical gradient. Cheaper and calmer than
    // a skybox, and it never needs to move with the camera because it is huge.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          topColor: { value: SKY_TOP },
          bottomColor: { value: SKY_BOTTOM },
        },
        vertexShader: /* glsl */ `
          varying float vH;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vH = normalize(world.xyz).y;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          varying float vH;
          void main() {
            float t = smoothstep(-0.05, 0.65, vH);
            gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
          }
        `,
      })
    );
    sky.frustumCulled = false;
    this.group.add(sky);
  }

  private buildGround() {
    const size = 9000;
    const segments = 90;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    // Nudge each vertex to break up the flatness. Low frequency only: the
    // forest reads as rolling ground rather than noise.
    const pos = geo.attributes.position;
    const rng = makeRng(7);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h =
        Math.sin(x * 0.0035) * Math.cos(z * 0.0041) * 8 +
        Math.sin(x * 0.011 + 1.7) * Math.cos(z * 0.009) * 4 +
        (rng() - 0.5) * 2.5;
      pos.setY(i, h);
    }
    geo.computeVertexNormals();

    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: "#639a4e", flatShading: true })
    );
    ground.receiveShadow = false;
    this.group.add(ground);

    // A darker under-canopy layer so gaps between trees do not read as bald.
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color: "#41703f" })
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = -6;
    this.group.add(under);
  }

  private buildForest() {
    const trunkGeo = new THREE.CylinderGeometry(0.7, 1.1, 10, 5);
    trunkGeo.translate(0, 5, 0);
    const crownGeo = new THREE.ConeGeometry(5.2, 16, 6);
    crownGeo.translate(0, 16, 0);

    const trunkMat = new THREE.MeshLambertMaterial({ color: "#7d5c3d", flatShading: true });
    // No `vertexColors` here on purpose. The renderer defines USE_COLOR in the
    // vertex stage only for vertexColors, so setting it on a geometry with no
    // color attribute multiplies the instance colour by zero and every tree
    // comes out black. InstancedMesh.setColorAt works on its own.
    const crownMat = new THREE.MeshLambertMaterial({ flatShading: true });

    this.treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
    this.treeCrowns = new THREE.InstancedMesh(crownGeo, crownMat, TREE_COUNT);
    this.treeTrunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.treeCrowns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.treeTrunks.frustumCulled = false;
    this.treeCrowns.frustumCulled = false;

    const rng = makeRng(1337);
    const green = new THREE.Color();
    for (let i = 0; i < TREE_COUNT; i++) {
      const x = (rng() - 0.5) * TILE * 2;
      const z = (rng() - 0.5) * TILE * 2;
      this.treeBase.push(new THREE.Vector3(x, 0, z));
      // Kept modest so the canopy stays below the minimum flight altitude.
      this.treeScale.push(0.6 + rng() * 0.55);

      green.setHSL(0.26 + rng() * 0.08, 0.38 + rng() * 0.22, 0.32 + rng() * 0.16);
      this.treeCrowns.setColorAt(i, green);
    }
    if (this.treeCrowns.instanceColor) this.treeCrowns.instanceColor.needsUpdate = true;

    this.group.add(this.treeTrunks, this.treeCrowns);
    this.layoutTrees(new THREE.Vector3(), true);
  }

  private buildLights() {
    const sun = new THREE.DirectionalLight("#fff6e0", 2.1);
    sun.position.set(120, 220, 80);
    this.group.add(sun);
    this.group.add(new THREE.HemisphereLight("#cfe8ff", "#3d6b3a", 1.5));
  }

  /**
   * Keep every tree inside one tile centred on the bird. Only instances that
   * actually crossed a tile boundary get their matrix rewritten.
   */
  private layoutTrees(center: THREE.Vector3, force = false) {
    let dirty = force;
    const span = TILE * 2;
    for (let i = 0; i < TREE_COUNT; i++) {
      const base = this.treeBase[i];
      const wx = Math.round((center.x - base.x) / span);
      const wz = Math.round((center.z - base.z) / span);
      if (!force && wx === this.wrapX[i] && wz === this.wrapZ[i]) continue;

      this.wrapX[i] = wx;
      this.wrapZ[i] = wz;
      dirty = true;

      const s = this.treeScale[i];
      const yScale = s * (0.85 + (i % 7) * 0.05);
      const x = base.x + wx * span;
      const z = base.z + wz * span;
      this.dummy.position.set(x, TREE_BASE_OFFSET, z);
      this.dummy.scale.set(s, yScale, s);
      this.dummy.rotation.y = i * 1.7;
      this.dummy.updateMatrix();
      this.treeTrunks.setMatrixAt(i, this.dummy.matrix);
      this.treeCrowns.setMatrixAt(i, this.dummy.matrix);

      // Derive the collision cone from the very same transform, so a tree can
      // never be hit where it is not drawn.
      this.treeX[i] = x;
      this.treeZ[i] = z;
      this.treeApex[i] = TREE_BASE_OFFSET + CROWN_APEX_Y * yScale;
      this.treeCrownBase[i] = TREE_BASE_OFFSET + CROWN_BASE_Y * yScale;
      this.treeRadius[i] = CROWN_RADIUS * s;
    }
    if (dirty) {
      this.treeTrunks.instanceMatrix.needsUpdate = true;
      this.treeCrowns.instanceMatrix.needsUpdate = true;
    }
  }

  update(birdPosition: THREE.Vector3) {
    this.layoutTrees(birdPosition);
  }

  /** Height of the tallest tree, so stars can be kept clear of the canopy. */
  get canopyHeight(): number {
    return TREE_BASE_OFFSET + CROWN_APEX_Y * (0.6 + 0.55) * 1.15;
  }

  /**
   * Does a sphere at `p` touch any tree?
   *
   * Trees are tested as cones rather than cylinders: near the top a crown is
   * barely wider than a twig, and clipping a treetop that is visibly a metre
   * to your left would feel like a cheat. Only 900 instances exist and most
   * are rejected by the first two comparisons, so a full sweep is cheap.
   */
  hitsTree(p: THREE.Vector3, bodyRadius: number): boolean {
    for (let i = 0; i < TREE_COUNT; i++) {
      const apex = this.treeApex[i];
      if (p.y > apex + bodyRadius) continue;

      const dx = p.x - this.treeX[i];
      const dz = p.z - this.treeZ[i];
      const dist2 = dx * dx + dz * dz;

      const widest = this.treeRadius[i] + bodyRadius;
      if (dist2 > widest * widest) continue;

      // Taper the radius toward the point of the cone.
      const crownBase = this.treeCrownBase[i];
      const frac = p.y <= crownBase ? 1 : (apex - p.y) / (apex - crownBase);
      const r = this.treeRadius[i] * Math.max(0, frac) + bodyRadius;
      if (dist2 < r * r) return true;
    }
    return false;
  }
}
