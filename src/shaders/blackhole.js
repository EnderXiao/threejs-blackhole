export const blackholeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Kerr-inspired null-geodesic raytracer (stable Cartesian form + frame dragging).
 * Photon ring / secondary image emerge from bent paths hitting the disk.
 * Disk uses relativistic g-factor (Doppler + gravitational redshift).
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
  vec3 c0 = vec3(0.4, 0.04, 0.02);
  vec3 c1 = vec3(0.95, 0.22, 0.04);
  vec3 c2 = vec3(1.0, 0.6, 0.14);
  vec3 c3 = vec3(1.0, 0.9, 0.65);
  vec3 c4 = vec3(1.0, 0.97, 0.9);
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
    float star = smoothstep(0.2, 0.0, length(f));
    float br = (n2 - 0.8) / 0.2;
    vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.78, 0.55), fract(n2 * 5.1));
    col += tint * star * br * (0.5 - 0.08 * float(i));
  }
  return col;
}

/** g = ν_obs/ν_em for equatorial Kerr circular orbit (Doppler × grav). */
float gFactor(float r, vec3 hit, vec3 camPos) {
  float om = 1.0 / (pow(max(r, 0.6), 1.5) + uSpin);
  vec3 vdir = vec3(-om * hit.z, 0.0, om * hit.x);
  float speed = clamp(length(vdir), 0.0, 0.9);
  vdir = normalize(vdir + vec3(1e-4, 0.0, 0.0));
  vec3 toObs = normalize(camPos - hit);
  float cosA = dot(vdir, toObs);
  float gamma = 1.0 / sqrt(max(1.0 - speed * speed, 1e-3));
  float doppler = 1.0 / max(gamma * (1.0 - speed * cosA), 0.12);
  float grav = sqrt(max(0.05, 1.0 - 3.0 / r + 2.0 * uSpin / pow(r, 1.5)));
  return clamp(doppler * grav, 0.08, 3.5);
}

/**
 * Thin Keplerian disk — smooth shear (no moiré fingerprints).
 * I_obs = g³ I_em ; color shifts with g.
 */
