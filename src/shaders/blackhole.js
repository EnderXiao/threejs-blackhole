export const blackholeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Kerr null-geodesic raytracer (Carter-separable form, M = 1).
 *
 * Conserved quantities (E, L, Q) from a ZAMO tetrad at the camera.
 * First-order motion (RESEARCH.md §2):
 *   Σ dr/dλ  = ±√R ,  R = P² − Δ[(L − aE)² + Q]
 *   Σ dθ/dλ  = ±√Θ ,  Θ = Q − L² cot²θ + a²E² cos²θ
 *   Σ dφ/dλ  = −(aE − L/sin²θ) + aP/Δ
 *   P = (r² + a²)E − aL ,  Σ = r² + a² cos²θ ,  Δ = r² − 2r + a²
 *
 * Photon ring / shadow / secondary image emerge from the geodesic map —
 * there is NO synthetic photon-ring glow.
 *
 * Disk emission uses the exact Kerr circular-orbit 4-velocity and the
 * relativistic g-factor g = E / (−k_μ u^μ_em) for Doppler + gravitational
 * redshift (I_obs = g³ I_em).
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
uniform float uSteps; // float for Three.js upload compatibility
uniform float uIncl;
uniform bool uShowGrid;
uniform float uTimeScale;

const float PI = 3.141592653589793;

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

// —— Kerr metric (M = 1) ——
float Sigma(float r, float th) {
  float c = cos(th);
  return r * r + uSpin * uSpin * c * c;
}
float Delta(float r) {
  return r * r - 2.0 * r + uSpin * uSpin;
}
float Aacc(float r, float th) {
  float s = sin(th);
  float rr = r * r + uSpin * uSpin;
  return rr * rr - Delta(r) * uSpin * uSpin * s * s;
}

// Carter radial / polar potentials (null, E general)
float radialR(float r, float E, float L, float Q) {
  float P = (r * r + uSpin * uSpin) * E - uSpin * L;
  float d = Delta(r);
  float mu = L - uSpin * E;
  return P * P - d * (mu * mu + Q);
}

float polarTheta(float th, float E, float L, float Q) {
  float c = cos(th);
  float s = max(abs(sin(th)), 1e-4);
  float cot = c / s;
  return Q - L * L * cot * cot + uSpin * uSpin * E * E * c * c;
}

/**
 * Build (E, L, Q) and velocity signs from a local ZAMO ray direction.
 * n = (n_r, n_θ, n_φ) unit in the orthonormal triad (energy scale ε = 1).
 */
void carterFromZAMO(
  vec3 n, float r, float th,
  out float E, out float L, out float Q,
  out float sr, out float st
) {
  float Sig = Sigma(r, th);
  float Del = max(Delta(r), 1e-4);
  float A = max(Aacc(r, th), 1e-4);
  float sth = max(sin(th), 1e-3);
  float alpha = sqrt(max(Sig * Del / A, 1e-8));       // ZAMO lapse
  float omega = 2.0 * uSpin * r / A;                   // frame dragging

  // ZAMO tetrad → coordinate 4-momentum (ε = 1)
  // u^μ = (1/α, 0, 0, ω/α)
  // e_r̂ = √(Δ/Σ) ∂_r ,  e_θ̂ = 1/√Σ ∂_θ ,  e_φ̂ = √(Σ/A)/sinθ ∂_φ
  float kt = 1.0 / alpha;
  float kr = n.x * sqrt(Del / Sig);
  float kth = n.y / sqrt(Sig);
  float kph = omega / alpha + n.z * sqrt(Sig / A) / sth;

  // metric
  float g_tt = -(1.0 - 2.0 * r / Sig);
  float g_tp = -2.0 * uSpin * r * sth * sth / Sig;
  float g_pp = A * sth * sth / Sig;
  float g_thth = Sig;

  // k_μ
  float k_t = g_tt * kt + g_tp * kph;
  float k_p = g_tp * kt + g_pp * kph;
  float k_th = g_thth * kth;

  E = -k_t;
  L = k_p;
  // Carter: Q = p_θ² + L² cot²θ − a² E² cos²θ   (μ = 0)
  float c = cos(th);
  Q = k_th * k_th + L * L * (c * c) / (sth * sth) - uSpin * uSpin * E * E * c * c;
  // Enforce R(r0) ≥ 0 and consistent with the tetrad (Σ k^r)² = n_r² Σ Δ
  // R = P² − Δ[(L−aE)² + Q]  ⇒  adjust Q if roundoff made R negative
  float P0 = (r * r + uSpin * uSpin) * E - uSpin * L;
  float Rexpect = n.x * n.x * Sig * Del;
  float QfromR = (P0 * P0 - Rexpect) / Del - (L - uSpin * E) * (L - uSpin * E);
  // blend: prefer the Θ-based Q, fall back if R would be invalid
  float Rq = P0 * P0 - Del * ((L - uSpin * E) * (L - uSpin * E) + Q);
  if (Rq < 0.0) Q = QfromR;
  Q = max(Q, 0.0);

  // initial march signs from local radial / polar direction
  sr = n.x < 0.0 ? -1.0 : 1.0;
  st = n.y < 0.0 ? -1.0 : 1.0;
  // If looking nearly radially, keep sign
  if (abs(n.x) < 1e-3) sr = -1.0; // default: march toward the hole
}

