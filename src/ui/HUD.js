import { makeKerr } from '../physics/kerr.js';

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      r: document.getElementById('val-r'),
      rh: document.getElementById('val-rh'),
      th: document.getElementById('val-th'),
      om: document.getElementById('val-om'),
      a: document.getElementById('val-a'),
      cap: document.getElementById('val-cap'),
      lblA: document.getElementById('lbl-a'),
      lblI: document.getElementById('lbl-i'),
      lblSteps: document.getElementById('lbl-steps'),
      lblTime: document.getElementById('lbl-time'),
      inpA: document.getElementById('inp-a'),
      inpI: document.getElementById('inp-i'),
      inpSteps: document.getElementById('inp-steps'),
      inpTime: document.getElementById('inp-time'),
      inpGrid: document.getElementById('inp-grid'),
      inpTags: document.getElementById('inp-tags'),
      tags: document.getElementById('tags'),
      start: document.getElementById('start'),
      btnStart: document.getElementById('btn-start'),
    };

    this.onChange = {
      spin: () => {},
      incl: () => {},
      steps: () => {},
      timeScale: () => {},
      grid: () => {},
      tags: () => {},
    };

    this.el.inpA.addEventListener('input', () => {
      const v = parseFloat(this.el.inpA.value);
      this.el.lblA.textContent = v.toFixed(2);
      this.el.a.textContent = v.toFixed(2);
      this.onChange.spin(v);
    });
    this.el.inpI.addEventListener('input', () => {
      const v = parseFloat(this.el.inpI.value);
      this.el.lblI.textContent = `${v}°`;
      this.onChange.incl((v * Math.PI) / 180);
    });
    this.el.inpSteps.addEventListener('input', () => {
      const v = parseInt(this.el.inpSteps.value, 10);
      this.el.lblSteps.textContent = String(v);
      this.onChange.steps(v);
    });
    this.el.inpTime.addEventListener('input', () => {
      const v = parseFloat(this.el.inpTime.value);
      this.el.lblTime.textContent = v.toFixed(1);
      this.onChange.timeScale(v);
    });
    this.el.inpGrid.addEventListener('change', () => {
      this.onChange.grid(this.el.inpGrid.checked);
    });

    // --- tags: reliable show/hide both ways ---
    this._tagsOn = true;
    const applyTags = (on) => {
      this._tagsOn = !!on;
      const t = this.el.tags;
      if (t) {
        t.classList.toggle('off', !this._tagsOn);
        t.hidden = !this._tagsOn;
        t.style.display = this._tagsOn ? 'block' : 'none';
        t.style.visibility = this._tagsOn ? 'visible' : 'hidden';
        t.style.opacity = this._tagsOn ? '1' : '0';
        t.setAttribute('aria-hidden', this._tagsOn ? 'false' : 'true');
      }
      if (this.el.inpTags) this.el.inpTags.checked = this._tagsOn;
      this.onChange.tags(this._tagsOn);
    };

    this._applyTags = applyTags;

    this.el.inpTags?.addEventListener('change', () => {
      applyTags(this.el.inpTags.checked);
    });
    // label clicks: sync after the checkbox flips
    this.el.inpTags?.parentElement?.addEventListener('click', () => {
      requestAnimationFrame(() => applyTags(this.el.inpTags.checked));
    });

    // init
    applyTags(this.el.inpTags ? this.el.inpTags.checked : true);
  }

  /** Place annotation cards at projected screen points ({x,y,visible} per key). */
  placeTags(map) {
    if (!this.el.tags || !this._tagsOn) return;
    const nodes = this.el.tags.querySelectorAll('[data-anchor]');
    nodes.forEach((el) => {
      const key = el.getAttribute('data-anchor');
      const p = map[key];
      if (!p || !p.visible) {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    });
  }

  toggleTags(force) {
    const next = typeof force === 'boolean' ? force : !this._tagsOn;
    this._applyTags(next);
    return next;
  }

  toggle() {
    this.el.hud.classList.toggle('hidden');
  }

  hideStart() {
    this.el.start.classList.add('gone');
  }

  updateReadout(pos, spin) {
    const kerr = makeKerr(spin);
    const r = pos.length();
    const th = (Math.acos(pos.y / Math.max(r, 1e-5)) * 180) / Math.PI;
    const om = r > 0.2 ? kerr.omegaK(r) : 0;
    this.el.r.textContent = r.toFixed(2);
    this.el.rh.textContent = (r / kerr.rPlus).toFixed(2);
    this.el.th.textContent = `${th.toFixed(1)}°`;
    this.el.om.textContent = om.toExponential(2);
    this.el.a.textContent = spin.toFixed(2);
    this.el.cap.textContent = r < kerr.rPlus * 1.2 ? '视界' : r < kerr.rIsco ? '能层/ISCO内' : '稳定观测';
  }
}
