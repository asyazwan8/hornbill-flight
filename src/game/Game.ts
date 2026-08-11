import * as THREE from "three";
import { World, FOG_COLOR } from "./World";
import { Hornbill } from "./Hornbill";
import { Stars } from "./Stars";
import { Flight } from "./Flight";
import { NO_INPUT, damp, type FlightInput, type GamePhase } from "./types";

export const ROUND_SECONDS = 60;

export interface InputSource {
  /** Sampled once per frame while flying. */
  sample(dt: number): FlightInput;
  /** True on the frame the player asks to launch (a held T-pose, a keypress). */
  startRequested(): boolean;
}

export type GameEvents = {
  onPhase?: (phase: GamePhase) => void;
  onScore?: (score: number) => void;
  onTime?: (secondsLeft: number) => void;
};

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  private world: World;
  private bird = new Hornbill();
  private stars: Stars;
  private flight = new Flight();

  private input: InputSource | null = null;
  private events: GameEvents;

  phase: GamePhase = "loading";
  score = 0;
  timeLeft = ROUND_SECONDS;

  // Timer (not the deprecated Clock) also hooks the Page Visibility API, so a
  // backgrounded tab does not come back with a huge delta.
  private timer = new THREE.Timer();
  private lastWholeSecond = ROUND_SECONDS;
  private camLook = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, events: GameEvents = {}) {
    this.events = events;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(FOG_COLOR);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 6000);

    this.world = new World(this.scene);
    this.stars = new Stars(this.scene);
    this.scene.add(this.bird.group);

    this.placeCameraBehindBird(true);
    this.stars.reset(this.flight.position, this.flight.heading);

    window.addEventListener("resize", this.onResize);
  }

  setInputSource(input: InputSource) {
    this.input = input;
  }

  private setPhase(phase: GamePhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.events.onPhase?.(phase);
  }

  /** Ready to fly, waiting for the player's start signal. */
  ready() {
    if (this.phase === "loading") this.setPhase("waiting");
  }

  startRun() {
    this.score = 0;
    this.timeLeft = ROUND_SECONDS;
    this.lastWholeSecond = ROUND_SECONDS;
    this.flight.reset();
    this.stars.reset(this.flight.position, this.flight.heading);
    this.placeCameraBehindBird(true);
    this.events.onScore?.(0);
    this.events.onTime?.(ROUND_SECONDS);
    this.setPhase("playing");
  }

  private endRun() {
    this.setPhase("gameover");
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  /**
   * Chase camera: high behind the bird and angled down, so the player reads the
   * hornbill's back, beak and casque against the forest instead of a
   * silhouette seen edge-on.
   */
  private placeCameraBehindBird(snap = false, dt = 0) {
    const forward = this.flight.forward;
    const desired = this.flight.position
      .clone()
      .addScaledVector(forward, -46)
      .add(new THREE.Vector3(0, 28, 0));
    // Swing out slightly on the outside of a turn.
    desired.addScaledVector(
      new THREE.Vector3(-Math.cos(this.flight.heading), 0, Math.sin(this.flight.heading)),
      this.flight.steer * -7
    );

    const lookAhead = new THREE.Vector3(0, -7, 0);
    if (snap) {
      this.camera.position.copy(desired);
      this.camLook.copy(this.flight.position).addScaledVector(forward, 30).add(lookAhead);
    } else {
      this.camera.position.x = damp(this.camera.position.x, desired.x, 6, dt);
      this.camera.position.y = damp(this.camera.position.y, desired.y, 4, dt);
      this.camera.position.z = damp(this.camera.position.z, desired.z, 6, dt);
      const target = this.flight.position.clone().addScaledVector(forward, 30).add(lookAhead);
      this.camLook.x = damp(this.camLook.x, target.x, 7, dt);
      this.camLook.y = damp(this.camLook.y, target.y, 5, dt);
      this.camLook.z = damp(this.camLook.z, target.z, 7, dt);
    }
    this.camera.lookAt(this.camLook);
  }

  private tick = (timestamp: number) => {
    requestAnimationFrame(this.tick);
    this.timer.update(timestamp);
    const elapsed = this.timer.getDelta();
    // Cap the simulation step so one slow frame cannot teleport the bird
    // through a star. The countdown deliberately uses the uncapped delta, or a
    // machine rendering below 20fps would get a minute that lasts far longer
    // than a minute. Timer is connected to the Page Visibility API, so a
    // backgrounded tab does not burn the clock either.
    const dt = Math.min(elapsed, 0.05);

    if (this.phase === "waiting" || this.phase === "gameover") {
      // Idle: the bird drifts on a slow circle so the menu has something alive
      // behind it, and we watch for the player's start signal.
      this.flight.update(dt, { flap: this.idleFlap(dt), steer: 0.32 });
      if (this.input?.startRequested()) this.startRun();
    } else if (this.phase === "playing") {
      const input: FlightInput = this.input ? this.input.sample(dt) : NO_INPUT;
      const flapped = this.flight.update(dt, input);
      if (flapped > 0) this.bird.onFlap(flapped);

      const got = this.stars.update(dt, this.flight.position, this.flight.heading);
      if (got > 0) {
        this.score += got;
        this.events.onScore?.(this.score);
      }

      this.timeLeft = Math.max(0, this.timeLeft - elapsed);
      const whole = Math.ceil(this.timeLeft);
      if (whole !== this.lastWholeSecond) {
        this.lastWholeSecond = whole;
        this.events.onTime?.(whole);
      }
      if (this.timeLeft <= 0) this.endRun();
    }

    this.bird.group.position.copy(this.flight.position);
    this.bird.group.rotation.y = this.flight.heading;
    this.bird.update(dt, this.flight.bank, this.flight.pitch, this.flight.gliding);

    this.world.update(this.flight.position);
    if (this.phase !== "playing") this.stars.update(dt, this.flight.position, this.flight.heading);

    this.placeCameraBehindBird(false, dt);
    this.renderer.render(this.scene, this.camera);
  };

  /** Keeps the idle bird aloft without any player input. */
  private idleTimer = 0;
  private idleFlap(dt: number): number {
    this.idleTimer += dt;
    if (this.idleTimer > 0.85) {
      this.idleTimer = 0;
      return 0.75;
    }
    return 0;
  }

  run() {
    this.timer.connect(document);
    requestAnimationFrame(this.tick);
  }
}
