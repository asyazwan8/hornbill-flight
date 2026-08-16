# Hornbill Flight

Fly a low-poly hornbill over the rainforest using your body. Stand in front of
your webcam, strike a **T-pose** to launch, **flap your arms** to gain height and
**lean left or right** to steer.

You start with **60 seconds**. The bird sinks constantly, so you have to keep
flapping or you drop into the canopy and crash. Every **3 stars buys 10 more
seconds**, which is what keeps a good run going.

No controller, no keyboard needed — the camera reads your pose, and no video
ever leaves your machine. If a leaderboard is configured, the only thing that
goes anywhere is a finished run: a name, a star count and how long you lasted.

## Getting started

```bash
npm install   # also stages the MediaPipe runtime and pose model into public/
npm run dev
```

Open the printed URL in Chrome or Edge and allow camera access when asked.

> Webcam access requires a secure context. `localhost` counts as secure, so
> local development works; anywhere else needs HTTPS.

`npm install` runs `scripts/fetch-assets.mjs`, which copies the MediaPipe wasm
runtime out of `node_modules` and downloads the ~6MB pose model into `public/`.
Those files are gitignored — the repository stays small, and the built site
still serves its own copies rather than depending on a CDN at runtime. Run
`npm run assets` to redo it by hand.

## How to play

Press **Start**, allow the camera, then launch with a T-pose or the **Fly now**
button.

| Gesture                            | What it does                                  |
| ---------------------------------- | --------------------------------------------- |
| **Flap** — swing both arms down    | A beat of lift. Stop and you sink into the trees |
| **Lean** — tilt your shoulders     | Banks and turns the bird                       |
| **Hands together** — in front of you | Tucks the wings into a divebomb: fast descent, extra speed |
| **T-pose** — arms straight out, 1s | Launches a run from the ready screen           |

Stand back far enough that your head, both hands and your hips are all in frame.
The preview in the bottom-left corner shows the skeleton the game is reading, so
you can tell at a glance whether it can see you.

A crosshair shows where you are actually going. It turns gold when holding your
current course would run you through a star.

Fly too low and you hit a tree, which ends the run on the spot. Stars sit just
above the treetops, so the tempting ones are the risky ones.

When the run ends you must press **Fly again** to go round again. That is
deliberate: you have just finished flapping, and a stray pose should not throw
you straight back into a run.

Keyboard controls work at the same time, which is handy for development:
**Space** to flap, **arrow keys** to steer, **down arrow** (or Shift) to
divebomb, **Enter** to press whatever button is on screen.

Sound is synthesised in the browser, apart from the hornbill call, which is a
9KB recording of the real bird. The speaker button in the top-right mutes
everything.

## Leaderboard

