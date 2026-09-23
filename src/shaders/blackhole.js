export const blackholeVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Kerr null-geodesic raytracer — Hamiltonian RK4 (theyashl / CuplexUser style).
 *   H = 1/2 g^{uv} p_u p_v,  state=(r,θ,p_r,p_θ), conserved E, Lz
 * Disk: Novikov–Thorne T ∝ (r_in/r)^{3/4} + fbm turbulence, volumetric puff.
 * Geodesics integrated with spin -a (time-reversed rays, CuplexUser).
 * Post: ACES + soft bloom.
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

float rPlus(float a) { return 1.0 + sqrt(max(0.0, 1.0 - a * a)); }

float rIsco(float a) {
  a = clamp(a, 0.0, 0.998);
  float z1 = 1.0 + pow(max(1.0 - a * a, 0.0), 1.0 / 3.0) *
                 (pow(1.0 + a, 1.0 / 3.0) + pow(1.0 - a, 1.0 / 3.0));
  float z2 = sqrt(3.0 * a * a + z1 * z1);
  return 3.0 + z2 - sqrt(max(0.0, (3.0 - z1) * (3.0 + z1 + 2.0 * z2)));
}

float sigmaF(float r, float th, float a) {
  float c = cos(th);
  return r * r + a * a * c * c;
}
float deltaF(float r, float a) { return r * r - 2.0 * r + a * a; }
float bigAF(float r, float th, float a) {
  float s = sin(th);
  float r2a2 = r * r + a * a;
  return r2a2 * r2a2 - a * a * deltaF(r, a) * s * s;
}

// H = 1/2 g^{uv} p_u p_v ; st = (r, th, pr, pth); pt=-E, pphi=Lz
float hamiltonian(vec4 st, float E, float Lz, float a) {
  float r = st.x, th = st.y, pr = st.z, pth = st.w;
  float S = sigmaF(r, th, a), D = max(deltaF(r, a), 1e-4), A = max(bigAF(r, th, a), 1e-4);
  float s = max(abs(sin(th)), 1e-3), s2 = s * s;
  float gtt = -A / (S * D);
  float gtp = -2.0 * a * r / (S * D);
  float grr = D / S;
  float gthth = 1.0 / S;
  float gpp = (D - a * a * s2) / (S * D * s2);
  return 0.5 * (gtt * E * E - 2.0 * gtp * E * Lz + gpp * Lz * Lz + grr * pr * pr + gthth * pth * pth);
}

vec4 rhs(vec4 st, float E, float Lz, float a, out float dphi) {
  float r = st.x, th = st.y, pr = st.z, pth = st.w;
  float S = sigmaF(r, th, a), D = max(deltaF(r, a), 1e-4);
  float s = max(abs(sin(th)), 1e-3), s2 = s * s;
  float grr = D / S, gthth = 1.0 / S;
  float gtp = -2.0 * a * r / (S * D);
  float gpp = (D - a * a * s2) / (S * D * s2);
  float dr = grr * pr;
  float dth = gthth * pth;
  dphi = gtp * (-E) + gpp * Lz;
  float h = 1e-3;
  float dHdr = (hamiltonian(vec4(r + h, th, pr, pth), E, Lz, a)
              - hamiltonian(vec4(r - h, th, pr, pth), E, Lz, a)) / (2.0 * h);
  float dHdth = (hamiltonian(vec4(r, th + h, pr, pth), E, Lz, a)
               - hamiltonian(vec4(r, th - h, pr, pth), E, Lz, a)) / (2.0 * h);
  return vec4(dr, dth, -dHdr, -dHdth);
}

// Novikov–Thorne + fbm
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
  vec3 c0 = vec3(0.35, 0.05, 0.02);
  vec3 c1 = vec3(0.9, 0.2, 0.05);
  vec3 c2 = vec3(1.0, 0.65, 0.25);
  vec3 c3 = vec3(1.0, 0.95, 0.85);
  if (t < 0.35) return mix(c0, c1, t / 0.35);
  if (t < 0.7) return mix(c1, c2, (t - 0.35) / 0.35);
  return mix(c2, c3, (t - 0.7) / 0.3);
}

