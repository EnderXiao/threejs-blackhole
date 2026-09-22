import * as THREE from 'three';
import { FreeCamera } from './camera/FreeCamera.js';
import { MatterField } from './scene/MatterField.js';
import { HUD } from './ui/HUD.js';
import { blackholeVert, blackholeFrag } from './shaders/blackhole.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new FreeCamera(canvas, { position: new THREE.Vector3(0, 7.5, 24) });

// Fullscreen geodesic quad (drawn first as background)
const quadScene = new THREE.Scene();
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const uniforms = {
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uTime: { value: 0 },
  uSpin: { value: 0.9 },
  uCamPos: { value: new THREE.Vector3() },
  uCamBasis: { value: new THREE.Matrix3() },
  uFov: { value: (55 * Math.PI) / 180 },
  uSteps: { value: 96 },
  uIncl: { value: (18 * Math.PI) / 180 },
  uShowGrid: { value: false },
  uTimeScale: { value: 1 },
};
// keep sim time advancing even when timeScale is dragged (pattern still updates uTime)
const quad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    vertexShader: blackholeVert,
    fragmentShader: blackholeFrag,
    uniforms,
    depthWrite: false,
    depthTest: false,
  })
);
quadScene.add(quad);

// Matter particles live in a normal perspective scene overlaid after the quad
const matter = new MatterField(9000);
scene.add(matter.points);

const hud = new HUD();
const state = {
  spin: 0.9,
  timeScale: 1,
  paused: false,
  last: performance.now(),
};

hud.onChange.spin = (a) => {
  state.spin = a;
  uniforms.uSpin.value = a;
  matter.setSpin(a);
};
hud.onChange.incl = (rad) => {
  uniforms.uIncl.value = rad;
};
hud.onChange.steps = (n) => {
  uniforms.uSteps.value = n;
};
hud.onChange.timeScale = (t) => {
  state.timeScale = t;
  uniforms.uTimeScale.value = t;
  matter.setTimeScale(t);
};
hud.onChange.grid = (v) => {
  uniforms.uShowGrid.value = v;
};

document.getElementById('btn-start').addEventListener('click', () => {
  hud.hideStart();
  camera.setEnabled(true);
  canvas.requestPointerLock?.();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH') hud.toggle();
  if (e.code === 'KeyR') camera.reset(new THREE.Vector3(0, 7.5, 24));
  if (e.code === 'Space') {
    e.preventDefault();
    state.paused = !state.paused;
    matter.setPaused(state.paused);
    state.timeScale = state.paused ? 0 : parseFloat(document.getElementById('inp-time').value);
    uniforms.uTimeScale.value = state.paused ? 0 : state.timeScale;
  }
});

// Scroll dolly
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const dir = new THREE.Vector3();
    camera.object.getWorldDirection(dir);
    camera.object.position.addScaledVector(dir, -e.deltaY * 0.01);
    const r = camera.object.position.length();
    const minR = 3.2;
    const maxR = 55;
    if (r < minR) camera.object.position.multiplyScalar(minR / r);
    if (r > maxR) camera.object.position.multiplyScalar(maxR / r);
  },
  { passive: false }
);

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.resize(w, h);
  uniforms.uResolution.value.set(w, h);
}
window.addEventListener('resize', onResize);

function frame(now) {
  const dt = Math.min(0.05, (now - state.last) / 1000);
  state.last = now;

  camera.update(dt);
  matter.update(state.paused ? 0 : dt);

  uniforms.uTime.value = now * 0.001;
  uniforms.uCamPos.value.copy(camera.object.position);
  uniforms.uCamBasis.value.copy(camera.getBasisMatrix());
  uniforms.uFov.value = (camera.object.fov * Math.PI) / 180;

  hud.updateReadout(camera.object.position, state.spin);

  // geodesic background
  renderer.autoClear = true;
  renderer.render(quadScene, quadCam);
  // matter overlay
  renderer.autoClear = false;
  renderer.render(scene, camera.object);

  requestAnimationFrame(frame);
}

onResize();
requestAnimationFrame(frame);
