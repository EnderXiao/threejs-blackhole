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
const matter = new MatterField(11000);
scene.add(matter.points);

const hud = new HUD();
// world-space points the annotation cards track (BH features, not the screen)
const tagAnchor = {
  shadow: new THREE.Vector3(0, 0, 0),
  ring: new THREE.Vector3(3.6, 0.15, 0),
  doppler: new THREE.Vector3(8.5, 0, 2.0),
  redshift: new THREE.Vector3(-6.5, 0, -1.5),
};
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
  // pointer-lock only when clicking the canvas (see FreeCamera)
});

// Hovering the side panel unlocks the mouse so sliders/checkboxes work
const side = document.querySelector('.hud-side');
const unlockPointer = () => {
  if (document.pointerLockElement) document.exitPointerLock();
};
side?.addEventListener('mouseenter', unlockPointer);
side?.addEventListener('mousedown', unlockPointer);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH') hud.toggle();
  if (e.code === 'KeyT') {
    e.preventDefault();
    hud.toggleTags();
  }
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
  matter.setCameraPosition(camera.object.position);

  hud.updateReadout(camera.object.position, state.spin);

  // world-anchored physics labels (project to screen each frame)
  {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const anchors = {
      shadow: tagAnchor.shadow,
      ring: tagAnchor.ring,
      doppler: tagAnchor.doppler,
      redshift: tagAnchor.redshift,
    };
    const map = {};
    for (const key of Object.keys(anchors)) {
      const v = anchors[key].clone().project(camera.object);
      map[key] = {
        x: (v.x * 0.5 + 0.5) * w,
        y: (-v.y * 0.5 + 0.5) * h,
        visible: v.z < 1.0 && v.z > -1.0,
      };
    }
    hud.placeTags(map);
  }

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