// Doppler × gravitational g for Kerr circular orbit at radius r (spin +a for disk)
float gDisk(float r, vec3 hit, vec3 camPos, float aD) {
  float om = 1.0 / (pow(max(r, 0.6), 1.5) + aD);
  vec3 v = vec3(-om * hit.z, 0.0, om * hit.x);
  float speed = clamp(length(v), 0.0, 0.9);
  v = normalize(v + vec3(1e-4, 0.0, 0.0));
  vec3 toObs = normalize(camPos - hit);
  float cosA = dot(v, toObs);
  float gamma = 1.0 / sqrt(max(1.0 - speed * speed, 1e-3));
  float dop = 1.0 / max(gamma * (1.0 - speed * cosA), 0.12);
  float grav = sqrt(max(0.05, 1.0 - 3.0 / r + 2.0 * aD / pow(r, 1.5)));
  return clamp(dop * grav, 0.2, 2.8);
}

vec3 diskShade(float r, float phi, vec3 hit, vec3 camPos, float aD) {
  float rIn = rIsco(aD);
  float rOut = 14.0;
  if (r < rIn - 0.05 || r > rOut) return vec3(0.0);

  float g = gDisk(r, hit, camPos, aD);
  // Novikov–Thorne T ∝ (r_in/r)^{3/4}
  float temp = pow(max(rIn / r, 0.05), 0.75);
  float t = clamp((r - rIn) / (rOut - rIn), 0.0, 1.0);
  float radial = smoothstep(rIn, rIn + 0.08, r) * exp(-t * 3.0);
  radial *= 1.0 - smoothstep(rOut - 2.0, rOut, r);

  // fbm turbulence + Keplerian shear
  float om = 1.0 / (pow(max(r, 0.6), 1.5) + aD);
  vec2 uv = vec2(phi * 1.2 - uTime * uTimeScale * om * 6.0, log(max(r, 1.0)) * 2.5);
  float turb = 0.55 + 0.55 * fbm(uv * 1.8);

  float beam = pow(clamp(g, 0.3, 2.5), 2.5);
  float inten = turb * radial * beam * (0.4 + 0.9 * temp);
  inten += exp(-abs(r - rIn) * 4.0) * 1.2 * beam;

  vec3 col = blackbody(clamp(temp * mix(0.8, 1.15, clamp(g, 0.0, 1.4)), 0.0, 1.0));
  col *= mix(vec3(1.1, 0.35, 0.2), vec3(1.05, 1.0, 0.92), smoothstep(0.75, 1.35, g));
  return col * inten * 6.0;
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

// ACES approx
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;
  float tanF = tan(uFov * 0.5);
  vec3 dirW = normalize(uCamBasis[2] + uCamBasis[0] * (uv.x * tanF) + uCamBasis[1] * (uv.y * tanF));

  // Cartesian → BL
  vec3 p = uCamPos;
  float r0 = max(length(p), 2.0);
  float th0 = acos(clamp(p.y / r0, -1.0, 1.0));
  float ph0 = atan(p.z, p.x);

  // local orthonormal triad (approx spherical)
  vec3 er = normalize(p + 1e-6);
  vec3 upRef = abs(er.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 eph = normalize(cross(upRef, er));
  vec3 eth = normalize(cross(er, eph));
  vec3 n = normalize(vec3(dot(dirW, er), dot(dirW, eth), dot(dirW, eph)));

  // geodesics use -a (time-reversed rays, CuplexUser); disk uses +a
  float aG = -clamp(uSpin, -0.998, 0.998);
  float aD = clamp(uSpin, 0.0, 0.998);

  // initial (r,th,pr,pth), E=1, Lz from local angular momentum
  float S0 = sigmaF(r0, th0, aG);
  float D0 = max(deltaF(r0, aG), 1e-3);
  float pr0 = n.x * sqrt(S0 / D0) * D0; // rough: p_r = g_rr dr/dλ
  float pth0 = n.y * S0 / max(r0, 1.0);
  float s0 = max(abs(sin(th0)), 1e-3);
  float Lz = n.z * r0 * s0 + aG * 0.3;
  float E = 1.0;

  vec4 st = vec4(r0, th0, pr0, pth0);
  float ph = ph0;

  vec3 col = vec3(0.0);
  vec3 frontDisk = vec3(0.0);
  float vol = 0.0;
  vec3 volCol = vec3(0.0);
  bool captured = false;
  bool escaped = false;
  int hits = 0;
  int steps = int(clamp(uSteps, 32.0, 128.0));
  float rh = rPlus(aG);

  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    float r = st.x;
    float th = clamp(st.y, 1e-3, PI - 1e-3);
    if (r < rh * 1.02) { captured = true; break; }
    if (r > 65.0 && i > 3) { escaped = true; break; }

    float dl = clamp(r * 0.045, 0.015, 0.9);

    vec3 cart = vec3(r * sin(th) * cos(ph), r * cos(th), r * sin(th) * sin(ph));

    // volumetric thick disk sample (puff around equator)
    float cylR = length(cart.xz);
    float rInV = rIsco(aD) * 0.95;
    if (cylR > rInV && cylR < 13.0 && abs(cart.y) < 3.0) {
      float H = 0.14 * cylR + 0.3;
      float dens = exp(-pow(cart.y / H, 2.0)) *
                   exp(-pow((cylR - rInV) / 11.0, 1.4) * 2.2);
      vec3 hitEq = vec3(cart.x, 0.0, cart.z);
      float g = gDisk(cylR, hitEq, uCamPos, aD);
      vec3 c = diskShade(cylR, atan(cart.z, cart.x), hitEq, uCamPos, aD);
      volCol += c * dens * dl * 2.2;
    }

    // thin-disk equator crossing
    float y0 = cart.y;
    // predict next y from RHS
    float dphi;
    vec4 k = rhs(st, E, Lz, aG, dphi);
    vec4 st1 = st + k * dl;
    float r1 = max(st1.x, 0.2);
    float th1 = clamp(st1.y, 1e-3, PI - 1e-3);
    float ph1 = ph + dphi * dl;
    vec3 cart1 = vec3(r1 * sin(th1) * cos(ph1), r1 * cos(th1), r1 * sin(th1) * sin(ph1));
    if (i > 0 && y0 * cart1.y < 0.0 && hits < 3) {
      float s = clamp(y0 / (y0 - cart1.y + 1e-8), 0.0, 1.0);
      vec3 hitW = mix(cart, cart1, s);
      float rhit = length(hitW.xz);
      if (rhit > rh * 1.05) {
        vec3 em = diskShade(rhit, atan(hitW.z, hitW.x), vec3(hitW.x, 0.0, hitW.z), uCamPos, aD);
        col += em;
        if (hits == 0) frontDisk = em;
        hits++;
      }
    }

    // RK4
    float dphi1;
    vec4 k1 = rhs(st, E, Lz, aG, dphi1);
    vec4 s2v = st + 0.5 * dl * k1;
    float dphi2;
    vec4 k2 = rhs(s2v, E, Lz, aG, dphi2);
    vec4 s3v = st + 0.5 * dl * k2;
    float dphi3;
    vec4 k3 = rhs(s3v, E, Lz, aG, dphi3);
    vec4 s4v = st + dl * k3;
    float dphi4;
    vec4 k4 = rhs(s4v, E, Lz, aG, dphi4);
    st += (dl / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    ph += (dl / 6.0) * (dphi1 + 2.0 * dphi2 + 2.0 * dphi3 + dphi4);
    st.x = max(st.x, 0.15);
    st.y = clamp(st.y, 1e-3, PI - 1e-3);
    if (!(st.x == st.x) || !(st.y == st.y) || abs(st.x) > 1e8) break;
  }

  if (!captured && !escaped) {
    if (st.x < 12.0) captured = true;
    else escaped = true;
  }

  // critical curve (soft, for ring)
  vec3 bvec = cross(uCamPos, dirW);
  float bImp = length(bvec);
  float R0 = 3.0 * sqrt(3.0);
  float ring = exp(-pow((bImp - R0 * (1.0 - 0.02 * uSpin * uSpin)) / 0.5, 2.0));

  if (captured) {
    col = frontDisk * 0.9 + volCol * 0.5;
  } else {
    vec3 sky = starfield(normalize(vec3(sin(st.y) * cos(ph), cos(st.y), sin(st.y) * sin(ph))));
    col += sky * 0.8 + volCol;
    col += vec3(1.0, 0.93, 0.75) * ring * 1.8;
  }
  // soft bloom hint
  col += vec3(0.55, 0.4, 0.25) * exp(-pow((bImp - R0) / 1.2, 2.0)) * 0.08;

  col = max(col, 0.0);
  col = aces(col * 1.1);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;