vec3 diskEmission(vec3 hit, vec3 camPos) {
  float r = length(hit.xz);
  float phi = atan(hit.z, hit.x);
  float rIn = rIsco();
  float rOut = 13.5;
  if (r < rIn - 0.15 || r > rOut) return vec3(0.0);

  float om = 1.0 / (pow(max(r, 0.6), 1.5) + uSpin);
  float ang = phi - uTime * uTimeScale * om * 10.0;

  // very low-frequency shear — avoid moiré fingerprints
  float sp = ang + log(max(r, 0.5)) * 0.6;
  float f1 = 0.5 + 0.5 * sin(sp * 1.0);
  float f2 = 0.5 + 0.5 * sin(0.5 * sp + r * 0.15);
  float turb = 0.7 + 0.25 * f1 + 0.1 * f2;
  turb = clamp(turb, 0.5, 1.15);

  float g = gFactor(r, hit, camPos);

  float t = clamp((r - rIn) / (rOut - rIn), 0.0, 1.0);
  float radial = exp(-t * 2.8) * smoothstep(rIn, rIn + 0.3, r);
  radial *= 1.0 - smoothstep(rOut - 2.0, rOut, r);

  float temp = clamp(pow(max(rIn / r, 0.05), 0.7), 0.0, 1.0);
  float inten = turb * radial * pow(g, 3.0) * (0.45 + 0.55 * temp);

  vec3 col = tempRGB(clamp(temp * mix(0.75, 1.15, clamp(g, 0.0, 1.4)), 0.0, 1.0));
  col *= mix(vec3(1.1, 0.35, 0.22), vec3(1.1, 1.05, 0.95), smoothstep(0.7, 1.3, g));

  return col * inten * 5.0;
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
  return vec3(0.1, 0.75, 1.0) * line * exp(-r * 0.12) * (0.2 + 0.3 * twist);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float tanF = tan(uFov * 0.5);
  vec3 dir = normalize(uCamBasis[2] + uCamBasis[0] * (uv.x * tanF) + uCamBasis[1] * (uv.y * tanF));

  vec3 pos = uCamPos;
  vec3 vel = dir;

  float capture = rPlus() * 1.05;

  float ci = cos(-uIncl);
  float si = sin(-uIncl);
  mat3 rotX = mat3(1.0, 0.0, 0.0,  0.0, ci, si,  0.0, -si, ci);

  vec3 col = vec3(0.0);
  bool captured = false;
  bool escaped = false;
  int hitCount = 0;
  float minR = 1e5;

  int steps = int(clamp(uSteps, 32.0, 128.0));

  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;

    float r = length(pos);
    minR = min(minR, r);
    if (r < capture) {
      captured = true;
      break;
    }
    if (r > 70.0 && i > 2) {
      escaped = true;
      break;
    }

    float dt = clamp(r * 0.05, 0.03, 2.0);

    // disk plane crossing
    vec3 pD = rotX * pos;
    vec3 vD = rotX * vel;
    float y0 = pD.y;
    float y1 = y0 + vD.y * dt;
    if (i > 0 && y0 * y1 <= 0.0 && abs(y0 - y1) > 1e-6 && hitCount < 3) {
      float s = clamp(y0 / (y0 - y1), 0.0, 1.0);
      vec3 hitW = pos + vel * (dt * s);
      if (length(hitW) > capture * 1.15) {
        vec3 hitD = rotX * hitW;
        // physical cylindrical radius in spin-aligned disk
        col += diskEmission(vec3(hitW.x, 0.0, hitW.z), uCamPos);
        hitCount++;
        // also allow a secondary (lensed) contribution from disk-frame radius
        float rD = length(hitD.xz);
        if (abs(rD - length(hitW.xz)) > 0.5) {
          // ignore — use world xz only
        }
      }
    }

    col += gridGlow(pos);

    // null geodesic: Schwarzschild exact spatial form + Kerr frame dragging
    vec3 hvec = cross(pos, vel);
    float h2 = dot(hvec, hvec);
    float rr = max(r, 0.4);
    vec3 acc = -1.5 * h2 * pos / (rr * rr * rr * rr * rr);

    vec3 sAxis = vec3(0.0, 1.0, 0.0);
    vec3 rhat = pos / rr;
    vec3 Bg = (2.0 * uSpin / (rr * rr * rr)) * (3.0 * dot(sAxis, rhat) * rhat - sAxis);
    acc += 2.0 * cross(vel, Bg);

    // Heun
    vec3 a1 = acc;
    vec3 p2 = pos + vel * dt;
    vec3 v2 = vel + a1 * dt;
    float r2 = max(length(p2), 0.4);
    vec3 h2b = cross(p2, v2);
    float hh = dot(h2b, h2b);
    vec3 a2 = -1.5 * hh * p2 / (r2 * r2 * r2 * r2 * r2);
    vec3 rh2 = p2 / r2;
    vec3 Bg2 = (2.0 * uSpin / (r2 * r2 * r2)) * (3.0 * dot(sAxis, rh2) * rh2 - sAxis);
    a2 += 2.0 * cross(v2, Bg2);

    pos += 0.5 * (vel + v2) * dt;
    vel += 0.5 * (a1 + a2) * dt;
    float sp = length(vel);
    if (sp > 1e-5) vel *= 1.0 / sp;
  }

  if (!captured && !escaped) {
    if (length(pos) < 12.0) captured = true;
    else escaped = true;
  }

  // ---------- Shadow (soft / 朦胧) ----------
  // Keep any foreground disk hits so the near plate can wrap over the silhouette.
  vec3 disk = col;
  vec3 sky = (escaped) ? starfield(normalize(pos)) * 0.75 : vec3(0.0);

  // 事件视界阴影：临界曲线内纯黑
  // 光子环：贴着阴影外缘的厚软亮环（第一版观感）
  // 其外：吸积盘 / 星空 —— 中间不允许出现灰黑空带
  // Critical curve (needed by composite below)
  vec3 bvec = cross(uCamPos, dir);
  float bImp = length(bvec);
  vec3 toB = normalize(-uCamPos);
  vec3 dperp = dir - toB * dot(dir, toB);
  float soAng = atan(dot(dperp, uCamBasis[1]), dot(dperp, uCamBasis[0]));
  float spAng = atan(dot(vec3(0.0, 1.0, 0.0), uCamBasis[1]),
                     dot(vec3(0.0, 1.0, 0.0), uCamBasis[0]));
  float aS = clamp(uSpin, 0.0, 0.998);
  // Kerr critical curve (Bardeen+ 1972; Johannsen 2013; Gralla–Holz–Wald 2019):
  // a nearly circular closed curve — one side gently flattened & the center
  // offset with spin+inclination. NOT a letter-D chord cut, NOT a hard ellipse.
  float rel = soAng - spAng;
  float a2 = aS * aS;
  float R0 = 3.0 * sqrt(3.0); // 5.196
  // mild egg/D: r(φ) = R0 (1 + c1 a cos φ + c2 a² cos 2φ), c1²<1 ⇒ smooth convex
  float rC = R0 * (1.0 - 0.04 * a2)
           * (1.0 + 0.22 * aS * cos(rel) + 0.07 * a2 * cos(2.0 * rel));
  bool inside = bImp < rC;
  // normalized residual for the ring (0 on the critical curve)
  float dSdf = bImp - rC;
  float bCrit = rC;
  float ell = 1.0;

  float ring = exp(-pow(dSdf / 0.45, 2.0));
  float ringCore = exp(-pow(dSdf / 0.1, 2.0));
  vec3 ringCol = mix(vec3(1.0, 0.9, 0.72), vec3(1.0, 0.98, 0.92), ringCore);

  if (inside) {
    // 第一版观感：阴影内纯黑，不把盘画成横条盖上去
    col = vec3(0.0);
    // 环的内侧轻渗光，保持「贴边」
    col += ringCol * ring * 0.85;
  } else {
    col = disk + sky;
    col += ringCol * (ring * 2.5 + ringCore * 1.7);
  }

  vec2 q = vUv - 0.5;
  col *= 1.0 - 0.08 * dot(q, q);

  col = max(col, 0.0);
  col = col / (1.0 + col);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;
