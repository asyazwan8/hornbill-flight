import * as THREE from "three";
import { World, FOG_COLOR } from "./World";
import { Hornbill } from "./Hornbill";
import { Stars } from "./Stars";
import { Flight, GROUND_Y } from "./Flight";
import { NO_INPUT, damp, type FlightInput, type GamePhase } from "./types";

export const ROUND_SECONDS = 60;

export interface InputSource {
  /** Sampled once per frame while flying. */
  sample(dt: number): FlightInput;
  /** True on the frame the player asks to launch (a held T-pose, a keypress). */
  startRequested(): boolean;
}

/** Where the aiming reticle should be drawn, in screen pixels. */
export type Reticle = {
  x: number;
  y: number;
  visible: boolean;
  /** True when holding this course actually runs the bird through a star. */
  locked: boolean;
};

export type GameEvents = {
  onPhase?: (phase: GamePhase) => void;
  onScore?: (score: number) => void;
  onTime?: (secondsLeft: number) => void;
  /** A star was picked up. `streak` counts stars collected in quick succession. */
  onCollect?: (streak: number) => void;
  /** A wingbeat actually took effect, 0..1 strength. */
  onFlap?: (strength: number) => void;
  /** Bonus time awarded, in seconds. */
  onBonus?: (seconds: number) => void;
  /** The bird flew into something. */
  onCrash?: () => void;
  /** The hornbill calls now and then while flying. */
  onCall?: () => void;
  onReticle?: (reticle: Reticle) => void;
};

/** Collect another star within this many seconds and the streak keeps building. */
const STREAK_WINDOW = 2.5;

/** Collect this many stars and the clock is extended. */
export const STARS_PER_BONUS = 3;
export const BONUS_SECONDS = 10;

const FOV_NORMAL = 62;
const FOV_DIVE = 78;

/** Collision sphere for the bird. The body, not the full wingspan: clipping a
 *  tree with a wingtip would end runs that visually looked fine. */
const BIRD_RADIUS = 3.4;

/** How far ahead the aiming reticle projects, and at what resolution. */
const AIM_SECONDS = 1.6;
const AIM_SAMPLES = 16;

const CALL_MIN_GAP = 7;
const CALL_MAX_GAP = 17;

