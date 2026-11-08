/* giro-core.js — lógica sin DOM del simulador del casco. Se usa en el navegador (window.GiroCore) y en Node (pruebas).
   La máquina de estados Senalizador es la MISMA que la del cuaderno (Python) y la del firmware (C++). */
(function (root) {
  'use strict';
  const C = {
    FS: 50, WIN: 75, HOP: 10, N_CH: 6, CLASES: ['neutro', 'izquierda', 'derecha'],
    UMBRAL_CONF: 0.90, ON_N: 2, OFF_N: 3, MAX_SENAL_S: 10, ACC_MAX_G: 16, GYR_MAX_DPS: 2000, MAX_CSV_BYTES: 5 * 1024 * 1024
  };
  const CAN = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'];

  /* ---------- F1: validación de una ventana (n×6 en un Float32Array plano o arreglo de filas) ---------- */
  function validarVentana(x) {
    const n = C.WIN * C.N_CH;
    let flat = x;
    if (Array.isArray(x) && Array.isArray(x[0])) {
      if (x.length !== C.WIN || x.some(r => r.length !== C.N_CH)) return { ok: false, msg: `Forma incorrecta: se esperaban ${C.WIN}×${C.N_CH} valores.` };
      flat = Float32Array.from(x.flat());
    }
    if (!flat || flat.length !== n) return { ok: false, msg: `Forma incorrecta: se esperaban ${C.WIN}×${C.N_CH} valores (hay ${flat ? flat.length : 0}).` };
    let sum = new Float64Array(C.N_CH), sum2 = new Float64Array(C.N_CH);
    for (let i = 0; i < n; i++) {
      const v = flat[i], c = i % C.N_CH;
      if (!Number.isFinite(v)) return { ok: false, msg: 'La ventana contiene valores NaN o infinitos.' };
      if (c < 3 && Math.abs(v) > C.ACC_MAX_G) return { ok: false, msg: `Aceleración fuera de rango (> ${C.ACC_MAX_G} g).` };
      if (c >= 3 && Math.abs(v) > C.GYR_MAX_DPS) return { ok: false, msg: `Giro fuera de rango (> ${C.GYR_MAX_DPS} °/s).` };
      sum[c] += v; sum2[c] += v * v;
    }
    let constante = true;
    for (let c = 0; c < C.N_CH; c++) { const m = sum[c] / C.WIN, v = sum2[c] / C.WIN - m * m; if (Math.sqrt(Math.max(v, 0)) >= 1e-6) constante = false; }
    if (constante) return { ok: false, msg: 'Señal constante: el sensor parece desconectado.' };
    return { ok: true, msg: 'OK' };
  }

  /* ---------- F2: máquina de estados de las luces (idéntica a Python y C++) ---------- */
  class Senalizador {
    constructor(cfg) { this.cfg = Object.assign({}, C, cfg || {}); this.reset(); }
    reset() { this.estado = 0; this.pend = 0; this.nPend = 0; this.nOff = 0; this.tOn = 0; this.bloqueado = false; this.nRearme = 0; }
    paso(probs, dt) {
      const k = probs[1] > probs[0] ? (probs[2] > probs[1] ? 2 : 1) : (probs[2] > probs[0] ? 2 : 0);   // argmax
      const cand = (k !== 0 && probs[k] >= this.cfg.UMBRAL_CONF) ? k : 0;
      if (this.bloqueado) {
        this.nRearme = cand === 0 ? this.nRearme + 1 : 0;
        if (this.nRearme >= 5) { this.bloqueado = false; this.nRearme = 0; }
        return 0;
      }
      if (cand !== 0) {
        this.nOff = 0;
        if (cand !== this.estado) {
          if (cand === this.pend) this.nPend++; else { this.pend = cand; this.nPend = 1; }
          if (this.nPend >= this.cfg.ON_N) { this.estado = cand; this.tOn = 0; this.pend = 0; this.nPend = 0; }
        }
      } else {
        this.pend = 0; this.nPend = 0;
        if (this.estado !== 0) { this.nOff++; if (this.nOff >= this.cfg.OFF_N) { this.estado = 0; this.nOff = 0; } }
      }
      if (this.estado !== 0) {
        this.tOn += dt;
        if (this.tOn >= this.cfg.MAX_SENAL_S) { this.estado = 0; this.bloqueado = true; this.nRearme = 0; }
      }
      return this.estado;
    }
  }

  /* ---------- Buffer circular de muestras ---------- */
  class Buffer {
    constructor() { this.data = new Float32Array(C.WIN * C.N_CH); this.n = 0; this.sinceInfer = 0; }
    push(s) {
      this.data.copyWithin(0, C.N_CH); this.data.set(s, (C.WIN - 1) * C.N_CH);
      this.n = Math.min(this.n + 1, C.WIN); this.sinceInfer++;
    }
    get lleno() { return this.n >= C.WIN; }
    toca() { return this.lleno && this.sinceInfer >= C.HOP; }
    ventana() { this.sinceInfer = 0; return Float32Array.from(this.data); }
  }

  /* ---------- Simulador de sensor (mismas convenciones que el cuaderno) ---------- */
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const ss = x => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };
  const pulso = (t, t0, subida, meseta, bajada) => Math.min(ss((t - t0) / subida), 1 - ss((t - t0 - subida - meseta) / bajada));

  const GESTOS = {
    izquierda:   { etiqueta: 'Inclinar a la izquierda', dur: 2.9, comps: [{ c: 'roll', t0: 0.2, s: 0.4, m: 1.6, b: 0.45, a: -22 }] },
    derecha:     { etiqueta: 'Inclinar a la derecha', dur: 2.9, comps: [{ c: 'roll', t0: 0.2, s: 0.4, m: 1.6, b: 0.45, a: 22 }] },
    mirar_izq:   { etiqueta: 'Mirar sobre el hombro izq.', dur: 2.4, comps: [{ c: 'yaw', t0: 0.2, s: 0.4, m: 0.9, b: 0.45, a: 70 }, { c: 'roll', t0: 0.2, s: 0.4, m: 0.9, b: 0.45, a: -5 }] },
    mirar_der:   { etiqueta: 'Mirar sobre el hombro der.', dur: 2.4, comps: [{ c: 'yaw', t0: 0.2, s: 0.4, m: 0.9, b: 0.45, a: -70 }, { c: 'roll', t0: 0.2, s: 0.4, m: 0.9, b: 0.45, a: 5 }] },
    bache:       { etiqueta: 'Bache', dur: 2.2, comps: [], baches: [{ t0: 0.3, a: 1.8, f: 11 }, { t0: 1.0, a: 1.2, f: 9 }] },
    frenada:     { etiqueta: 'Frenada', dur: 2.6, comps: [{ c: 'ax', t0: 0.2, s: 0.3, m: 1.2, b: 0.5, a: -0.35 }, { c: 'pitch', t0: 0.2, s: 0.3, m: 1.2, b: 0.5, a: 6 }] },
    asentir:     { etiqueta: 'Mirar al suelo', dur: 2.0, comps: [{ c: 'pitch', t0: 0.2, s: 0.3, m: 0.3, b: 0.4, a: 22 }] },
    espejo:      { etiqueta: 'Inclinación breve (espejo)', dur: 2.0, comps: [{ c: 'roll', t0: 0.2, s: 0.3, m: 0.4, b: 0.4, a: 14 }] },
    leve:        { etiqueta: 'Inclinación leve (8°)', dur: 2.4, comps: [{ c: 'roll', t0: 0.2, s: 0.4, m: 1.0, b: 0.4, a: -8 }] }
  };

  class SensorSim {
    constructor(seed) {
      this.rnd = mulberry32(seed == null ? 7 : seed); this.t = 0; this.activos = [];
      this.rollManual = 0; this.rollObjetivo = 0; this.prev = null; this.postura = 12;
      this.fase = [this.rnd() * 6.28, this.rnd() * 6.28, this.rnd() * 6.28]; this.sesgoA = [0.01, -0.01, 0.015]; this.sesgoG = [0.5, -0.4, 0.3];
    }
    gauss() { let u = 0, v = 0; while (!u) u = this.rnd(); v = this.rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    reproducir(nombre) { const g = GESTOS[nombre]; if (g) this.activos.push({ g, t0: this.t }); }
    fijarRoll(deg) { this.rollObjetivo = deg; }
    ocupado() { return this.activos.length > 0; }
    _estado(t) {
      let roll = 2 * Math.sin(2 * Math.PI * 1.0 * t + this.fase[0]) + this.rollManual, pitch = this.postura + Math.sin(2 * Math.PI * 2 * t), yaw = 0, al = [0, 0, 0];
      for (const a of this.activos) {
        const tl = t - a.t0;
        for (const k of a.g.comps) {
          const v = k.a * pulso(tl, k.t0, k.s, k.m, k.b);
          if (k.c === 'roll') roll += v; else if (k.c === 'pitch') pitch += v; else if (k.c === 'yaw') yaw += v; else if (k.c === 'ax') al[0] += v;
        }
        for (const b of (a.g.baches || [])) {
          const u = tl - b.t0; if (u < 0 || u > 0.8) continue;
          const osc = Math.exp(-u / 0.12) * Math.sin(2 * Math.PI * b.f * u);
          al[2] += b.a * osc; al[0] += 0.3 * b.a * osc; al[1] -= 0.2 * b.a * osc; roll += 2.5 * osc; pitch += 2.0 * osc;
        }
      }
      return { roll, pitch, yaw, al };
    }
    siguiente() {
      const dt = 1 / C.FS;
      this.rollManual += (this.rollObjetivo - this.rollManual) * 0.12;
      const e = this._estado(this.t);
      const r = e.roll * Math.PI / 180, p = e.pitch * Math.PI / 180, y = e.yaw * Math.PI / 180;
      let dr = 0, dp = 0, dy = 0;
      if (this.prev) { dr = (r - this.prev[0]) / dt; dp = (p - this.prev[1]) / dt; dy = (y - this.prev[2]) / dt; }
      this.prev = [r, p, y];
      const vib = 0.05 * (Math.sin(2 * Math.PI * 9 * this.t + this.fase[1]) + 0.6 * Math.sin(2 * Math.PI * 17 * this.t + this.fase[2]));
      const acc = [-Math.sin(p) + e.al[0] + 0.6 * vib, Math.sin(r) * Math.cos(p) + e.al[1] + 0.6 * vib, Math.cos(r) * Math.cos(p) + e.al[2] + vib];
      const g = [dr - dy * Math.sin(p), dp * Math.cos(r) + dy * Math.sin(r) * Math.cos(p), -dp * Math.sin(r) + dy * Math.cos(r) * Math.cos(p)].map(v => v * 180 / Math.PI);
      for (let i = 0; i < 3; i++) { g[i] += 40 * vib + this.sesgoG[i] + 0.8 * this.gauss(); acc[i] += this.sesgoA[i] + 0.015 * this.gauss(); }
      this.t += dt;
      this.activos = this.activos.filter(a => this.t - a.t0 < a.g.dur);
      const clip = (v, m) => Math.max(-m, Math.min(m, v));
      return Float32Array.from([...acc.map(v => clip(v, 4)), ...g.map(v => clip(v, 500))]);
    }
  }

  /* ---------- Sensor del teléfono → ejes del casco ---------- */
  // Teléfono "de pie" (vertical), con la pantalla hacia atrás, pegado a la parte trasera de la cabeza:
  // adelante = -z_tel, izquierda = -x_tel, arriba = +y_tel.
  function telefonoACasco(a, g, ios) {
    const s = ios ? -1 : 1;                        // iOS informa la gravedad con el signo opuesto
    const ax = s * a[0] / 9.80665, ay = s * a[1] / 9.80665, az = s * a[2] / 9.80665;
    return [-az, -ax, ay, -g[2], -g[0], g[1]];    // g = [alpha(z), beta(x), gamma(y)] en °/s → (gx,gy,gz) del casco
  }
  // Rotación mínima que lleva la gravedad medida (reposo) a (0,0,1). Devuelve matriz 3×3 (fila mayor).
  function matrizNivel(gm) {
    const n = Math.hypot(gm[0], gm[1], gm[2]); if (n < 0.5) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const u = gm.map(v => v / n), ax = [u[1], -u[0], 0], s = Math.hypot(ax[0], ax[1]), c = u[2];
    if (s < 1e-6) return c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
    const k = ax.map(v => v / s), K = [0, -k[2], k[1], k[2], 0, -k[0], -k[1], k[0], 0], K2 = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let m = 0; m < 3; m++) K2[3 * i + j] += K[3 * i + m] * K[3 * m + j];
    const R = new Array(9); for (let i = 0; i < 9; i++) R[i] = (i % 4 === 0 ? 1 : 0) + s * K[i] + (1 - c) * K2[i];
    return R;
  }
  function aplicarMatriz(R, m) {
    const o = Float32Array.from(m);
    for (let blk = 0; blk < 2; blk++) { const b = blk * 3; for (let i = 0; i < 3; i++) o[b + i] = R[3 * i] * m[b] + R[3 * i + 1] * m[b + 1] + R[3 * i + 2] * m[b + 2]; }
    return o;
  }

  /* ---------- CSV (F1 para archivos) ---------- */
  function parseCsv(texto, bytes) {
    if (bytes != null && bytes > C.MAX_CSV_BYTES) return { ok: false, msg: 'El archivo supera el límite de 5 MiB.' };
    const lineas = texto.replace(/\r/g, '').split('\n').filter(l => l.trim().length);
    if (lineas.length < 2) return { ok: false, msg: 'El archivo está vacío o no tiene datos.' };
    const cab = lineas[0].split(',').map(s => s.trim().toLowerCase());
    const idx = CAN.map(c => cab.indexOf(c));
    if (idx.some(i => i < 0)) return { ok: false, msg: `Faltan columnas. Se necesitan: ${CAN.join(', ')}.` };
    const it = cab.indexOf('t_ms'), il = cab.indexOf('label');
    const filas = [], t = [], lab = [];
    for (let i = 1; i < lineas.length; i++) {
      const p = lineas[i].split(',');
      const v = idx.map(j => Number(p[j]));
      if (v.some(x => !Number.isFinite(x))) return { ok: false, msg: `Valor no numérico o NaN en la fila ${i + 1}.` };
      filas.push(v); if (it >= 0) t.push(Number(p[it]) / 1000); if (il >= 0) lab.push((p[il] || '').trim());
    }
    if (filas.length < C.WIN) return { ok: false, msg: `Muy corto: ${filas.length} filas; se necesitan al menos ${C.WIN}.` };
    let X = filas, aviso = '';
    if (it >= 0) {
      const dts = []; for (let i = 1; i < t.length; i++) dts.push(t[i] - t[i - 1]);
      dts.sort((a, b) => a - b); const med = dts[dts.length >> 1];
      if (!(med > 0)) return { ok: false, msg: 'La columna t_ms no es creciente.' };
      const hz = 1 / med;
      if (hz < 20 || hz > 200) return { ok: false, msg: `Frecuencia de muestreo fuera de rango (${hz.toFixed(0)} Hz; se aceptan 20–200 Hz).` };
      if (Math.abs(hz - C.FS) > 3) {
        const out = []; let k = 0;
        for (let tt = t[0]; tt <= t[t.length - 1]; tt += 1 / C.FS) { while (k < t.length - 2 && t[k + 1] < tt) k++; const f = (tt - t[k]) / (t[k + 1] - t[k] || 1); out.push(X[k].map((v, c) => v + (X[k + 1][c] - v) * Math.min(Math.max(f, 0), 1))); }
        X = out; aviso = `Remuestreado de ${hz.toFixed(0)} Hz a ${C.FS} Hz.`;
      }
    }
    return { ok: true, msg: aviso || 'OK', X, etiquetas: lab.length ? lab : null };
  }

  /* ---------- Bluetooth: paquete de 12 bytes (int16 LE): ax,ay,az en mg; gx,gy,gz en 0,1 °/s ---------- */
  const BLE = { SERVICIO: '19b10010-e8f2-537e-4f6c-d104768a1214', IMU: '19b10011-e8f2-537e-4f6c-d104768a1214', ESTADO: '19b10012-e8f2-537e-4f6c-d104768a1214', ALERTA: '19b10013-e8f2-537e-4f6c-d104768a1214' };
  function parsePaqueteImu(dv) {
    if (dv.byteLength < 12) return null;
    const g = i => dv.getInt16(2 * i, true);
    return Float32Array.from([g(0) / 1000, g(1) / 1000, g(2) / 1000, g(3) / 10, g(4) / 10, g(5) / 10]);
  }

  const api = { C, CAN, validarVentana, Senalizador, Buffer, SensorSim, GESTOS, telefonoACasco, matrizNivel, aplicarMatriz, parseCsv, BLE, parsePaqueteImu };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GiroCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
