export const blackholeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Kerr-inspired null-geodesic raytracer.
 *
 *   a = −1.5 (x×v)² x / r⁵  +  2 v × B_g ,  B_g ~ Kerr gravitomagnetic dipole
 *
 * Thin Keplerian accretion disk + Doppler beaming + gravitational redshift.
 * Trapped (photon-sphere) rays are classified as captured so the shadow stays black.
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

vec3 tempRGB(float t) {
  t = clamp(t, 0.0, 1.0);
  // iron-hot palette
  vec3 c0 = vec3(0.35, 0.03, 0.02);
  vec3 c1 = vec3(0.95, 0.2, 0.04);
  vec3 c2 = vec3(1.0, 0.55, 0.12);
  vec3 c3 = vec3(1.0, 0.88, 0.55);
  vec3 c4 = vec3(1.0, 0.98, 0.9);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.55) return mix(c1, c2, (t - 0.25) / 0.3);
  if (t < 0.85) return mix(c2, c3, (t - 0.55) / 0.3);
  return mix(c3, c4, (t - 0.85) / 0.15);
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

vec3 diskEmission(vec3 hit, vec3 camPos) {
  float r = length(hit.xz);
  float phi = atan(hit.z, hit.x);
  float rIn = rIsco();
  float rOut = 14.5;
  if (r < rIn - 0.25 || r > rOut) return vec3(0.0);

  float om = 1.0 / (pow(max(r, 0.6), 1.5) + uSpin);
  float ang = phi - uTime * uTimeScale * om * 5.0;

  // filamentary turbulence (differential shear)
  float f1 = 0.5 + 0.5 * sin(ang * 4.0 + r * 2.2);
  float f2 = 0.5 + 0.5 * sin(ang * 9.0 - r * 4.0 + 0.8);
  float f3 = 0.5 + 0.5 * sin(ang * 2.0 + r * 0.6);
  float turb = 0.45 + 0.3 * f1 * f3 + 0.2 * f2;

  vec3 vdir = vec3(-om * hit.z, 0.0, om * hit.x);
  float speed = clamp(length(vdir), 0.0, 0.88);
  vdir = normalize(vdir + vec3(1e-4, 0.0, 0.0));
  vec3 toObs = normalize(camPos - hit);
  float cosA = dot(vdir, toObs);
  float gamma = 1.0 / sqrt(max(1.0 - speed * speed, 1e-3));
  float D = 1.0 / max(gamma * (1.0 - speed * cosA), 0.15);
  float grav = sqrt(max(0.06, 1.0 - 3.0 / r + 2.0 * uSpin / pow(r, 1.5)));
  float gobs = clamp(D * grav, 0.2, 2.5);

  float t = clamp((r - rIn) / (rOut - rIn), 0.0, 1.0);
  // sharp inner edge, fall-off outward
  float radial = exp(-t * 4.0) * smoothstep(rIn, rIn + 0.2, r);
  radial *= 1.0 - smoothstep(rOut - 1.5, rOut, r);

  // thin disk: high contrast
  float inten = turb * radial * pow(gobs, 3.2);
  // photon-ring / ISCO blaze
  inten += exp(-abs(r - rIn) * 2.5) * 0.7 * pow(gobs, 2.0);

  float temp = clamp(0.3 + 0.8 * exp(-t * 2.0) * mix(0.65, 1.3, clamp(D, 0.4, 1.5)), 0.0, 1.0);
  vec3 col = tempRGB(temp);
  // strong Doppler tint
  col *= mix(vec3(0.5, 0.25, 0.18), vec3(1.2, 1.08, 0.9), clamp(D * 0.55, 0.0, 1.0));

  return col * inten * 10.0;
}

vec3 gridGlow(vec3 p) {
  if (!uShowGrid) return vec3(0.0);
  float r = length(p);
  if (r > 18.0) return vec3(0.0);
  float rings = abs(fract(r * 0.4) - 0.5);
  float lats = abs(fract(p.y * 0.4) - 0.5);
  float line = smoothstep(0.07, 0.0, min(rings, lats));
  float ph = atan(p.z, p.x);
  float twist = 0.5 + 0.5 * sin(ph * 2.0 - r * 0.3 + uTime * 0.2 * uSpin);
  return vec3(0.1, 0.75, 1.0) * line * exp(-r * 0.14) * (0.2 + 0.35 * twist);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float tanF = tan(uFov * 0.5);
  vec3 dir = normalize(uCamBasis[2] + uCamBasis[0] * (uv.x * tanF) + uCamBasis[1] * (uv.y * tanF));

  vec3 pos = uCamPos;
  vec3 vel = dir;

  float capture = rPlus() * 1.08;

  float ci = cos(-uIncl);
  float si = sin(-uIncl);
  mat3 rotX = mat3(1.0, 0.0, 0.0,  0.0, ci, si,  0.0, -si, ci);

  vec3 col = vec3(0.0);
  float photonRing = 0.0;
  bool captured = false;
  bool escaped = false;
  int hitCount = 0;

  int steps = uSteps;

  for (int i = 0; i < 256; i++) {
    if (i >= steps) break;

    float r = length(pos);
    if (r < capture) {
      captured = true;
      break;
    }

    float dt = clamp(r * 0.055, 0.035, 2.2);

    // disk plane (tilted)
    vec3 pD = rotX * pos;
    vec3 vD = rotX * vel;
    float y0 = pD.y;
    float y1 = y0 + vD.y * dt;
    if (i > 0 && y0 * y1 <= 0.0 && abs(y0 - y1) > 1e-6 && hitCount < 3) {
      float s = clamp(y0 / (y0 - y1), 0.0, 1.0);
      vec3 hitW = pos + vel * (dt * s);
      // skip disk samples that are inside the capture region
      if (length(hitW) > capture * 1.15) {
        vec3 hitD = rotX * hitW;
        col += diskEmission(vec3(hitD.x, 0.0, hitD.z), uCamPos);
        hitCount++;
      }
    }

    col += gridGlow(pos);

    float ringR = 2.8 - uSpin * 0.3;
    photonRing += exp(-abs(r - ringR) * 3.5) * clamp(dt * 0.06, 0.0, 0.04);

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

  // Classify leftovers: trapped near hole => shadow
  if (!captured && !escaped) {
    float rend = length(pos);
    if (rend < 12.0) captured = true;
    else escaped = true;
  }

  if (captured) {
    // unoccluded shadow is pure black; keep only real foreground disk hits
    if (hitCount == 0) col = vec3(0.0);
  } else {
    col += starfield(normalize(pos));
  }

  // photon ring
  col += vec3(1.0, 0.92, 0.7) * photonRing * 3.5;

  vec2 q = vUv - 0.5;
  col *= 1.0 - 0.15 * dot(q, q);

  col = max(col, 0.0);
  col = col / (1.0 + col);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;
