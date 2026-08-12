/**
 * Headless tests for collection, star recycling and whether the game is
 * actually winnable. Loaded by /test.html alongside the gesture tests.
 *
 * The last test is the important one: it flies a full 60 second round with a
 * simple autopilot that steers at the nearest star. Playing the game by
 * accident scores zero, so only a test that actually aims can tell us whether
 * the flight model can reach the stars it spawns.
 */
import * as THREE from "three";
import { Stars } from "./game/Stars";
import { Flight, GROUND_Y, START_ALTITUDE } from "./game/Flight";
import { World } from "./game/World";
import { ROUND_SECONDS } from "./game/Game";
import { clamp } from "./game/types";

const out = document.getElementById("out")!;
let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  const line = document.createElement("div");
  line.className = ok ? "pass" : "fail";
  line.textContent = `${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`;
  out.appendChild(line);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`);
}

const heading = 0;
const newStars = () => new Stars(new THREE.Scene());

/* ---------------- collection ---------------- */
{
  const stars = newStars();
  const bird = new THREE.Vector3(0, START_ALTITUDE, 0);
  stars.reset(bird, heading);

  const target = stars.positions[0].clone();
  const collected = stars.update(1 / 60, target, heading);
  check("flying into a star collects it", collected === 1, `collected=${collected}`);
}

{
  const stars = newStars();
  const bird = new THREE.Vector3(0, START_ALTITUDE, 0);
  stars.reset(bird, heading);
  // Sit 20 units off a star: outside the 8 unit pickup radius.
  const near = stars.positions[0].clone().add(new THREE.Vector3(20, 0, 0));
  const collected = stars.update(1 / 60, near, heading);
  check("passing well wide of a star collects nothing", collected === 0, `collected=${collected}`);
}

{
  const stars = newStars();
  const bird = new THREE.Vector3(0, START_ALTITUDE, 0);
  stars.reset(bird, heading);
  const before = stars.positions[0].clone();
  stars.update(1 / 60, before.clone(), heading);
  const after = stars.positions[0];
  const movedAhead = after.z > before.z || after.distanceTo(before) > 50;
  check("a collected star respawns ahead", movedAhead, `moved ${after.distanceTo(before).toFixed(0)} units`);
}

/* ---------------- spawn band ---------------- */
{
  const stars = newStars();
  // A player pinned at the ceiling must still have reachable stars: this is
  // the bug where every star spawned in a fixed band far below.
  const high = new THREE.Vector3(0, 125, 0);
  stars.reset(high, heading);
  const gaps = stars.positions.map((p) => Math.abs(p.y - high.y));
  const worst = Math.max(...gaps);
  check("stars spawn near the bird even at the ceiling", worst < 120, `furthest star ${worst.toFixed(0)} units away vertically`);
}

/* ---------------- recycling ---------------- */
{
  const stars = newStars();
  const bird = new THREE.Vector3(0, START_ALTITUDE, 0);
  stars.reset(bird, heading);
  // Fly a long way past every star; none should be left stranded behind.
  const far = new THREE.Vector3(0, START_ALTITUDE, 1200);
  stars.update(1 / 60, far, heading);
  const behind = stars.positions.filter((p) => p.z < far.z - 95).length;
  check("stars left behind are recycled", behind === 0, `${behind} stranded`);
}

/* ---------------- is the game winnable? ---------------- */
{
  const stars = newStars();
  const flight = new Flight();
  flight.reset();
  stars.reset(flight.position, flight.heading);

  const DT = 1 / 60;
  let score = 0;
  let sinceFlap = 0;
  let closest = Infinity;

  // Commit to one target rather than re-picking every frame, the way a player
  // would. Chasing whichever star is nearest this instant just thrashes.
  let targetIndex = 0;
  let targetAge = 0;

  for (let i = 0; i < ROUND_SECONDS / DT; i++) {
    targetAge += DT;
    const positions = stars.positions;
    const toTarget = positions[targetIndex].distanceTo(flight.position);

    // Repick when the current target is gone, unreachable, or stale.
    if (targetAge > 6 || toTarget > 420) {
      let best = Infinity;
      positions.forEach((p, idx) => {
        const forward = new THREE.Vector3(Math.sin(flight.heading), 0, Math.cos(flight.heading));
        const delta = p.clone().sub(flight.position);
        // Prefer stars ahead of us, not behind.
        if (delta.dot(forward) < 20) return;
        const cost = delta.length() + Math.abs(delta.y) * 1.5;
        if (cost < best) {
          best = cost;
          targetIndex = idx;
        }
      });
      targetAge = 0;
    }

    const nearest = positions[targetIndex];
    closest = Math.min(closest, toTarget);

    const dx = nearest.x - flight.position.x;
    const dz = nearest.z - flight.position.z;
    const desired = Math.atan2(dx, dz);
    let diff = desired - flight.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Heading increases to the left, so a positive diff needs a left steer.
    const steer = clamp(-diff * 2, -1, 1);

    sinceFlap += DT;
    // There is no safety floor any more, so the autopilot has to keep itself
    // up the way a player does: flap for the target, and flap to survive.
    const wantsHeight = nearest.y > flight.position.y - 4 || flight.position.y < 45;
    const flap = wantsHeight && sinceFlap > 0.25 && flight.vy < 8 ? 0.9 : 0;
    if (flap > 0) sinceFlap = 0;

    flight.update(DT, { flap, steer, dive: 0 });
    const got = stars.update(DT, flight.position, flight.heading);
    if (got > 0) {
      score += got;
      targetAge = 99; // target consumed, pick a new one next frame
    }
  }

  check(
    "an aiming player can score in 60 seconds",
    score >= 8,
    `autopilot collected ${score} stars, closest approach ${closest.toFixed(1)} units`
  );
}

/* ---------------- divebomb physics ---------------- */
{
  const run = (dive: number, seconds: number) => {
    const flight = new Flight();
    flight.reset();
    const startZ = flight.position.z;
    const DT = 1 / 60;
    for (let i = 0; i < seconds / DT; i++) flight.update(DT, { flap: 0, steer: 0, dive });
    return { drop: START_ALTITUDE - flight.position.y, travelled: flight.position.z - startZ };
  };

  const glide = run(0, 1.5);
  const dive = run(1, 1.5);

  check(
    "diving drops far faster than gliding",
    dive.drop > glide.drop * 1.8,
    `dive ${dive.drop.toFixed(0)} units vs glide ${glide.drop.toFixed(0)}`
  );
  check(
    "diving is faster forwards too",
    dive.travelled > glide.travelled * 1.2,
    `dive ${dive.travelled.toFixed(0)} units vs glide ${glide.travelled.toFixed(0)}`
  );
}

{
  // The bird may now reach the ground — that is the whole hazard — but it must
  // never fall through the world.
  const flight = new Flight();
  flight.reset();
  const DT = 1 / 60;
  let lowest = Infinity;
  for (let i = 0; i < 20 / DT; i++) {
    flight.update(DT, { flap: 0, steer: 0, dive: 1 });
    lowest = Math.min(lowest, flight.position.y);
  }
  check(
    "the ground is a hard floor",
    lowest >= GROUND_Y - 0.001 && lowest < GROUND_Y + 1,
    `lowest altitude ${lowest.toFixed(2)}, floor ${GROUND_Y}`
  );
}

/* ---------------- sink and lift ---------------- */
{
  // Feature: the bird drifts down on its own and you flap to climb.
  const glide = new Flight();
  glide.reset();
  const DT = 1 / 60;
  for (let i = 0; i < 3 / DT; i++) glide.update(DT, { flap: 0, steer: 0, dive: 0 });
  const sank = START_ALTITUDE - glide.position.y;
  const rate = -glide.vy;

  check(
    "the bird sinks steadily when left alone",
    sank > 15 && sank < 60,
    `sank ${sank.toFixed(0)} units in 3s, settling at ${rate.toFixed(1)} units/s`
  );
  check(
    "the sink settles rather than accelerating",
    rate < 16,
    `terminal sink ${rate.toFixed(1)} units/s`
  );
}

{
  // Flapping at a realistic human cadence must actually hold you up.
  const flight = new Flight();
  flight.reset();
  const DT = 1 / 60;
  let sinceFlap = 0;
  for (let i = 0; i < 10 / DT; i++) {
    sinceFlap += DT;
    let flap = 0;
    if (sinceFlap >= 0.75) {
      flap = 0.85;
      sinceFlap = 0;
    }
    flight.update(DT, { flap, steer: 0, dive: 0 });
  }
  check(
    "flapping about 1.3x a second holds altitude",
    flight.position.y > START_ALTITUDE - 5,
    `after 10s at ${flight.position.y.toFixed(0)} (started ${START_ALTITUDE})`
  );
}

/* ---------------- the aiming reticle ---------------- */
{
  // The crosshair is only worth drawing if it is truthful, so assert that the
  // predicted path is where the bird actually ends up.
  const flight = new Flight();
  flight.reset();
  const DT = 1 / 60;
  // Get it into a non-trivial state first: climbing, turning.
  for (let i = 0; i < 40; i++) flight.update(DT, { flap: i === 0 ? 1 : 0, steer: 0.6, dive: 0 });

  const predicted = flight.predictPath(1.5, 24);
  const end = predicted[predicted.length - 1].clone();

  // Now actually fly the same 1.5 seconds with the same held input.
  const steps = Math.round(1.5 / (1.5 / 24));
  for (let i = 0; i < steps; i++) flight.update(1.5 / 24, { flap: 0, steer: 0.6, dive: 0 });

  const error = end.distanceTo(flight.position);
  check(
    "the reticle path matches where the bird really goes",
    error < 0.5,
    `predicted vs actual differ by ${error.toFixed(3)} units`
  );
}

/* ---------------- tree collision ---------------- */
{
  const world = new World(new THREE.Scene());

  // High above everything is always safe.
  const high = new THREE.Vector3(0, 200, 0);
  check("nothing is hit high above the canopy", !world.hitsTree(high, 3.4), "clear at y=200");

  // Down at trunk height in a 900-tree forest, something must be hit
  // somewhere: sweep the tile and make sure collisions actually register.
  let hits = 0;
  const probe = new THREE.Vector3();
  for (let x = -300; x <= 300; x += 7) {
    for (let z = -300; z <= 300; z += 7) {
      probe.set(x, 12, z);
      if (world.hitsTree(probe, 3.4)) hits++;
    }
  }
  check("trees are solid at canopy height", hits > 50, `${hits} colliding probe points`);

  // The cone must taper: the same spot at the very top of the canopy should
  // collide far less often than down in the thick of it.
  let highHits = 0;
  for (let x = -300; x <= 300; x += 7) {
    for (let z = -300; z <= 300; z += 7) {
      probe.set(x, 29, z);
      if (world.hitsTree(probe, 3.4)) highHits++;
    }
  }
  check(
    "crowns taper toward the tip",
    highHits < hits,
    `${highHits} hits at the treetops vs ${hits} lower down`
  );
}

{
  // Flapping out of a dive should be impossible until the wings come back out,
  // otherwise the dive would be cancellable mid-plunge by a twitch.
  const flight = new Flight();
  flight.reset();
  const DT = 1 / 60;
  for (let i = 0; i < 0.5 / DT; i++) flight.update(DT, { flap: 0, steer: 0, dive: 1 });
  const before = flight.vy;
  const flapped = flight.update(DT, { flap: 1, steer: 0, dive: 1 });
  check(
    "flapping is ignored while tucked",
    flapped === 0 && flight.vy < before,
    `flapStrength=${flapped}, vy ${before.toFixed(1)} -> ${flight.vy.toFixed(1)}`
  );
}

const summary = document.createElement("h2");
summary.textContent = failures === 0 ? "Star tests passed" : `${failures} star test(s) failed`;
summary.className = failures === 0 ? "pass" : "fail";
out.appendChild(summary);
console.log(`STAR_TESTS_DONE failures=${failures}`);
