export const blackholeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Kerr null-geodesic raytracer with explicit observables:
 *  1) event-horizon shadow (pure black)
 *  2) photon ring (thin bright rim at critical impact parameter)
 *  3) Doppler beaming (approaching side bright/blue, receding dim/red)
 *  4) gravitational redshift (inner disk redder & dimmer)
 *
 * Disk pattern shears differentially so motion is visible.
 */
export const blackholeFrag = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;
uniform float uTime;
uniform float uSpin;
uniform vec3 uCamPos;
uniform mat3 uCamBasis;
uniform float uFov;
uniform int uSteps;
uniform float uIncl;
uniform bool uShowGrid;
uniform float uTimeScale;

float rPlus() {
  return 1.0 + sqrt(max(0.0, 1.0 - uSpin * uSpin));
}

float rIsco() {
  float a = clamp(uSpin, 0.0, 0.998);
  float z1 = 1.0 + pow(max(1.0 - a * a, 0.0), 1.0 / 3.0) *
                 (pow(1.0 + a, 1.0 / 3.0) + pow(1.0 - a, 1.0 / 3.0));
  float z2 = sqrt(3.0 * a * a + z1 * z1);
  return 3.0 + z2 - sqrt(max(0.0, (3.0 - z1) * (3.0 + z1 + 2.0 * z2)));
}

// high-contrast blackbody-ish
vec3 tempRGB(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 red = vec3(0.55, 0.04, 0.02);
  vec3 orange = vec3(1.0, 0.28, 0.04);
  vec3 gold = vec3(1.0, 0.65, 0.15);
  vec3 white = vec3(1.0, 0.95, 0.85);
  if (t < 0.3) return mix(red, orange, t / 0.3);
  if (t < 0.65) return mix(orange, gold, (t - 0.3) / 0.35);
  return mix(gold, white, (t - 0.65) / 0.35);
}

