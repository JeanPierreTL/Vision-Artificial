// Pruebas del núcleo de visión (escenas simuladas). Como test_nodo.js: valida la lógica, NO el detector ni el mundo real.
// Uso: node pruebas/test_vision.js
const { Rastreador, EscenaSim, ESCENAS, advertenciaGiro } = require('../dist/vision-core.js');
let fallos = 0;
const chk = (ok, txt) => { console.log((ok ? 'OK    ' : 'FALLA ') + txt); if (!ok) fallos++; };

function correr(nombre, seed, seg) {
  const sc = new EscenaSim(nombre, seed), r = new Rastreador(), out = [], e = ESCENAS[nombre];
  for (let i = 0; i < seg * 10; i++) {
    const { t, dets } = sc.siguiente(), s = r.paso(dets, t);
    const Z = sc.distancia(t); out.push({ t, nivel: s.nivel, tau: s.tau, tauReal: Z !== null && e.v > 0 ? Z / e.v : null, Z });
  }
  return out;
}
const primero = (o, n) => o.find(x => x.nivel >= n);

// 1. Validación de entradas
{
  const r = new Rastreador();
  const malas = [{ cls: 'car', score: 0.9, bbox: [NaN, 0, 0.1, 0.1] }, { cls: 'car', score: 0.2, bbox: [0.4, 0.4, 0.1, 0.1] }, { cls: 'car', score: 0.9, bbox: [0.4, 0.4, -1, 0.1] }, { cls: 'car', score: 0.9, bbox: [2, 2, 0.1, 0.1] }];
  const s = r.paso([...malas, { cls: 'person', score: 0.99, bbox: [0.4, 0.4, 0.2, 0.2] }], 0);
  chk(s.rechazadas === 4 && s.pistas.length === 0, `detecciones inválidas rechazadas (4) y «persona» ignorada → rechazadas=${s.rechazadas}, pistas=${s.pistas.length}`);
  chk(r.paso([], 0).nivel === 0 && r.paso([], NaN).nivel === 0, 'tiempo repetido o NaN no rompe el estado');
}

// 2. Sin vehículos y falso positivo de un cuadro: nunca alerta
chk(correr('ninguno', 1, 10).every(x => x.nivel === 0), 'calle vacía → nivel 0 siempre');
chk([1, 2, 3, 4, 5].every(sd => correr('falso_unico', sd, 5).every(x => x.nivel === 0)), 'falso positivo de un cuadro → nunca sube de 0 (5 semillas)');

// 3. Acercamiento rápido: alerta con anticipación
{
  const o = correr('acerca_rapido', 1, 4), n2 = primero(o, 2), n3 = primero(o, 3);
  chk(n2 && n3, 'auto rápido: alcanza nivel 2 y nivel 3');
  if (n2 && n3) {
    console.log(`      nivel 2 con tau real ${n2.tauReal.toFixed(1)} s (Z=${n2.Z.toFixed(0)} m); nivel 3 con tau real ${n3.tauReal.toFixed(1)} s (Z=${n3.Z.toFixed(0)} m)`);
    chk(n2.t < n3.t && n3.tauReal >= 1.0, 'el nivel 3 llega antes de 1 s del contacto y después del nivel 2');
    chk(n2.tauReal <= 8, 'el nivel 2 no se dispara cuando aún faltan más de 8 s');
  }
  const cerca = o.filter(x => x.tau !== null && x.tauReal !== null && x.tauReal < 5 && x.tauReal > 1);
  const errs = cerca.map(x => Math.abs(x.tau - x.tauReal) / x.tauReal).sort((a, b) => a - b);
  const med = errs[Math.floor(errs.length / 2)];
  chk(errs.length >= 5 && med < 0.3, `error relativo mediano de tau (tau real 1–5 s): ${(med * 100).toFixed(0)} % sobre ${errs.length} cuadros (límite 30 %)`);
}

// 4. Acercamiento lento, moto, detector con fallos
{
  const o = correr('acerca_lento', 1, 10);
  chk(o.filter(x => x.t < 5).every(x => x.nivel <= 1) && o[o.length - 1].nivel >= 2, 'auto lento: nivel ≤1 mientras está lejos y llega a ≥2 al final');
  const m = primero(correr('moto_rapida', 1, 5), 3); chk(!!m, 'moto rápida: alcanza nivel 3');
  chk([1, 2, 3, 4, 5].every(sd => !!primero(correr('parpadeo', sd, 6), 3)), 'con 30 % de cuadros perdidos sigue alcanzando nivel 3 (5 semillas)');
}

// 5. Falsas alarmas: vehículos que no se acercan
{
  let falsas = 0, total = 0;
  for (const nom of ['detenido', 'alejandose']) for (let sd = 1; sd <= 50; sd++) for (const x of correr(nom, sd, 10)) { total++; if (x.nivel >= 2) falsas++; }
  chk(falsas === 0, `convoy y vehículo que se aleja: ${falsas} cuadros con nivel ≥2 de ${total} (100 corridas)`);
  const det = correr('detenido', 3, 10), al = correr('alejandose', 3, 10);
  chk(det[det.length - 1].nivel === 1, 'auto a distancia constante → nivel 1 (informativo)');
  chk(al.slice(-10).every(x => x.nivel === 0), 'auto que se aleja → nivel 0');
}

// 6. Detección sobre muchas semillas (tasa)
{
  const n = 50; let ok = 0; for (let sd = 1; sd <= n; sd++) { const o = correr('acerca_rapido', 100 + sd, 4), x = primero(o, 3); if (x && x.tauReal >= 1.0) ok++; }
  chk(ok === n, `auto rápido: nivel 3 con ≥1 s de anticipación en ${ok}/${n} semillas`);
}

// 7. Cámara que deja de entregar cuadros → nivel 0 y activo=false
{
  const r = new Rastreador(), sc = new EscenaSim('acerca_rapido', 1); let s;
  for (let i = 0; i < 25; i++) { const f = sc.siguiente(); s = r.paso(f.dets, f.t); }
  chk(s.nivel >= 2 && s.activo, 'antes del corte: alerta activa');
  s = r.vigilar(2.5 + 0.5); chk(s.nivel >= 2, 'pausa corta (0,5 s): se mantiene');
  s = r.vigilar(2.5 + 1.5); chk(s.nivel === 0 && !s.activo, 'pausa de 1,5 s: nivel 0 y activo=false (la interfaz debe avisar «visión no disponible»)');
}

// 8. Interacción con las direccionales
chk(advertenciaGiro(1, 2) && advertenciaGiro(2, 3) && !advertenciaGiro(0, 3) && !advertenciaGiro(1, 1), 'advertencia de giro: solo con direccional encendida y nivel ≥2');

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(fallos ? 1 : 0);