// Exact equatorial Kerr circular-orbit 4-velocity (prograde)
// Ω = 1/(r^{3/2}+a),  u^μ = u^t (1, 0, 0, Ω)
void circularU(float r, out float ut, out float uOm) {
  uOm = 1.0 / (pow(max(r, 0.6), 1.5) + uSpin);
  float sth = 1.0; // equator
  float Sig = Sigma(r, 0.5 * PI);
  float Del = Delta(r);
  float A = Aacc(r, 0.5 * PI);
  float g_tt = -(1.0 - 2.0 * r / Sig);
  float g_tp = -2.0 * uSpin * r * sth * sth / Sig;
  float g_pp = A * sth * sth / Sig;
  float denom = -(g_tt + 2.0 * uOm * g_tp + uOm * uOm * g_pp);
  ut = 1.0 / sqrt(max(denom, 1e-6));
}

/**
 * g = ν_obs / ν_em = E / (−k_μ u^μ_em)  for a distant observer with E ≈ ν_obs.
 * Returns also the equatorial orbital speed proxy for coloring.
 */
float redshiftG(float r, vec3 hit, float E, float L, float kth) {
  float ut, uOm;
  circularU(r, ut, uOm);
  // k_μ u^μ = k_t u^t + k_φ u^φ = (−E)(u^t) + L (u^t Ω)   since u^t = ut, u^φ = Ω u^t
  // wait: u^t = ut, u^φ = uOm * ut
  // k_μ u^μ = k_t * u^t + k_φ * u^φ = (−E)*ut + L*(uOm*ut) = ut*(−E + L*uOm)
  float kdotu = ut * (-E + L * uOm);
  float g = E / max(-kdotu, 1e-4);
  return clamp(g, 0.05, 4.0);
}

vec3 tempRGB(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.4, 0.04, 0.02);
  vec3 c1 = vec3(0.95, 0.22, 0.04);
  vec3 c2 = vec3(1.0, 0.6, 0.14);
  vec3 c3 = vec3(1.0, 0.92, 0.7);
  vec3 c4 = vec3(1.0, 0.98, 0.92);
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

/**
 * Thin Keplerian disk emission at cylindrical (r, φ) in the (tilted) disk plane.
 * Relativistic beaming via g³; color shifted by g.
 */
