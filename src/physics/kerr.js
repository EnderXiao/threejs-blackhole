/**
 * Kerr metric helpers in Boyer–Lindquist coordinates (G = c = M = 1 unless noted).
 * Signatures match RESEARCH.md / standard GR (Carter, Chandrasekhar).
 */

export function makeKerr(a = 0.9, M = 1) {
  const spin = a * M; // a has units of M when dimensionless spin is given

  function Sigma(r, theta) {
    const c = Math.cos(theta);
    return r * r + spin * spin * c * c;
  }

  function Delta(r) {
    return r * r - 2 * M * r + spin * spin;
  }

  function A(r, theta) {
    const s = Math.sin(theta);
    const rr = r * r + spin * spin;
    return rr * rr - Delta(r) * spin * spin * s * s;
  }

  /** Outer event horizon */
  function rPlus() {
    return M + Math.sqrt(Math.max(0, M * M - spin * spin));
  }

  /** Equatorial prograde photon sphere (M=1 form generalizes as r = 2M(1+cos(...))) */
  function rPhotonPrograde() {
    const aa = spin / M;
    return 2 * M * (1 + Math.cos((2 / 3) * Math.acos(Math.max(-1, Math.min(1, -aa)))));
  }

  /** Equatorial prograde ISCO (Bardeen–Press–Teukolsky) */
  function rIscoPrograde() {
    const aa = spin / M;
    const Z1 = 1 + Math.cbrt(1 - aa * aa) * (Math.cbrt(1 + aa) + Math.cbrt(1 - aa));
    const Z2 = Math.sqrt(3 * aa * aa + Z1 * Z1);
    return 3 * M + Z2 - Math.sqrt(Math.max(0, (3 - Z1) * (3 + Z1 + 2 * Z2)));
  }

  /** Equatorial circular orbit angular velocity (exact Kerr) */
  function omegaK(r) {
    return 1 / (Math.pow(r / M, 1.5) * M + spin);
  }

  /** ZAMO frame-dragging angular velocity */
  function omegaFrameDrag(r, theta) {
    return (2 * M * spin * r) / A(r, theta);
  }

  /** Approximate redshift factor for equatorial Keplerian emitter seen by distant observer */
  function redshiftKepler(r) {
    // g ≈ sqrt(1 - 3/r + 2a/r^{1.5}) for M=1 circular orbits (Schw. limit 1-3/r)
    const rr = r / M;
    const v = 1 - 3 / rr + (2 * spin) / (M * Math.pow(rr, 1.5));
    return Math.sqrt(Math.max(0.05, v));
  }

  return {
    M,
    a: spin,
    Sigma,
    Delta,
    A,
    rPlus: rPlus(),
    rPhoton: rPhotonPrograde(),
    rIsco: rIscoPrograde(),
    omegaK,
    omegaFrameDrag,
    redshiftKepler,
  };
}

/**
 * Integrate a null geodesic in Kerr using Carter constants (CPU, for particles/debug).
 * State: r, theta, phi, and sign flags for dr, dtheta.
 * E is normalized to 1 (photon energy at infinity).
 */
export function stepNullGeodesic(state, a, M, dLambda) {
  const { r, theta, E, L, Q, sr, st } = state;
  const Sigma = r * r + a * a * Math.cos(theta) ** 2;
  const Delta = r * r - 2 * M * r + a * a;
  const P = E * (r * r + a * a) - a * L;
  const R = P * P - Delta * ((L - a * E) ** 2 + Q);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta) || 1e-6;
  const Theta = Q - L * L * (cosT * cosT) / (sinT * sinT) + a * a * E * E * cosT * cosT;

  const dR = (Math.max(0, R) / (Sigma || 1)) * 0.5 * (sr >= 0 ? 1 : -1);
  // first-order: Σ dr/dλ = ±√R  =>  dr/dλ = sr * sqrt(R)/Σ
  const dr = (sr * Math.sqrt(Math.max(0, R))) / (Sigma || 1);
  const dth = (st * Math.sqrt(Math.max(0, Theta))) / (Sigma || 1);
  const dphi = (-(a * E - L / (sinT * sinT)) + (a * P) / Delta) / (Sigma || 1);

  return {
    r: r + dr * dLambda,
    theta: Math.max(1e-4, Math.min(Math.PI - 1e-4, theta + dth * dLambda)),
    phi: state.phi + dphi * dLambda,
    E,
    L,
    Q,
    sr,
    st,
    hitHorizon: r + dr * dLambda <= (M + Math.sqrt(M * M - a * a)) * 1.02,
    escaped: r + dr * dLambda > 80,
    crossEquator: Math.sin(theta) * Math.sin(theta + dth * dLambda) < 0,
  };
}
