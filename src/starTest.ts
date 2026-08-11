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
import { Flight } from "./game/Flight";
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
  const bird = new THREE.Vector3(0, 90, 0);
  stars.reset(bird, heading);

  const target = stars.positions[0].clone();
  const collected = stars.update(1 / 60, target, heading);
  check("flying into a star collects it", collected === 1, `collected=${collected}`);
}

{
  const stars = newStars();
  const bird = new THREE.Vector3(0, 90, 0);
  stars.reset(bird, heading);
  // Sit 20 units off a star: outside the 8 unit pickup radius.
  const near = stars.positions[0].clone().add(new THREE.Vector3(20, 0, 0));
  const collected = stars.update(1 / 60, near, heading);
  check("passing well wide of a star collects nothing", collected === 0, `collected=${collected}`);
}

{
  const stars = newStars();
  const bird = new THREE.Vector3(0, 90, 0);
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
  const high = new THREE.Vector3(0, 200, 0);
  stars.reset(high, heading);
  const gaps = stars.positions.map((p) => Math.abs(p.y - high.y));
  const worst = Math.max(...gaps);
  check("stars spawn near the bird even at the ceiling", worst < 120, `furthest star ${worst.toFixed(0)} units away vertically`);
}

/* ---------------- recycling ---------------- */
{
  const stars = newStars();
  const bird = new THREE.Vector3(0, 90, 0);
  stars.reset(bird, heading);
  // Fly a long way past every star; none should be left stranded behind.
  const far = new THREE.Vector3(0, 90, 1200);
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
    const wantsHeight = nearest.y > flight.position.y - 4;
    const flap = wantsHeight && sinceFlap > 0.25 && flight.vy < 8 ? 0.9 : 0;
    if (flap > 0) sinceFlap = 0;

    flight.update(DT, { flap, steer });
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

const summary = document.createElement("h2");
summary.textContent = failures === 0 ? "Star tests passed" : `${failures} star test(s) failed`;
summary.className = failures === 0 ? "pass" : "fail";
out.appendChild(summary);
console.log(`STAR_TESTS_DONE failures=${failures}`);
