export const blackholeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Bent-ray Kerr-style renderer (stable Cartesian null-geodesic + frame dragging)
 * Disk sampled ONLY on bent-ray crossings → lensed secondary image.
 * Volumetric puff + Novikov–Thorne T ∝ (r_in/r)^{3/4} + fbm.
 * ACES tonemap.
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
uniform float uSteps;
uniform float uIncl;
uniform bool uShowGrid;
uniform float uTimeScale;

const float PI = 3.14159265359;

float rPlus() { return 1.0 + sqrt(max(0.0, 1.0 - uSpin * uSpin)); }

float rIsco() {
  float a = clamp(uSpin, 0.0, 0.998);
  float z1 = 1.0 + pow(max(1.0 - a * a, 0.0), 1.0 / 3.0) *
                 (pow(1.0 + a, 1.0 / 3.0) + pow(1.0 - a, 1.0 / 3.0));
  float z2 = sqrt(3.0 * a * a + z1 * z1);
  return 3.0 + z2 - sqrt(max(0.0, (3.0 - z1) * (3.0 + z1 + 2.0 * z2)));
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash21(i), b = hash21(i + vec2(1, 0));
  float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) {
    s += amp * vnoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return s;
}

vec3 blackbody(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.4, 0.04, 0.02);
  vec3 c1 = vec3(0.95, 0.22, 0.04);
  vec3 c2 = vec3(1.0, 0.65, 0.22);
  vec3 c3 = vec3(1.0, 0.96, 0.88);
  if (t < 0.35) return mix(c0, c1, t / 0.35);
  if (t < 0.7) return mix(c1, c2, (t - 0.35) / 0.35);
  return mix(c2, c3, (t - 0.7) / 0.3);
}

float gDisk(float r, vec3 hit, vec3 camPos) {
  float om = 1.0 / (pow(max(r, 0.6), 1.5) + uSpin);
  vec3 v = vec3(-om * hit.z, 0.0, om * hit.x);
  float speed = clamp(length(v), 0.0, 0.9);
  v = normalize(v + vec3(1e-4, 0.0, 0.0));
  vec3 toObs = normalize(camPos - hit);
  float cosA = dot(v, toObs);
  float gamma = 1.0 / sqrt(max(1.0 - speed * speed, 1e-3));
  float dop = 1.0 / max(gamma * (1.0 - speed * cosA), 0.12);
  float grav = sqrt(max(0.05, 1.0 - 3.0 / r + 2.0 * uSpin / pow(r, 1.5)));
  return clamp(dop * grav, 0.2, 2.8);
}

// Novikov–Thorne + fbm
vec3 diskShade(float r, float phi, vec3 hit, vec3 camPos) {
  float rIn = rIsco();
  float rOut = 14.0;
  if (r < rIn - 0.05 || r > rOut) return vec3(0.0);
  float g = gDisk(r, hit, camPos);
  float temp = pow(max(rIn / r, 0.05), 0.75); // NT
  float t = clamp((r - rIn) / (rOut - rIn), 0.0, 1.0);
  float radial = smoothstep(rIn, rIn + 0.06, r) * exp(-t * 3.0);
  radial *= 1.0 - smoothstep(rOut - 2.0, rOut, r);
  float om = 1.0 / (pow(max(r, 0.6), 1.5) + uSpin);
  vec2 uvp = vec2(phi * 1.3 - uTime * uTimeScale * om * 7.0, log(max(r, 1.0)) * 2.2);
  float turb = 0.55 + 0.55 * fbm(uvp * 1.6);
  float beam = pow(clamp(g, 0.3, 2.5), 2.6);
  float inten = turb * radial * beam * (0.4 + 1.0 * temp);
  inten += exp(-abs(r - rIn) * 4.0) * 1.3 * beam;
  vec3 col = blackbody(clamp(temp * mix(0.8, 1.15, clamp(g, 0.0, 1.4)), 0.0, 1.0));
  col *= mix(vec3(1.1, 0.35, 0.2), vec3(1.05, 1.0, 0.9), smoothstep(0.75, 1.35, g));
  return col * inten * 6.5;
}

