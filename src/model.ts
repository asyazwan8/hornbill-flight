/**
 * Dev-only model inspector: `npm run dev` then open /model.html.
 *
 * Renders the hornbill from four angles at close range so the silhouette can
 * be checked without flying around looking for it. Not part of the game.
 */
import * as THREE from "three";
import { Hornbill } from "./game/Hornbill";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#9fd0e8");
scene.add(new THREE.DirectionalLight("#fff6e0", 2.1).translateY(1));
const sun = new THREE.DirectionalLight("#fff6e0", 2.1);
sun.position.set(120, 220, 80);
scene.add(sun, new THREE.HemisphereLight("#cfe8ff", "#3d6b3a", 1.5));

const bird = new Hornbill();
scene.add(bird.group);

// Chase view matches the real game camera: 46 back, 28 up, looking down.
const VIEWS: [string, THREE.Vector3, THREE.Vector3][] = [
  ["chase", new THREE.Vector3(0, 28, -46), new THREE.Vector3(0, -3, 8)],
  ["side", new THREE.Vector3(40, 6, 0), new THREE.Vector3(0, 0, 0)],
  ["top", new THREE.Vector3(0, 42, 1), new THREE.Vector3(0, 0, 0)],
  ["front", new THREE.Vector3(0, 8, 42), new THREE.Vector3(0, 0, 2)],
];

const cameras = VIEWS.map(([, pos, look]) => {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  cam.position.copy(pos);
  cam.lookAt(look);
  return cam;
});

let t = 0;
function frame() {
  requestAnimationFrame(frame);
  t += 0.016;
  // Flap on a loop so the wing animation is visible too.
  if (Math.floor(t * 1.5) !== Math.floor((t - 0.016) * 1.5)) bird.onFlap(0.9);
  bird.update(0.016, Math.sin(t * 0.6) * 0.4, 0, false);

  const w = window.innerWidth / 2;
  const h = window.innerHeight / 2;
  cameras.forEach((cam, i) => {
    const x = (i % 2) * w;
    const y = i < 2 ? h : 0;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  });
}
frame();

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});
