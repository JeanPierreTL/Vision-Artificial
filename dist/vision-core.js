/* vision-core.js — lógica sin DOM de la visión trasera del casco. Navegador (window.VisionCore) y Node (pruebas).
   Entrada: detecciones de vehículos por cuadro {cls, score, bbox:[x,y,w,h] normalizado 0..1}.
   Salida: nivel de alerta 0..3. Idea física: si un objeto se acerca a velocidad constante, su tamaño aparente s
   crece como 1/Z y el tiempo hasta el contacto es  tau = s / (ds/dt).  Solo es válido si viene de frente. */
(function (root) {
  'use strict';
  const V = {
    CLASES: ['car', 'motorcycle', 'bus', 'truck'],             // etiquetas COCO que cuentan como vehículo
    NOMBRE: { car: 'Auto', motorcycle: 'Moto', bus: 'Bus', truck: 'Camión' },
    NIVELES: ['Sin vehículos detectados', 'Vehículo detrás', 'Vehículo acercándose', 'Vehículo muy cerca'],
    SCORE_MIN: 0.5, IOU_MIN: 0.2, MAX_AUSENTE_S: 0.6, CONFIRMA_N: 3,
    VENTANA_S: 1.2, MIN_MUESTRAS: 4, MIN_SPAN_S: 0.4,
    TAU_ACERCA_S: 6, TAU_CERCA_S: 2.5, TAU_MAX_S: 30, TAM_CERCA: 0.5, TAM_MIN_TAU: 0.03,
    ON_N: 2, OFF_N: 4, SIN_DATOS_S: 1.0                         // histéresis en cuadros; pérdida de cámara en segundos
  };

  /* ---------- validación (equivalente a F1: lo inválido se descarta antes de usarse) ---------- */
  function limpiarDeteccion(d) {
    if (!d || !V.CLASES.includes(d.cls)) return null;            // otras clases se ignoran sin contarlas como error
    const b = d.bbox;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || !Number.isFinite(d.score)) return 'invalida';
    if (d.score < V.SCORE_MIN || d.score > 1) return 'invalida';
    let [x, y, w, h] = b;
    if (w <= 0 || h <= 0 || w > 1.05 || h > 1.05 || x < -0.05 || y < -0.05 || x + w > 1.05 || y + h > 1.05) return 'invalida';
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
    return { cls: d.cls, score: d.score, bbox: [x, y, w, h] };
  }
  function iou(a, b) {
    const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    const i = ix * iy, u = a[2] * a[3] + b[2] * b[3] - i; return u > 0 ? i / u : 0;
  }
  const tamano = bb => Math.sqrt(bb[2] * bb[3]);                  // tamaño aparente

  /* Con velocidad constante, s ∝ 1/Z, así que u = 1/s es LINEAL en t. Se ajusta una recta a u (ajustar s subestima el
     crecimiento cerca del contacto y retrasa la alerta). invTau = −(du/dt)/u = 1/tau: >0 se acerca, <0 se aleja. */
  function ajuste(hist) {
    if (hist.length < V.MIN_MUESTRAS || hist[hist.length - 1].t - hist[0].t < V.MIN_SPAN_S) return null;
    const n = hist.length, tm = hist.reduce((a, p) => a + p.t, 0) / n, um = hist.reduce((a, p) => a + 1 / p.s, 0) / n;
    let sxy = 0, sxx = 0; for (const p of hist) { sxy += (p.t - tm) * (1 / p.s - um); sxx += (p.t - tm) ** 2; }
    if (sxx <= 0) return null;
    const pend = sxy / sxx, uFit = um + pend * (hist[n - 1].t - tm);
    if (!(uFit > 0)) return null;
    return { invTau: -pend / uFit, sFit: 1 / uFit };
  }

  class Rastreador {
    constructor(cfg) { this.c = Object.assign({}, V, cfg); this.reiniciar(); }
    reiniciar() { this.pistas = []; this.sig = 1; this.nivel = 0; this.cands = []; this.lastT = null; this.activo = false; this.rechazadas = 0; this.tau = null; }

    _evaluar(p) {
      const c = this.c; if (p.vistos < c.CONFIRMA_N) return { nivel: 0, tau: null, confirmada: false };
      const r = ajuste(p.hist), s = r ? r.sFit : p.s; let tau = null;
      if (r && r.invTau > 1 / c.TAU_MAX_S && s >= c.TAM_MIN_TAU) tau = 1 / r.invTau;
      let n; if (s >= c.TAM_CERCA || (tau !== null && tau < c.TAU_CERCA_S)) n = 3;
      else if (tau !== null && tau < c.TAU_ACERCA_S) n = 2;
      else if (r && r.invTau < -1 / c.TAU_MAX_S) n = 0;            // se aleja
      else n = 1;
      return { nivel: n, tau, confirmada: true };
    }

    paso(dets, t) {
      const c = this.c;
      if (!Number.isFinite(t) || (this.lastT !== null && t <= this.lastT)) return this.estado();   // tiempo inválido: se ignora el cuadro
      this.lastT = t; this.activo = true;
      const ok = [];
      for (const d of dets || []) { const l = limpiarDeteccion(d); if (l === 'invalida') this.rechazadas++; else if (l) ok.push(l); }
      const pares = [];
      this.pistas.forEach((p, i) => ok.forEach((d, j) => { const v = iou(p.bbox, d.bbox); if (v >= c.IOU_MIN) pares.push([v, i, j]); }));
      pares.sort((a, b) => b[0] - a[0]);
      const pu = new Set(), du = new Set();
      for (const [, i, j] of pares) {
        if (pu.has(i) || du.has(j)) continue; pu.add(i); du.add(j);
        const p = this.pistas[i], d = ok[j]; p.bbox = d.bbox; p.cls = d.cls; p.s = tamano(d.bbox); p.ultT = t; p.vistos++;
        p.hist.push({ t, s: p.s }); while (p.hist.length && t - p.hist[0].t > c.VENTANA_S) p.hist.shift();
      }
      ok.forEach((d, j) => { if (!du.has(j)) { const s = tamano(d.bbox); this.pistas.push({ id: this.sig++, cls: d.cls, bbox: d.bbox, s, ultT: t, vistos: 1, hist: [{ t, s }] }); } });
      this.pistas = this.pistas.filter(p => t - p.ultT <= c.MAX_AUSENTE_S);

      let cand = 0; this.tau = null;
      for (const p of this.pistas) {
        const e = this._evaluar(p); p.nivel = e.nivel; p.tau = e.tau; p.confirmada = e.confirmada;
        if (e.nivel > cand) cand = e.nivel;
        if (e.tau !== null && e.nivel >= 2 && (this.tau === null || e.tau < this.tau)) this.tau = e.tau;
      }
      this.cands.push(cand); if (this.cands.length > Math.max(c.ON_N, c.OFF_N)) this.cands.shift();
      const sube = this.cands.length >= c.ON_N ? Math.min(...this.cands.slice(-c.ON_N)) : 0;      // subir: ON_N cuadros seguidos
      const baja = this.cands.length >= c.OFF_N ? Math.max(...this.cands.slice(-c.OFF_N)) : this.nivel; // bajar: OFF_N cuadros seguidos
      if (sube > this.nivel) this.nivel = sube; else if (baja < this.nivel) this.nivel = baja;
      return this.estado();
    }

    /* Llamar periódicamente: si la cámara deja de entregar cuadros, el nivel pasa a 0 y activo=false.
       "Sin datos" nunca significa "vía libre": la interfaz debe decir que la visión no está disponible. */
    vigilar(t) {
      if (this.lastT !== null && t - this.lastT > this.c.SIN_DATOS_S) { const r = this.rechazadas; this.reiniciar(); this.rechazadas = r; }
      return this.estado();
    }
    estado() { return { nivel: this.nivel, tau: this.tau, activo: this.activo, rechazadas: this.rechazadas, pistas: this.pistas.map(p => ({ id: p.id, cls: p.cls, bbox: p.bbox, s: p.s, tau: p.tau === undefined ? null : p.tau, nivel: p.nivel || 0, confirmada: !!p.confirmada })) }; }
  }

  /* Direccional encendida y vehículo acercándose: lo más peligroso al girar. */
  const advertenciaGiro = (estadoLuz, nivel) => estadoLuz !== 0 && nivel >= 2;

  /* ---------- escenas simuladas (sin cámara): perfil de distancia Z(t) = Z0 − v·t, con ruido en la caja ---------- */
  const F = 0.9, ANCHO = { car: 1.8, motorcycle: 0.8, bus: 2.5, truck: 2.5 }, ALTO = { car: 0.8, motorcycle: 1.3, bus: 1.0, truck: 1.0 };
  const ESCENAS = {
    ninguno:       { etiqueta: 'Calle vacía' },
    acerca_lento:  { etiqueta: 'Auto se acerca despacio', cls: 'car', Z0: 40, v: 3 },
    acerca_rapido: { etiqueta: 'Auto se acerca rápido', cls: 'car', Z0: 50, v: 12 },
    moto_rapida:   { etiqueta: 'Moto se acerca rápido', cls: 'motorcycle', Z0: 45, v: 10 },
    parpadeo:      { etiqueta: 'Se acerca, con fallos del detector', cls: 'car', Z0: 45, v: 8, perdida: 0.3 },
    detenido:      { etiqueta: 'Auto a distancia constante', cls: 'car', Z0: 20, v: 0 },
    alejandose:    { etiqueta: 'Auto se aleja', cls: 'car', Z0: 15, v: -3 },
    falso_unico:   { etiqueta: 'Falso positivo de un cuadro', falso: true }
  };
  function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  class EscenaSim {
    constructor(nombre, seed = 1, fps = 10) { this.e = ESCENAS[nombre] || ESCENAS.ninguno; this.r = prng(seed); this.dt = 1 / fps; this.k = 0; }
    gauss() { return Math.sqrt(-2 * Math.log(1 - this.r())) * Math.cos(2 * Math.PI * this.r()); }
    distancia(t) { const e = this.e; return e.Z0 === undefined ? null : Math.max(2, e.Z0 - e.v * t); }
    siguiente() {
      const t = this.k++ * this.dt, e = this.e, dets = [];
      if (e.falso) { if (this.k === 11) dets.push({ cls: 'car', score: 0.62, bbox: [0.4, 0.45, 0.12, 0.1] }); }
      else if (e.cls && !(e.perdida && this.r() < e.perdida)) {
        const Z = this.distancia(t), w = Math.min(0.98, F * ANCHO[e.cls] / Z * (1 + 0.03 * this.gauss())), h = Math.min(0.9, w * ALTO[e.cls]);
        dets.push({ cls: e.cls, score: Math.min(0.99, 0.85 + 0.04 * this.gauss()), bbox: [Math.max(0, 0.5 - w / 2), Math.max(0, 0.6 - h), w, h] });
      }
      return { t, dets };
    }
  }

  const api = { V, Rastreador, EscenaSim, ESCENAS, advertenciaGiro, limpiarDeteccion, iou, ajuste };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VisionCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