vec3 starfield(vec3 dir) {
  vec3 d = normalize(dir);
  vec3 col = vec3(0.002, 0.003, 0.007);
  for (int i = 0; i < 3; i++) {
    float scale = 50.0 + float(i) * 80.0;
    vec3 gp = d * scale + float(i) * 11.1;
    vec3 id = floor(gp);
    vec3 f = fract(gp) - 0.5;
    float n = fract(sin(dot(id, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    if (n < 0.8) continue;
    float star = smoothstep(0.2, 0.0, length(f));
    col += vec3(0.7, 0.8, 1.0) * star * ((n - 0.8) / 0.2) * 0.5;
  }
  return col;
}

vec3 gridGlow(vec3 p) {
  if (!uShowGrid) return vec3(0.0);
  float r = length(p);
  if (r > 18.0) return vec3(0.0);
  float rings = abs(fract(r * 0.4) - 0.5);
  float lats = abs(fract(p.y * 0.4) - 0.5);
  float line = smoothstep(0.07, 0.0, min(rings, lats));
  float ph = atan(p.z, p.x);
  float twist = 0.5 + 0.5 * sin(ph * 2.0 - r * 0.3 + uTime * 0.25 * uSpin);
  return vec3(0.1, 0.75, 1.0) * line * exp(-r * 0.12) * (0.2 + 0.3 * twist);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;
  float tanF = tan(uFov * 0.5);
  vec3 dir = normalize(uCamBasis[2] + uCamBasis[0] * (uv.x * tanF) + uCamBasis[1] * (uv.y * tanF));

  vec3 pos = uCamPos;
  vec3 vel = dir;
  float capture = rPlus() * 1.05;

  vec3 col = vec3(0.0);
  vec3 frontDisk = vec3(0.0);
  vec3 volCol = vec3(0.0);
  bool captured = false;
  bool escaped = false;
  int hits = 0;
  int steps = int(clamp(uSteps, 32.0, 128.0));
  float prevY = pos.y;

  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    float r = length(pos);
    if (r < capture) { captured = true; break; }
    if (r > 70.0 && i > 3) { escaped = true; break; }

    float dt = clamp(r * 0.05, 0.03, 2.0);

    // volumetric thick disk along the bent ray
    float cylR = length(pos.xz);
    float rInV = rIsco() * 0.95;
    if (cylR > rInV && cylR < 13.0 && abs(pos.y) < 2.8) {
      float H = 0.13 * cylR + 0.28;
      float dens = exp(-pow(pos.y / H, 2.0)) * exp(-pow((cylR - rInV) / 11.0, 1.4) * 2.0);
      volCol += diskShade(cylR, atan(pos.z, pos.x), vec3(pos.x, 0.0, pos.z), uCamPos) * dens * dt * 1.8;
    }

    // equator crossing on the BENT ray (gives lensed secondary image)
    float y1 = (pos + vel * dt).y;
    if (i > 0 && prevY * y1 < 0.0 && hits < 3) {
      float s = prevY / (prevY - y1 + 1e-8);
      vec3 hitW = pos + vel * (dt * clamp(s, 0.0, 1.0));
      float rh = length(hitW.xz);
      if (rh > capture * 1.05) {
        vec3 em = diskShade(rh, atan(hitW.z, hitW.x), vec3(hitW.x, 0.0, hitW.z), uCamPos);
        col += em;
        if (hits == 0) frontDisk = em;
        hits++;
      }
    }
    prevY = y1;
    col += gridGlow(pos) * 0.35;

    // null geodesic: Schwarzschild form + Kerr frame dragging
    vec3 hvec = cross(pos, vel);
    float h2 = dot(hvec, hvec);
    float rr = max(r, 0.4);
    vec3 acc = -1.5 * h2 * pos / (rr * rr * rr * rr * rr);
    vec3 sAxis = vec3(0.0, 1.0, 0.0);
    vec3 rhat = pos / rr;
    acc += 2.0 * cross(vel, (2.0 * uSpin / (rr * rr * rr)) * (3.0 * dot(sAxis, rhat) * rhat - sAxis));
    vec3 p2 = pos + vel * dt;
    vec3 v2 = vel + acc * dt;
    float r2 = max(length(p2), 0.4);
    vec3 h2b = cross(p2, v2);
    float hh = dot(h2b, h2b);
    vec3 a2 = -1.5 * hh * p2 / (r2 * r2 * r2 * r2 * r2);
    a2 += 2.0 * cross(v2, (2.0 * uSpin / (r2 * r2 * r2)) * (3.0 * dot(sAxis, p2 / r2) * (p2 / r2) - sAxis));
    pos += 0.5 * (vel + v2) * dt;
    vel += 0.5 * (acc + a2) * dt;
    float sp = length(vel);
    if (sp > 1e-5) vel *= 1.0 / sp;
  }

  if (!captured && !escaped) {
    if (length(pos) < 12.0) captured = true;
    else escaped = true;
  }

  // soft critical curve for the photon ring
  float bImp = length(cross(uCamPos, dir));
  float R0 = 3.0 * sqrt(3.0);
  float ring = exp(-pow((bImp - R0) / 0.5, 2.0));

  if (captured) {
    col = frontDisk * 0.85 + volCol * 0.45;
  } else {
    vec3 sky = starfield(normalize(pos));
    col += sky * 0.8 + volCol * 0.35;
    col += vec3(1.0, 0.93, 0.75) * ring * 2.0;
  }
  col += vec3(0.55, 0.4, 0.25) * exp(-pow((bImp - R0) / 1.1, 2.0)) * 0.07;

  col = max(col, 0.0);
  col = aces(col * 1.05);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;
