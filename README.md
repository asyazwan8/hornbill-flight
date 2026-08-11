# Hornbill Flight

Fly a low-poly hornbill over the rainforest using your body. Stand in front of
your webcam, strike a **T-pose** to launch, **flap your arms** to gain height and
**lean left or right** to steer. You have **60 seconds** to collect as many stars
as you can.

No controller, no keyboard needed — the camera reads your pose and nothing ever
leaves your machine.

## Getting started

```bash
npm install
npm run dev
```

Open the printed URL in Chrome or Edge and allow camera access when asked.

> Webcam access requires a secure context. `localhost` counts as secure, so
> local development works; anywhere else needs HTTPS.

## How to play

| Gesture                              | What it does                              |
| ------------------------------------ | ----------------------------------------- |
| **T-pose** — arms straight out, 1s   | Starts a run (and restarts after time up) |
| **Flap** — swing both arms down      | A beat of lift. Stop flapping and you sink |
| **Lean** — tilt your shoulders       | Banks and turns the bird                  |

Stand back far enough that your head, both hands and your hips are all in frame.
The preview in the bottom-left corner shows the skeleton the game is reading, so
you can tell at a glance whether it can see you.

Keyboard controls work at the same time, which is handy for development:
**Space** to flap, **arrow keys** to steer, **Enter** to start.

## How it works

- **Pose tracking** — MediaPipe's `PoseLandmarker` (lite) returns 33 body
  landmarks per frame. Both the WASM runtime and the model file are served from
  `public/`, so there is no CDN dependency and the game keeps working offline
  after first load.
- **Gestures** — `src/pose/GestureMapper.ts` turns landmarks into flight
  controls. Everything is measured in *shoulder-widths* rather than pixels, so
  the thresholds hold whether you stand close to the camera or across the room.
  Flaps come from a peak-and-trough detector on wrist height, which fires once
  per downstroke instead of continuously while your arms are moving.
- **Rendering** — Three.js. The hornbill, trees and stars are all built from
  primitives in code; there are no model files. The forest is two instanced
  meshes whose instances wrap around the bird, so the world is endless at a
  constant instance count.
- **Frame rates** — pose detection runs on the webcam's clock (usually 30fps)
  while rendering runs on its own. Flaps and T-poses are latched between the two
  so a gesture is never missed or counted twice.

## Tuning the controls

Every threshold worth touching is a named constant at the top of
`src/pose/GestureMapper.ts`:

| Constant           | Effect                                                   |
| ------------------ | -------------------------------------------------------- |
| `FLAP_MIN_TRAVEL`  | How far your arms must travel before a flap counts        |
| `FLAP_SPEED_*`     | Maps how hard you flap onto how much lift you get         |
| `STEER_GAIN`       | How sharply a given lean turns the bird                   |
| `STEER_DEADZONE`   | How far you can lean before steering starts               |
| `STEER_SIGN`       | **Flip this if steering feels inverted**                  |
| `TPOSE_HOLD`       | How long the T-pose must be held                          |

Flight feel — gravity, lift per flap, turn rate — lives in `src/game/Flight.ts`.

## Development pages

Two extra pages exist for working on the game without a camera:

- **`/model.html`** — the hornbill from four angles with its wings flapping, for
  checking the silhouette.
- **`/test.html`** — synthetic tests for the gesture layer. Hand-built landmark
  sequences are fed through `GestureMapper` and the resulting controls are
  checked, which catches inverted signs and broken thresholds without needing a
  body in front of a camera.

## Project layout

```
src/
  game/
    Game.ts      loop, phases, score, timer, chase camera
    Flight.ts    the flight model (gravity, lift, turning)
    Hornbill.ts  the bird, built from primitives
    World.ts     sky, ground, endless instanced forest
    Stars.ts     collectables and the collect effect
  pose/
    PoseTracker.ts   webcam + MediaPipe
    GestureMapper.ts landmarks -> flight controls
    PoseInput.ts     the two combined, as a game input source
    PoseOverlay.ts   the skeleton preview
  input/Keyboard.ts  keyboard fallback
  ui/Hud.ts          score, timer and panels
public/
  mediapipe/wasm/  MediaPipe runtime
  models/          pose_landmarker_lite.task
```

## Browser support

Chrome and Edge are the safest bet. Any browser needs WebGL2, `getUserMedia`
and WebAssembly. MediaPipe runs on the GPU where it can and falls back to CPU
otherwise.