vec3 diskEmission(float r, float phi, float g, float gTimePhase) {
  float rIn = rIsco();
  float rOut = 14.5;
  if (r < rIn - 0.2 || r > rOut) return vec3(0.0);

  float om = 1.0 / (pow(max(r, 0.6), 1.5) + uSpin);
  float ang = phi - gTimePhase * om;

  // differential-shear filaments (visual texture of the flow)
  float spA = ang + log(max(r, 0.5)) * 2.5;
  float f1 = 0.5 + 0.5 * sin(spA * 5.0);
  float f2 = 0.5 + 0.5 * sin(spA * 3.0 - log(max(r, 0.5)) * 3.0);
  float turb = 0.3 + 0.7 * pow(f1, 2.0) * (0.5 + 0.5 * f2);
  turb = clamp(turb, 0.15, 1.8);

  float t = clamp((r - rIn) / (rOut - rIn), 0.0, 1.0);
  float radial = exp(-t * 3.5) * smoothstep(rIn, rIn + 0.15, r);
  radial *= 1.0 - smoothstep(rOut - 1.5, rOut, r);

  // intrinsic temperature profile T ∝ r^{-3/4} (thin disk)
  float temp = pow(max(rIn / r, 0.05), 0.75);
  temp = clamp(temp, 0.0, 1.0);

  // I_obs = g³ I_em  (relativistic beaming + energy shift of photon number)
  float inten = turb * radial * pow(g, 3.0) * (0.4 + 0.6 * temp);

  // color: hotter + blueshift (g>1) → cream; cooler + redshift (g<1) → deep red
  vec3 col = tempRGB(clamp(temp * mix(0.7, 1.2, clamp(g, 0.0, 1.5)), 0.0, 1.0));
  col *= mix(vec3(1.15, 0.4, 0.25), vec3(1.1, 1.05, 0.95), smoothstep(0.7, 1.3, g));

  return col * inten * 4.5;
}