Runs can be posted to a shared board backed by [Supabase](https://supabase.com).
It shows on the ready screen — the scores to beat — and again after every run,
where you can put your name to what you just flew. Entries rank by stars first
and, when two runs tie, by whoever stayed in the air longest.

It is entirely optional. With no project configured the board hides itself and
the game keeps the single best score in the browser exactly as it always has,
which is also what happens if the network is down mid-session.

### Setting it up

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste in `supabase/schema.sql` and run it.
   That creates the table, its ranking index, and the row level security
   policies. Running it twice is harmless.
3. Copy `.env.example` to `.env`, and fill in the two values from
   **Project Settings → API**:

   ```bash
   cp .env.example .env
   ```

   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. Restart `npm run dev`. Vite only reads env files at startup.

For a deployed site, set those same two variables in your host's environment
rather than committing a `.env` — `.env` is gitignored for that reason.

### What stops people posting nonsense

Not as much as you might like, and it is worth being honest about why. The game
is a static site: the anon key is inside the bundle, where anyone can read it,
so "the client is trusted" is the starting position no amount of frontend code
changes. What the database can still insist on, it does:

- **No edits, ever.** The policies grant `SELECT` and `INSERT` and nothing else.
  With no `UPDATE` or `DELETE` policy, row level security refuses both, so a
  posted score cannot be altered or another player's removed.
- **Runs must be physically possible.** A run starts with 60 seconds and every
  3 stars buys 10 more, so the clock a player can have burned is bounded by
  their star count. A `CHECK` constraint enforces exactly that relationship,
  which is what makes "999 stars in four seconds" impossible to post.
- **Names and scores are bounded** — 16 characters, 0–999 stars — by the same
  kind of constraint, so the board cannot be flooded with a megabyte of text.

A determined person with `curl` can still post a plausible-looking score, and
that is the honest ceiling for a game with no server of its own. If it ever
matters, `src/leaderboard/Leaderboard.ts` keeps the write behind a single
`submit()` function; pointing it at a Supabase Edge Function holding the
service role key is a one-file change, and nothing else in the game would
notice.

## How it works

- **Pose tracking** — MediaPipe's `PoseLandmarker` (lite) returns 33 body
  landmarks per frame. Both the WASM runtime and the model file are served from
  `public/`, so there is no CDN dependency and the game keeps working offline
  after first load. To load them from the official CDN instead, see
  `.env.production.example`.
- **Gestures** — `src/pose/GestureMapper.ts` turns landmarks into flight
  controls. Everything is measured in *shoulder-widths* rather than pixels, so
  the thresholds hold whether you stand close to the camera or across the room.
  Flaps come from a peak-and-trough detector on wrist height, which fires once
  per downstroke instead of continuously while your arms are moving.
- **Rendering** — Three.js. The hornbill, trees and stars are all built from
  primitives in code; there are no model files. The forest is two instanced
  meshes whose instances wrap around the bird, so the world is endless at a
  constant instance count.
- **Audio** — `src/audio/Audio.ts` synthesises almost everything with Web
  Audio: the star chime (whose pitch climbs as you chain pickups), a wing
  whoosh on every flap, the dive rush, the crash, and a looping four-bar
  backing track built from a pad and a sparse arpeggio. The exception is the
  hornbill call. A synthesised bark never convinced — the real bird honks
  around 900Hz with a hard attack and a long forest tail, which oscillators
  approximate badly — so `public/audio/hornbill-call.mp3` is a 9KB clip of an
  actual rhinoceros hornbill, played 1–3 times with a little detune so a
  repeated call does not sound like a loop. It loads in the background and the
  synth stays as the fallback, so a failed fetch costs realism, not sound.
  Browsers will not start an AudioContext without a user gesture, which is
  what the Start button is really for.
- **The crosshair** — rather than approximating where the bird is heading, the
  reticle runs the *real* `Flight.update()` on a throwaway copy of the bird for
  1.6 seconds and projects the end of that path through the same camera that
  just rendered the frame. There is only one set of physics, so the cross
  cannot drift out of agreement with the flight model — and a test asserts the
  prediction lands within half a unit of where the bird actually ends up.
- **The star magnet** — a star inside 18 units drifts toward the bird, gently
  at the edge of that field and harder as the gap closes, so a near miss
  becomes a catch. Steering comes from your shoulders and is coarse by nature;
  without this, missing by a metre reads as the game's fault. The pull is
  exponential rather than a fixed step per frame, so a 120fps machine does not
  collect stars a 30fps one would drop — there is a test for exactly that. It
  is deliberately weak enough that a wide miss still gets away.
- **Tree collision** — crowns are tested as cones, not cylinders, using
  dimensions derived from the very same instance transform that draws them. A
  treetop that is visibly to your left will not clip you.
- **Frame rates** — pose detection runs on the webcam's clock (usually 30fps)
  while rendering runs on its own. Flaps and T-poses are latched between the two
  so a gesture is never missed or counted twice.
- **The leaderboard** — Supabase serves every table over PostgREST, so reading
  the top ten and posting a run are one `fetch` each and the client library is
  not worth its own bundle size. Every call is optional and time-limited: the
  board hides itself rather than blocking a game that is meant to be played
  offline. Other players' names are written to the DOM as text, never as
  markup, so a name cannot smuggle a script onto anyone else's screen.

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
| `DIVE_GAP_FULL/NONE` | How close your hands must be to trigger a full divebomb |

Flight feel — gravity, lift per flap, turn rate — lives in `src/game/Flight.ts`.
How forgiving star pickups are lives in `src/game/Stars.ts`: `COLLECT_RADIUS`
for the pickup itself, and `MAGNET_RADIUS` / `MAGNET_RATE` for the pull that
draws a near miss in.

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
  audio/Audio.ts     music, sound effects and the call playback
  input/Keyboard.ts  keyboard fallback
  leaderboard/
    Leaderboard.ts   Supabase over plain fetch, plus the local best score
  ui/Hud.ts          score, timer, panels and buttons
scripts/
  fetch-assets.mjs   stages the wasm runtime and pose model into public/
supabase/
  schema.sql         leaderboard table, policies and constraints
public/
  audio/             the hornbill call recording (in git, 9KB)
  mediapipe/wasm/    MediaPipe runtime      (staged on install, gitignored)
  models/            pose_landmarker_lite.task    (likewise)
```

## Browser support

Chrome and Edge are the safest bet. Any browser needs WebGL2, `getUserMedia`
and WebAssembly. MediaPipe runs on the GPU where it can and falls back to CPU
otherwise.