/** Slightly wider than the pickup radius, so the lock leads the catch. */
const STAR_LOCK_RADIUS = 10;

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

  private streak = 0;
  private sinceCollect = 99;
  /** Stars collected since the last time bonus was awarded. */
  private towardBonus = 0;
  private untilCall = 4;
  /** Set when the run ended by flying into something rather than running out. */
  crashed = false;

  private aimPath: THREE.Vector3[] = [];
  private aimPoint = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, events: GameEvents = {}) {
    this.events = events;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(FOG_COLOR);

    this.camera = new THREE.PerspectiveCamera(FOV_NORMAL, window.innerWidth / window.innerHeight, 0.5, 6000);

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

  /**
   * Read-only handles for dev tooling and the browser tests, which drive the
   * real game with a scripted autopilot rather than mashing keys and hoping.
   */
  get debug() {
    return { flight: this.flight, stars: this.stars, world: this.world };
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
    this.streak = 0;
    this.sinceCollect = 99;
    this.towardBonus = 0;
    this.untilCall = 4;
    this.crashed = false;
    this.flight.reset();
    this.stars.reset(this.flight.position, this.flight.heading);
    this.placeCameraBehindBird(true);
    this.events.onScore?.(0);
    this.events.onTime?.(ROUND_SECONDS);
    this.setPhase("playing");
  }

  private endRun(crashed = false) {
    this.crashed = crashed;
    if (crashed) this.events.onCrash?.();
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
    // Drop the camera and pull it back in a dive so the bird stays framed
    // while it plunges, instead of shooting out of the bottom of the screen.
    desired.y -= this.flight.dive * 14;
    desired.addScaledVector(forward, -this.flight.dive * 10);

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
      this.flight.update(dt, { flap: this.idleFlap(dt), steer: 0.32, dive: 0 });
      // The latch is always drained, but only honoured on the intro screen.
      // After a run the player has just been posing and flapping, so a stray
      // T-pose must not relaunch them — the Fly again button is the only way.
      const requested = this.input?.startRequested() ?? false;
      if (requested && this.phase === "waiting") this.startRun();
    } else if (this.phase === "playing") {
      const input: FlightInput = this.input ? this.input.sample(dt) : NO_INPUT;
      const flapped = this.flight.update(dt, input);
      if (flapped > 0) {
        this.bird.onFlap(flapped);
        // Fired from here, not from the input layer, so a flap swallowed
        // mid-dive stays silent as well as inert.
        this.events.onFlap?.(flapped);
      }

      this.sinceCollect += dt;
      const got = this.stars.update(dt, this.flight.position, this.flight.heading);
      if (got > 0) {
        this.score += got;
        this.streak = this.sinceCollect < STREAK_WINDOW ? this.streak + got : got - 1;
        this.sinceCollect = 0;
        this.events.onScore?.(this.score);
        this.events.onCollect?.(this.streak);

        // Every few stars buys more time, which is what turns a fixed minute
        // into a run that good flying can keep alive.
        this.towardBonus += got;
        while (this.towardBonus >= STARS_PER_BONUS) {
          this.towardBonus -= STARS_PER_BONUS;
          this.timeLeft += BONUS_SECONDS;
          this.events.onBonus?.(BONUS_SECONDS);
        }
      }

      // Flying into the canopy ends the run and stops the clock.
      if (
        this.flight.position.y <= GROUND_Y + 1 ||
        this.world.hitsTree(this.flight.position, BIRD_RADIUS)
      ) {
        this.endRun(true);
      }

      this.untilCall -= dt;
      if (this.untilCall <= 0) {
        this.untilCall = CALL_MIN_GAP + Math.random() * (CALL_MAX_GAP - CALL_MIN_GAP);
        this.events.onCall?.();
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
    this.bird.update(dt, this.flight.bank, this.flight.pitch, this.flight.gliding, this.flight.dive);

    // Widening the lens during a dive is the cheapest possible speed cue, and
    // it costs nothing but a projection matrix update.
    const wantedFov = FOV_NORMAL + (FOV_DIVE - FOV_NORMAL) * this.flight.dive;
    if (Math.abs(this.camera.fov - wantedFov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, wantedFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }

    this.world.update(this.flight.position);
    if (this.phase !== "playing") this.stars.update(dt, this.flight.position, this.flight.heading);

    this.placeCameraBehindBird(false, dt);
    this.renderer.render(this.scene, this.camera);

    // The reticle is projected after the camera has settled for this frame,
    // or it would trail the view by one frame and never quite line up.
    if (this.phase === "playing") this.updateReticle();
  };

  /**
   * Project the bird's real predicted flight path to screen space.
   *
   * The path comes from the flight model itself, and the projection uses the
   * same camera that just rendered the frame, so the cross marks exactly where
   * the bird is going — no separate approximation to drift out of sync.
   */
  private updateReticle() {
    if (!this.events.onReticle) return;

    const path = this.flight.predictPath(AIM_SECONDS, AIM_SAMPLES, this.aimPath);
    const target = path[path.length - 1];

    // Locked when the predicted path would actually pass through a star.
    let locked = false;
    const stars = this.stars.positions;
    outer: for (const point of path) {
      for (const star of stars) {
        if (point.distanceToSquared(star) < STAR_LOCK_RADIUS * STAR_LOCK_RADIUS) {
          locked = true;
          break outer;
        }
      }
    }

    this.aimPoint.copy(target).project(this.camera);
    // z beyond 1 means the point sits behind the camera, where the projection
    // flips and would put the cross on the wrong side of the screen.
    const visible = this.aimPoint.z < 1;

    this.events.onReticle({
      x: (this.aimPoint.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.aimPoint.y * 0.5 + 0.5) * window.innerHeight,
      visible,
      locked,
    });
  }

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