vec3 gridGlow(float r, float th, float phi) {
  if (!uShowGrid) return vec3(0.0);
  if (r > 18.0) return vec3(0.0);
  vec3 p = vec3(r * sin(th) * cos(phi), r * cos(th), r * sin(th) * sin(phi));
  float rings = abs(fract(r * 0.4) - 0.5);
  float lats = abs(fract(th * 2.0) - 0.5);
  float line = smoothstep(0.07, 0.0, min(rings, lats));
  float twist = 0.5 + 0.5 * sin(phi * 2.0 - r * 0.3 + uTime * 0.25 * uSpin);
  return vec3(0.1, 0.75, 1.0) * line * exp(-r * 0.12) * (0.2 + 0.3 * twist);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float tanF = tan(uFov * 0.5);
  vec3 dir = normalize(uCamBasis[2] + uCamBasis[0] * (uv.x * tanF) + uCamBasis[1] * (uv.y * tanF));

  // camera Cartesian → Boyer–Lindquist-like spherical
  vec3 cp = uCamPos;
  float r0 = max(length(cp), rPlus() * 1.02);
  float th0 = acos(clamp(cp.y / max(length(cp), 1e-4), -1.0, 1.0));
  float ph0 = atan(cp.z, cp.x);

  // local orthonormal-ish triad (ZAMO spatial axes, approximated by spherical)
  vec3 er = normalize(cp + 1e-6);
  vec3 upRef = abs(er.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 eph = normalize(cross(upRef, er));
  vec3 eth = normalize(cross(er, eph));
  vec3 nLocal = vec3(dot(dir, er), dot(dir, eth), dot(dir, eph));
  nLocal = normalize(nLocal);

  float E, L, Q, sr, st;
  carterFromZAMO(nLocal, r0, th0, E, L, Q, sr, st);
  if (E < 1e-4) E = 1.0; // safety

  // disk tilt
  float ci = cos(-uIncl);
  float si = sin(-uIncl);
  mat3 rotX = mat3(1.0, 0.0, 0.0,  0.0, ci, si,  0.0, -si, ci);

  float r = r0;
  float th = th0;
  float ph = ph0;

  vec3 col = vec3(0.0);
  bool captured = false;
  bool escaped = false;
  bool diskHit = false;
  float minR = 1e5;
  int hits = 0;

  float prevY = (rotX * vec3(
    r * sin(th) * cos(ph),
    r * cos(th),
    r * sin(th) * sin(ph)
  )).y;

  float dtScale = uTimeScale * 24.0;
  // hard cap keeps the Heun loop stable on all GPUs
  int steps = int(clamp(uSteps, 16.0, 128.0));

  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;

    minR = min(minR, r);
    float rh = rPlus();
    if (r <= rh * 1.02) {
      captured = true;
      break;
    }
    if (r > 55.0 && i > 3) {
      escaped = true;
      break;
    }

    float Sig = max(Sigma(r, th), 1e-3);
    float Del = max(Delta(r), 1e-3);
    float Rv = max(radialR(r, E, L, Q), 0.0);
    float Tv = max(polarTheta(th, E, L, Q), 0.0);

    // turning points (once per step)
    if (radialR(r, E, L, Q) <= 0.0) sr = -sr;
    if (polarTheta(th, E, L, Q) <= 0.0) st = -st;

    float dr = sr * sqrt(Rv) / Sig;
    float dth = st * sqrt(Tv) / Sig;
    float P = (r * r + uSpin * uSpin) * E - uSpin * L;
    float dph = (-(uSpin * E - L / max(sin(th) * sin(th), 1e-3)) + uSpin * P / Del) / Sig;

    float h = 0.05 * (0.3 + 0.7 * clamp((r - rh) / 6.0, 0.1, 1.0));

    // Heun
    float r1 = r + dr * h;
    float th1 = clamp(th + dth * h, 1e-3, PI - 1e-3);
    float ph1 = ph + dph * h;

    float Sig1 = max(Sigma(r1, th1), 1e-3);
    float Del1 = max(Delta(r1), 1e-3);
    float R1 = max(radialR(r1, E, L, Q), 0.0);
    float T1 = max(polarTheta(th1, E, L, Q), 0.0);
    float sr1 = sr;
    float st1 = st;
    if (radialR(r1, E, L, Q) <= 0.0) sr1 = -sr;
    if (polarTheta(th1, E, L, Q) <= 0.0) st1 = -st;
    float dr1 = sr1 * sqrt(R1) / Sig1;
    float dth1 = st1 * sqrt(T1) / Sig1;
    float P1 = (r1 * r1 + uSpin * uSpin) * E - uSpin * L;
    float dph1 = (-(uSpin * E - L / max(sin(th1) * sin(th1), 1e-3)) + uSpin * P1 / Del1) / Sig1;

    // disk plane crossing (tilted equatorial)
    vec3 cart0 = vec3(r * sin(th) * cos(ph), r * cos(th), r * sin(th) * sin(ph));
    vec3 cart1 = vec3(r1 * sin(th1) * cos(ph1), r1 * cos(th1), r1 * sin(th1) * sin(ph1));
    float y0 = (rotX * cart0).y;
    float y1 = (rotX * cart1).y;
    if (i > 0 && y0 * y1 <= 0.0 && abs(y0 - y1) > 1e-8 && hits < 4) {
      float s = clamp(y0 / (y0 - y1), 0.0, 1.0);
      vec3 hitW = mix(cart0, cart1, s);
      float rHit = length(hitW.xz);
      // use untilted cylindrical radius for orbital physics
      float rPhys = length(hitW.xz);
      float phiHit = atan(hitW.z, hitW.x);
      // map to disk-local radius if tilted
      vec3 hitD = rotX * hitW;
      float rDisk = mix(rPhys, length(hitD.xz), 0.75);

      float rh = rPlus();
      if (rDisk > rh * 1.05) {
        // g-factor at the hit (use mid-step geodesic state)
        float rMid = mix(r, r1, s);
        float gFac = redshiftG(rMid, hitW, E, L, 0.0);
        col += diskEmission(rDisk, phiHit, gFac, uTime * dtScale);
        diskHit = true;
        hits++;
      }
    }
    prevY = y0;

    col += gridGlow(r, th, ph);

    // integrate
    r = r + 0.5 * (dr + dr1) * h;
    th = clamp(th + 0.5 * (dth + dth1) * h, 1e-3, PI - 1e-3);
    ph = ph + 0.5 * (dph + dph1) * h;
    sr = sr1;
    st = st1;
  }

  if (!captured && !escaped) {
    if (r < 10.0) captured = true;
    else escaped = true;
  }

  // Background
  if (captured) {
    // shadow: only keep true foreground disk light (higher-order images
    // that wind around land on non-captured geodesics or earlier hits)
    if (!diskHit) {
      col = vec3(0.0);
    }
  } else {
    col += starfield(normalize(vec3(
      sin(th) * cos(ph),
      cos(th),
      sin(th) * sin(ph)
    )));
  }

  // Optional soft atmospheric lift near the critical curve (very subtle —
  // the bright photon ring itself comes from lensed disk / star images).
  float cr = 2.6 + uSpin * 0.15;
  float soft = exp(-pow((minR - cr) / 0.8, 2.0)) * 0.02;
  col += vec3(0.5, 0.4, 0.28) * soft;

  vec2 q = vUv - 0.5;
  col *= 1.0 - 0.08 * dot(q, q);

  col = max(col, 0.0);
  col = col / (1.0 + col);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;
