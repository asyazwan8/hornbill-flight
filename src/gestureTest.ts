/**
 * Synthetic tests for the gesture layer: `npm run dev` then open /test.html.
 *
 * The webcam path cannot be exercised in CI or on a machine with no camera,
 * but the maths that turns landmarks into flight controls can. These feed
 * hand-built landmark sequences through GestureMapper and check the controls
 * that come out — in particular the signs, which are easy to get backwards.
 */
import { GestureMapper } from "./pose/GestureMapper";
import { LM, type Landmarks } from "./pose/PoseTracker";

const FPS = 30;
const DT = 1 / FPS;

type Body = {
  /** Vertical offset applied to the left shoulder, minus it on the right. */
  tilt?: number;
  /** Wrist height; shoulder height is 0.4. Smaller is higher in frame. */
  wristY?: number;
  /** How far the wrists reach out from the shoulders. */
  wristReach?: number;
  noseX?: number;
};

/**
 * Build a full landmark array for a person standing square to the camera.
 * Image coordinates: x grows to the right, y grows downward, both 0..1.
 * Landmark 11 is the person's LEFT shoulder, which in an unmirrored camera
 * image sits on the right-hand side of the frame.
 */
function body({ tilt = 0, wristY = 0.4, wristReach = 0.18, noseX = 0.5 }: Body = {}): Landmarks {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));

  lm[LM.nose] = { x: noseX, y: 0.28, z: 0, visibility: 1 };
  lm[LM.leftShoulder] = { x: 0.6, y: 0.4 + tilt, z: 0, visibility: 1 };
  lm[LM.rightShoulder] = { x: 0.4, y: 0.4 - tilt, z: 0, visibility: 1 };
  lm[LM.leftElbow] = { x: 0.6 + wristReach / 2, y: 0.45, z: 0, visibility: 1 };
  lm[LM.rightElbow] = { x: 0.4 - wristReach / 2, y: 0.45, z: 0, visibility: 1 };
  lm[LM.leftWrist] = { x: 0.6 + wristReach, y: wristY + tilt, z: 0, visibility: 1 };
  lm[LM.rightWrist] = { x: 0.4 - wristReach, y: wristY - tilt, z: 0, visibility: 1 };
  lm[LM.leftHip] = { x: 0.57, y: 0.7, z: 0, visibility: 1 };
  lm[LM.rightHip] = { x: 0.43, y: 0.7, z: 0, visibility: 1 };

  return lm;
}

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

/* ---------------- T-pose ---------------- */
{
  const m = new GestureMapper();
  let completions = 0;
  let framesToComplete = 0;
  for (let i = 0; i < Math.round(FPS * 2); i++) {
    const s = m.update(body({ wristY: 0.4, wristReach: 0.2 }), DT);
    if (s.tposeComplete) {
      completions++;
      if (!framesToComplete) framesToComplete = i + 1;
    }
  }
  check(
    "T-pose completes once after ~1s hold",
    completions === 1 && Math.abs(framesToComplete / FPS - 1.0) < 0.15,
    `completions=${completions}, held ${(framesToComplete / FPS).toFixed(2)}s`
  );
}

{
  // Arms hanging down must never read as a T-pose.
  const m = new GestureMapper();
  let completions = 0;
  for (let i = 0; i < FPS * 3; i++) {
    if (m.update(body({ wristY: 0.68, wristReach: 0.05 }), DT).tposeComplete) completions++;
  }
  check("arms down is not a T-pose", completions === 0, `completions=${completions}`);
}

/* ---------------- flapping ---------------- */
{
  const m = new GestureMapper();
  let flaps = 0;
  let peak = 0;
  const seconds = 3;
  const hz = 1.5;
  for (let i = 0; i < FPS * seconds; i++) {
    const t = i * DT;
    // Arms sweeping up and down through shoulder height.
    const wristY = 0.4 + Math.sin(t * Math.PI * 2 * hz) * 0.12;
    const s = m.update(body({ wristY, wristReach: 0.2 }), DT);
    if (s.input.flap > 0) {
      flaps++;
      peak = Math.max(peak, s.input.flap);
    }
  }
  const expected = seconds * hz;
  check(
    "flapping fires once per stroke",
    Math.abs(flaps - expected) <= 1,
    `flaps=${flaps}, expected~${expected}, strength up to ${peak.toFixed(2)}`
  );
}

{
  // Standing still, however long, must not produce lift.
  const m = new GestureMapper();
  let flaps = 0;
  for (let i = 0; i < FPS * 3; i++) {
    if (m.update(body({ wristY: 0.55 }), DT).input.flap > 0) flaps++;
  }
  check("standing still does not flap", flaps === 0, `flaps=${flaps}`);
}

/* ---------------- steering ---------------- */
{
  const settle = (tilt: number, noseX: number) => {
    const m = new GestureMapper();
    let steer = 0;
    for (let i = 0; i < FPS * 2; i++) steer = m.update(body({ tilt, noseX }), DT).input.steer;
    return steer;
  };

  // Dropping the LEFT shoulder (y grows downward) means leaning left, and the
  // bird should turn left. Steer is positive to the right.
  const leanLeft = settle(0.04, 0.56);
  const leanRight = settle(-0.04, 0.44);
  const upright = settle(0, 0.5);

  check("leaning left steers left", leanLeft < -0.2, `steer=${leanLeft.toFixed(3)}`);
  check("leaning right steers right", leanRight > 0.2, `steer=${leanRight.toFixed(3)}`);
  check("standing upright does not steer", Math.abs(upright) < 0.02, `steer=${upright.toFixed(3)}`);
}

/* ---------------- robustness ---------------- */
{
  const m = new GestureMapper();
  const s = m.update(null, DT);
  check(
    "no pose yields neutral controls",
    s.input.flap === 0 && s.input.steer === 0 && !s.tposeComplete,
    `flap=${s.input.flap}, steer=${s.input.steer}`
  );
}

{
  // Scale invariance: someone standing far from the camera is small in frame,
  // but the same gesture must still register.
  const m = new GestureMapper();
  const shrink = (lm: Landmarks): Landmarks =>
    lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.4, y: 0.5 + (p.y - 0.5) * 0.4 }));
  let flaps = 0;
  for (let i = 0; i < FPS * 3; i++) {
    const wristY = 0.4 + Math.sin(i * DT * Math.PI * 2 * 1.5) * 0.12;
    if (m.update(shrink(body({ wristY, wristReach: 0.2 })), DT).input.flap > 0) flaps++;
  }
  check("flap detection survives a distant, small figure", Math.abs(flaps - 4.5) <= 1.5, `flaps=${flaps}`);
}

const summary = document.createElement("h2");
summary.textContent = failures === 0 ? "All tests passed" : `${failures} test(s) failed`;
summary.className = failures === 0 ? "pass" : "fail";
out.appendChild(summary);
console.log(`GESTURE_TESTS_DONE failures=${failures}`);