vec3 starfield(vec3 dir) {
  vec3 d = normalize(dir);
  vec3 col = vec3(0.002, 0.003, 0.007);
  float band = exp(-pow(d.y * 1.2 + 0.08, 2.0) * 2.0);
  col += vec3(0.008, 0.012, 0.022) * band;
  for (int i = 0; i < 3; i++) {
    float scale = 50.0 + float(i) * 80.0;
    vec3 gp = d * scale + float(i) * 11.1;
    vec3 id = floor(gp);
    vec3 f = fract(gp) - 0.5;
    float n = fract(sin(dot(id, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    if (n < 0.8) continue;
    float n2 = fract(n * 39.3);
    float star = smoothstep(0.22, 0.0, length(f));
    float br = (n2 - 0.8) / 0.2;
    vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.78, 0.55), fract(n2 * 5.1));
    col += tint * star * br * (0.5 - 0.08 * float(i));
  }
  return col;
}

/**
 * Disk emission at a disk-frame point (y=0).
 * Separates Doppler (view-angle) and gravitational redshift (radius).
 */
vec3 diskEmission(vec3 hit, vec3 camPos) {
  float r = length(hit.xz);
  float phi = atan(hit.z, hit.x);
  float rIn = rIsco();
  float rOut = 14.5;
  if (r < rIn - 0.25 || r > rOut) return vec3(0.0);

  float om = 1.0 / (pow(max(r, 0.6), 1.5) + uSpin);
  // strong visible shear — pattern rotates with local Keplerian rate
  float ang = phi - uTime * uTimeScale * om * 32.0;

  // logarithmic-spiral filaments (shear visibly; avoid static rings)
  float spiralA = ang + log(max(r, 0.5)) * 2.5;
  float spiralB = ang * 2.0 - log(max(r, 0.5)) * 4.0;
  float f1 = 0.5 + 0.5 * sin(spiralA * 5.0);
  float f2 = 0.5 + 0.5 * sin(spiralB * 3.0 + 0.8);
  float f3 = 0.5 + 0.5 * sin(spiralA * 9.0 + uTime * 0.6);
  float turb = 0.12 + 0.9 * pow(f1, 3.5) * (0.45 + 0.55 * f3) + 0.5 * pow(f2, 5.0);
  turb = clamp(turb, 0.05, 2.6);

  // --- Doppler (view-dependent) ---
  vec3 vdir = vec3(-om * hit.z, 0.0, om * hit.x);
  float speed = clamp(length(vdir), 0.0, 0.9);
  vdir = normalize(vdir + vec3(1e-4, 0.0, 0.0));
  vec3 toObs = normalize(camPos - hit);
  float cosA = dot(vdir, toObs);
  float gamma = 1.0 / sqrt(max(1.0 - speed * speed, 1e-3));
  float D = 1.0 / max(gamma * (1.0 - speed * cosA), 0.12); // Doppler factor

  // --- gravitational redshift (radius) ---
  float grav = sqrt(max(0.05, 1.0 - 3.0 / r + 2.0 * uSpin / pow(r, 1.5)));

  // Intensity: beaming ~ D^3  ×  grav^2  (dramatic but readable)
  float beaming = pow(clamp(D, 0.15, 3.0), 3.0);
  float redDim = pow(grav, 2.2);

  float t = clamp((r - rIn) / (rOut - rIn), 0.0, 1.0);
  float radial = exp(-t * 3.5) * smoothstep(rIn, rIn + 0.15, r);
  radial *= 1.0 - smoothstep(rOut - 1.5, rOut, r);

  float inten = turb * radial * beaming * redDim * 3.8;
  // ISCO blaze
  inten += exp(-abs(r - rIn) * 3.0) * 0.9 * beaming * redDim;

  // COLOR encodes both effects explicitly:
  //  · Doppler: blue-white when D>1 (approaching), deep red when D<1 (receding)
  //  · grav:   inner / strong field pushed further toward red
  float heat = clamp(exp(-t * 2.2) * 0.55 + 0.35 * clamp(D, 0.0, 1.5), 0.0, 1.0);
  vec3 warm = tempRGB(heat);

  // Doppler hue push
  vec3 blueShift = vec3(0.85, 0.95, 1.25);
  vec3 redShift = vec3(1.15, 0.35, 0.18);
  float dopp = smoothstep(0.7, 1.35, D);
  vec3 col = mix(redShift, mix(warm, blueShift, 0.45), dopp);
  col = mix(col, warm, 0.45);

  // gravitational redshift: pull toward red near hole
  col = mix(col, vec3(0.85, 0.18, 0.08), (1.0 - grav) * 0.65);

  return col * inten * 5.5;
}

vec3 gridGlow(vec3 p) {
  if (!uShowGrid) return vec3(0.0);
  float r = length(p);
  if (r > 18.0) return vec3(0.0);
  float rings = abs(fract(r * 0.4) - 0.5);
  float lats = abs(fract(p.y * 0.4) - 0.5);
  float line = smoothstep(0.07, 0.0, min(rings, lats));
  float ph = atan(p.z, p.x);
  float twist = 0.5 + 0.5 * sin(ph * 2.0 - r * 0.3 + uTime * 0.3 * uSpin);
  return vec3(0.1, 0.75, 1.0) * line * exp(-r * 0.14) * (0.2 + 0.35 * twist);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float tanF = tan(uFov * 0.5);
  vec3 dir = normalize(uCamBasis[2] + uCamBasis[0] * (uv.x * tanF) + uCamBasis[1] * (uv.y * tanF));

  vec3 pos = uCamPos;
  vec3 vel = dir;

  float capture = rPlus() * 1.05;
  float rPhoton = 2.85 - uSpin * 0.25; // equatorial-ish photon sphere scale

  float ci = cos(-uIncl);
  float si = sin(-uIncl);
  mat3 rotX = mat3(1.0, 0.0, 0.0,  0.0, ci, si,  0.0, -si, ci);

  vec3 col = vec3(0.0);
  float ring = 0.0;
  float minR = 1e5;
  bool captured = false;
  bool escaped = false;
  int hitCount = 0;
  // track whether this ray is a high-order image (wound around the hole)
  float wind = 0.0;

  int steps = uSteps;

  for (int i = 0; i < 256; i++) {
    if (i >= steps) break;

    float r = length(pos);
    minR = min(minR, r);
    if (r < capture) {
      captured = true;
      break;
    }

    float dt = clamp(r * 0.05, 0.03, 2.2);

    // disk crossing
    vec3 pD = rotX * pos;
    vec3 vD = rotX * vel;
    float y0 = pD.y;
    float y1 = y0 + vD.y * dt;
    if (i > 0 && y0 * y1 <= 0.0 && abs(y0 - y1) > 1e-6 && hitCount < 3) {
      float s = clamp(y0 / (y0 - y1), 0.0, 1.0);
      vec3 hitW = pos + vel * (dt * s);
      if (length(hitW) > capture * 1.1) {
        vec3 hitD = rotX * hitW;
        col += diskEmission(vec3(hitD.x, 0.0, hitD.z), uCamPos);
        hitCount++;
      }
    }

    col += gridGlow(pos);

    // photon-sphere proximity — use MAX so intensity is independent of step count
    ring = max(ring, exp(-pow((r - rPhoton) / 0.32, 2.0)));
    wind += abs(cross(vel, pos / max(r, 1e-3)).y) * dt * 0.02;

    // null geodesic force
    vec3 hvec = cross(pos, vel);
    float h2 = dot(hvec, hvec);
    float rr = max(r, 0.4);
    vec3 acc = -1.5 * h2 * pos / (rr * rr * rr * rr * rr);
    vec3 sAxis = vec3(0.0, 1.0, 0.0);
    vec3 rhat = pos / rr;
    vec3 Bg = (2.0 * uSpin / (rr * rr * rr)) * (3.0 * dot(sAxis, rhat) * rhat - sAxis);
    acc += 2.0 * cross(vel, Bg);

    vec3 a1 = acc;
    vec3 p2 = pos + vel * dt;
    vec3 v2 = vel + a1 * dt;
    float r2 = max(length(p2), 0.4);
    vec3 h2v = cross(p2, v2);
    float hh = dot(h2v, h2v);
    vec3 a2 = -1.5 * hh * p2 / (r2 * r2 * r2 * r2 * r2);
    vec3 rh2 = p2 / r2;
    vec3 Bg2 = (2.0 * uSpin / (r2 * r2 * r2)) * (3.0 * dot(sAxis, rh2) * rh2 - sAxis);
    a2 += 2.0 * cross(v2, Bg2);

    pos += 0.5 * (vel + v2) * dt;
    vel += 0.5 * (a1 + a2) * dt;
    float sp = length(vel);
    if (sp > 1e-5) vel *= 1.0 / sp;

    if (length(pos) > 75.0 && i > 2) {
      escaped = true;
      break;
    }
  }

  if (!captured && !escaped) {
    if (length(pos) < 12.0) captured = true;
    else escaped = true;
  }

  // ---------- 1) Event-horizon shadow (soft / 朦胧) ----------
  // Keep foreground disk hits so the near disk wraps over the silhouette
  // instead of looking like a sticker punched on top of the plate.
  if (captured) {
    if (hitCount == 0) {
      // muted olive-warm void (matches the hazy v1 look)
      col = vec3(0.045, 0.048, 0.038);
    }
    // soft blend near the silhouette edge
    float edge = smoothstep(capture * 0.95, capture * 1.6, minR);
    col = mix(col * 0.35, col, edge);
  } else {
    col += starfield(normalize(pos)) * 0.85;
  }

  // ---------- 2) Photon ring: very thin, step-count independent ----------
  float graze = exp(-pow((minR - rPhoton) / 0.10, 2.0));
  // whisper of higher-order glow (constant width — does not bloom with uSteps)
  float halo = exp(-pow((minR - rPhoton) / 0.4, 2.0)) * 0.18;
  if (!captured) {
    col += vec3(1.0, 0.92, 0.72) * (graze * 1.1 + halo);
  }

  // atmospheric haze around the hole (朦胧美)
  float haze = exp(-max(0.0, minR - capture) * 0.25) * 0.055;
  col += vec3(0.4, 0.32, 0.24) * haze;

  vec2 q = vUv - 0.5;
  col *= 1.0 - 0.08 * dot(q, q);

  col = max(col, 0.0);
  // slight lift so blacks stay soft, not crushed
  col = mix(col, col + 0.02, 0.5);
  col = col / (1.0 + col);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;
