'use strict';
const $ = id => document.getElementById(id);
const G = window.GiroCore, C = G.C;
const NOMBRES = ['Neutro', 'Izquierda', 'Derecha'];
let model = null, meta = null, loading = false, busy = false, generacion = 0;
let fuente = 'demo', timer = null, sim = null, buf = new G.Buffer(), sen = new G.Senalizador();
let ultimoSample = null, estadoPrev = 0, tUltimo = 0, nLog = 0;
const traza = [];                       // últimas 300 muestras (6 s)
const TRAZA_N = 300;

/* ---------- utilidades de interfaz ---------- */
function mensaje(txt, error = false) { const m = $('message'); m.textContent = txt; m.classList.toggle('error', error); }
function chip(txt, cls) { const c = $('engine-state'); c.textContent = txt; c.className = 'chip ' + (cls || ''); }
function habilitar(ok) {
  for (const id of ['roll', 'tel-start', 'csv-file', 'ble-connect']) $(id).disabled = !ok;
  document.querySelectorAll('#gestures button').forEach(b => b.disabled = !ok);
}
const scoreRows = ['neutro', 'izquierda', 'derecha'].map((n, i) => {
  const d = document.createElement('div'); d.className = 'sc';
  d.innerHTML = `<span>${NOMBRES[i]}</span><span class="track"><span class="fill"></span></span><span class="val">—</span>`;
  $('scores').append(d); return d;
});
function mostrarScores(p) {
  const k = p.indexOf(Math.max(...p));
  p.forEach((v, i) => { scoreRows[i].classList.toggle('max', i === k); scoreRows[i].querySelector('.fill').style.width = (v * 100) + '%'; scoreRows[i].querySelector('.val').textContent = (v * 100).toFixed(1) + ' %'; });
}
function limpiarScores() { scoreRows.forEach(r => { r.classList.remove('max'); r.querySelector('.fill').style.width = '0%'; r.querySelector('.val').textContent = '—'; }); }
function luces(estado) {
  window.giroEstadoLuz = estado;                  // lo lee vision.js para avisar si hay un vehículo al girar
  const li = $('lamp-izq'), ld = $('lamp-der');
  li.classList.toggle('on', estado === 1); li.classList.toggle('parpadeo', estado === 1);
  ld.classList.toggle('on', estado === 2); ld.classList.toggle('parpadeo', estado === 2);
  $('state').textContent = estado === 1 ? 'Izquierda' : estado === 2 ? 'Derecha' : 'Sin señal';
  $('state-sub').textContent = estado ? 'La luz roja de posición sigue encendida.' : 'La luz roja de posición queda siempre encendida.';
  if (estado !== estadoPrev) {
    const li2 = document.createElement('li'), s = (tUltimo / C.FS).toFixed(1);
    li2.textContent = `${s} s: ${estado ? 'luz ' + NOMBRES[estado].toLowerCase() + ' encendida' : 'luces apagadas'}`;
    const ol = $('log'); ol.prepend(li2); while (ol.children.length > 60) ol.lastChild.remove();
    estadoPrev = estado;
  }
}

/* ---------- carga del modelo ---------- */
async function cargarModelo() {
  if (loading) return; loading = true; habilitar(false); $('retry').hidden = true; chip('Cargando modelo'); mensaje('Preparando el modelo…');
  try {
    if (!window.tf) throw Error('No se pudo cargar TensorFlow.js.');
    await tf.ready();
    const r = await fetch('model/metadata.json'); if (!r.ok) throw Error('No se encontró metadata.json.');
    meta = await r.json();
    if (JSON.stringify(meta.labels) !== JSON.stringify(['neutro', 'izquierda', 'derecha']) || meta.inputShape[0] !== C.WIN || meta.inputShape[1] !== C.N_CH) throw Error('El modelo no es compatible con esta página.');
    C.UMBRAL_CONF = meta.confidenceThreshold; C.ON_N = meta.onConsecutive; C.OFF_N = meta.offConsecutive; C.MAX_SENAL_S = meta.maxSignalSeconds;
    sen = new G.Senalizador();
    model = await tf.loadGraphModel('model/model.json');
    const z = tf.zeros([1, C.WIN, C.N_CH]); let o;
    try { o = model.execute(z); if (o.size !== 3) throw Error('El modelo debe devolver tres puntuaciones.'); await o.data(); } finally { z.dispose(); if (o) o.dispose(); }
    chip('Modelo listo', 'ok'); habilitar(true); $('roll').disabled = false;
    $('trained-on').textContent = meta.trainedOn.includes('SINT') ? 'datos simulados' : 'datos reales';
    $('model-info').textContent = `1D-CNN, ${meta.parameters.toLocaleString('es')} parámetros. Exactitud de prueba ${(meta.testAccuracy * 100).toFixed(1)} %. TensorFlow.js ${tf.version.tfjs}.`;
    mensaje('Todo listo. Mueve la inclinación o prueba un gesto.'); iniciarFuente('demo');
  } catch (e) {
    model = null; chip('Modelo no disponible', 'bad'); mensaje(`${e.message} Comprueba que la carpeta model esté disponible. Puedes usar el motor de umbrales mientras tanto.`, true); $('retry').hidden = false;
    habilitar(true); $('engine').value = 'umbral'; iniciarFuente('demo');
  } finally { loading = false; }
}

/* ---------- inferencia (F2) ---------- */
function umbralInclinacion(w, T = 14) {          // misma línea base del cuaderno: filtro complementario, ±T°, últimos 0,5 s
  let r = Math.atan2(w[1], w[2]) * 180 / Math.PI, suma = 0;
  for (let k = 0; k < C.WIN; k++) {
    const ra = Math.atan2(w[k * 6 + 1], w[k * 6 + 2]) * 180 / Math.PI;
    r = 0.98 * (r + w[k * 6 + 3] / C.FS) + 0.02 * ra; if (k >= C.WIN - 25) suma += r;
  }
  const m = suma / 25; return m <= -T ? [0, 1, 0] : m >= T ? [0, 0, 1] : [1, 0, 0];
}
async function inferir(w) {
  if ($('engine').value === 'umbral' || !model) return umbralInclinacion(w);
  const t = tf.tensor(w, [1, C.WIN, C.N_CH]); let o;
  try { o = model.execute(t); return Array.from(await o.data()); } finally { t.dispose(); if (o) o.dispose(); }
}
async function alimentar(s) {                     // una muestra de 6 canales (g y °/s)
  ultimoSample = s; tUltimo++;
  traza.push(s); if (traza.length > TRAZA_N) traza.shift();
  buf.push(s);
  if (!buf.toca() || busy) return;
  const w = buf.ventana(), v = G.validarVentana(w);              // F1: validar antes de invocar el modelo
  if (!v.ok) { mensaje('Entrada rechazada: ' + v.msg, true); return; }
  busy = true; const token = generacion;
  try {
    const t0 = performance.now(), p = await inferir(w); if (token !== generacion) return;
    $('timing').textContent = `Inferencia ${(performance.now() - t0).toFixed(1)} ms`;
    mostrarScores(p); luces(sen.paso(p, C.HOP / C.FS));
  } catch (e) { mensaje('No pudimos clasificar: ' + e.message, true); } finally { busy = false; }
}

/* ---------- fuentes ---------- */
function reiniciar() {
  generacion++; clearInterval(timer); timer = null; buf = new G.Buffer(); sen = new G.Senalizador();
  traza.length = 0; estadoPrev = 0; tUltimo = 0; luces(0); limpiarScores(); $('timing').textContent = '—'; $('rate').textContent = '';
}
function iniciarFuente(f) {
  detenerSensores(); reiniciar(); fuente = f;
  document.querySelectorAll('.tabs button').forEach(b => { const a = b.id === 'tab-' + (f === 'demo' ? 'demo' : f); b.setAttribute('aria-selected', a); b.tabIndex = a ? 0 : -1; });
  ['demo', 'tel', 'csv', 'ble'].forEach(k => $('p-' + k).hidden = k !== f);
  if (f === 'demo') {
    sim = new G.SensorSim(7); let ultimo = performance.now(), deuda = 0;
    timer = setInterval(() => { const ahora = performance.now(); deuda += (ahora - ultimo) / 1000 * C.FS; ultimo = ahora; let n = Math.min(Math.floor(deuda), 10); deuda -= n; while (n-- > 0) alimentar(sim.siguiente()); dibujar(); }, 20);
  } else { timer = setInterval(dibujar, 60); }
}
for (const f of ['demo', 'tel', 'csv', 'ble']) $('tab-' + f).addEventListener('click', () => { iniciarFuente(f); mensaje(f === 'demo' ? 'Demostración activa.' : f === 'tel' ? 'Pulsa «Activar sensor» y concede el permiso.' : f === 'csv' ? 'Elige un archivo CSV.' : 'Pulsa «Conectar casco».'); });
document.querySelector('.tabs').addEventListener('keydown', e => {
  const ids = ['demo', 'tel', 'csv', 'ble'], i = ids.indexOf(fuente);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = ids[(i + (e.key === 'ArrowRight' ? 1 : 3)) % 4]; $('tab-' + n).click(); $('tab-' + n).focus(); }
});

// Demostración
Object.entries(G.GESTOS).forEach(([k, g]) => {
  const b = document.createElement('button'); b.textContent = g.etiqueta; b.disabled = true;
  b.className = (k === 'izquierda' || k === 'derecha') ? 'senal' : 'no'; b.addEventListener('click', () => { if (fuente === 'demo') sim.reproducir(k); });
  $('gestures').append(b);
});
$('roll').addEventListener('input', e => { const v = Number(e.target.value); $('roll-out').textContent = `${v > 0 ? '+' : ''}${v}°`; if (sim) sim.fijarRoll(v); });
$('roll').addEventListener('change', () => { /* se queda donde lo dejes */ });
$('engine').addEventListener('change', () => { mensaje($('engine').value === 'cnn' ? 'Motor: 1D-CNN.' : 'Motor: umbral de inclinación (±14°).'); });

// Teléfono
let handlerMov = null, ultimoMov = null, nivel = null, muestreo = null, calibrando = null;
const esIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function detenerSensores() {
  if (handlerMov) { window.removeEventListener('devicemotion', handlerMov); handlerMov = null; }
  clearInterval(muestreo); muestreo = null; ultimoMov = null; calibrando = null;
  $('tel-cal').disabled = true; $('tel-start').textContent = 'Activar sensor';
  if (bleDev && bleDev.gatt.connected) bleDev.gatt.disconnect(); $('ble-disconnect').disabled = true; window.giroAlertaChar = null;
}
$('tel-start').addEventListener('click', async () => {
  if (muestreo) { iniciarFuente('tel'); return; }
  try {
    if (!window.isSecureContext) throw Error('Abre la página con HTTPS o en localhost para usar el sensor.');
    if (typeof DeviceMotionEvent === 'undefined') throw Error('Este navegador no ofrece sensores de movimiento.');
    if (typeof DeviceMotionEvent.requestPermission === 'function') { const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') throw Error('No se autorizó el sensor de movimiento.'); }
    nivel = null; let recibido = false;
    handlerMov = e => { const a = e.accelerationIncludingGravity, r = e.rotationRate; if (!a || !r || a.x == null) return; recibido = true; ultimoMov = G.telefonoACasco([a.x, a.y, a.z], [r.alpha || 0, r.beta || 0, r.gamma || 0], esIOS); };
    window.addEventListener('devicemotion', handlerMov);
    muestreo = setInterval(() => {
      if (!ultimoMov) return; let s = Float32Array.from(ultimoMov);
      if (calibrando) { calibrando.acc.push([s[0], s[1], s[2]]); if (calibrando.acc.length >= 75) { const m = [0, 1, 2].map(i => calibrando.acc.reduce((t, v) => t + v[i], 0) / 75); nivel = G.matrizNivel(m); calibrando = null; mensaje('Posición neutra calibrada. Inclina a la derecha: la luz derecha debe encenderse.'); } }
      if (nivel) s = G.aplicarMatriz(nivel, s);
      const roll = Math.atan2(s[1], s[2]) * 180 / Math.PI; $('rate').textContent = `Inclinación ${roll > 0 ? '+' : ''}${roll.toFixed(0)}°`;
      alimentar(s);
    }, 20);
    setTimeout(() => { if (!recibido) mensaje('No llegan datos del sensor. Comprueba permisos y que el dispositivo tenga acelerómetro y giroscopio.', true); }, 2000);
    $('tel-cal').disabled = false; $('tel-start').textContent = 'Sensor activo'; mensaje('Sensor activo. Calibra con la cabeza erguida.');
  } catch (e) { mensaje(e.message, true); }
});
$('tel-cal').addEventListener('click', () => { calibrando = { acc: [] }; mensaje('Calibrando: mantén la cabeza erguida y quieta durante 1,5 s…'); });

// CSV (F1 para archivos + reproducción)
$('csv-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  iniciarFuente('csv'); $('csv-summary').textContent = '';
  if (f.size > C.MAX_CSV_BYTES) { mensaje('El archivo supera el límite de 5 MiB.', true); return; }
  if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') { mensaje('Selecciona un archivo CSV.', true); return; }
  const r = G.parseCsv(await f.text(), f.size);
  if (!r.ok) { mensaje('Archivo rechazado: ' + r.msg, true); return; }
  if (!model && $('engine').value === 'cnn') { mensaje('El modelo no está cargado: se usará el motor de umbrales.', true); $('engine').value = 'umbral'; }
  mensaje(`Procesando ${r.X.length} muestras…`);
  const token = ++generacion, S = new G.Senalizador(), estados = [], reales = [], tiempos = [];
  const lab = r.etiquetas ? r.etiquetas.map(l => Math.max(0, ['neutro', 'izquierda', 'derecha'].indexOf(l.toLowerCase()))) : null;
  for (let e2 = C.WIN; e2 <= r.X.length; e2 += C.HOP) {
    const w = new Float32Array(C.WIN * 6); for (let k = 0; k < C.WIN; k++) w.set(r.X[e2 - C.WIN + k], k * 6);
    const v = G.validarVentana(w); if (!v.ok) { mensaje(`Rechazada la ventana que termina en la muestra ${e2}: ${v.msg}`, true); return; }
    estados.push(S.paso(await inferir(w), C.HOP / C.FS)); tiempos.push(e2); if (lab) reales.push(lab[e2 - 1]);
    if (token !== generacion) return; if (estados.length % 40 === 0) await new Promise(res => setTimeout(res, 0));
  }
  dibujarLinea(estados, lab ? reales : null, r.X.length);
  let enc = 0, prev = 0; estados.forEach(s => { if (s && !prev) enc++; prev = s; });
  let txt = `${(r.X.length / C.FS).toFixed(1)} s, ${enc} encendido${enc === 1 ? '' : 's'} de luz. ${r.msg !== 'OK' ? r.msg : ''}`;
  if (lab) { const ok = estados.filter((s, i) => s === reales[i]).length; txt += ` Coincidencia con las etiquetas: ${(100 * ok / estados.length).toFixed(1)} % de las lecturas (franja superior: etiqueta; inferior: luces).`; }
  $('csv-summary').textContent = txt; mensaje('Grabación procesada.');
});
function dibujarLinea(est, real, nMuestras) {
  const cv = $('timeline'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth; cv.width = W * dpr; cv.height = 76 * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, W, 76);
  const col = ['#d3dae0', '#c98600', '#1d7a6a'];
  const franja = (arr, y, h) => arr.forEach((s, i) => { x.fillStyle = col[s]; x.fillRect(i / arr.length * W, y, Math.ceil(W / arr.length) + 1, h); });
  if (real) franja(real, 4, 28); franja(est, real ? 40 : 20, 28);
  x.fillStyle = '#5b6872'; x.font = '11px sans-serif'; x.fillText('ámbar = izquierda, verde = derecha', 4, 74);
}

// Bluetooth
let bleDev = null;
$('ble-connect').addEventListener('click', async () => {
  if (!navigator.bluetooth) { mensaje('Este navegador no admite Web Bluetooth. Usa Chrome o Edge.', true); return; }
  try {
    iniciarFuente('ble'); const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [G.BLE.SERVICIO] }] }); bleDev = dev;
    dev.addEventListener('gattserverdisconnected', () => { window.giroAlertaChar = null; mensaje('El casco se desconectó.', true); $('ble-disconnect').disabled = true; });
    const srv = await dev.gatt.connect(), svc = await srv.getPrimaryService(G.BLE.SERVICIO);
    const imu = await svc.getCharacteristic(G.BLE.IMU); await imu.startNotifications();
    imu.addEventListener('characteristicvaluechanged', e => { const s = G.parsePaqueteImu(e.target.value); if (s) alimentar(s); });
    try { const st = await svc.getCharacteristic(G.BLE.ESTADO); await st.startNotifications(); st.addEventListener('characteristicvaluechanged', e => { $('ble-casco').textContent = 'El casco decidió: ' + (['neutro', 'luz izquierda', 'luz derecha'][e.target.value.getUint8(0)] || '—'); }); } catch { $('ble-casco').textContent = 'El casco no informa su propia decisión.'; }
    try { window.giroAlertaChar = await svc.getCharacteristic(G.BLE.ALERTA); } catch { window.giroAlertaChar = null; }   // opcional: firmware con visión
    $('ble-disconnect').disabled = false; mensaje('Casco conectado. Inclina la cabeza.');
  } catch (e) { mensaje(e.name === 'NotFoundError' ? 'No se eligió ningún dispositivo.' : e.message, true); }
});
$('ble-disconnect').addEventListener('click', () => { if (bleDev && bleDev.gatt.connected) bleDev.gatt.disconnect(); });

/* ---------- gráfica ---------- */
function dibujar() {
  const cv = $('trace'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = 230;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = H * dpr; }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const mitad = H / 2 - 6, pad = 34;
  const graf = (y0, canales, rango, colores, etq, unidad) => {
    x.strokeStyle = '#d3dae0'; x.lineWidth = 1; x.beginPath(); x.moveTo(pad, y0 + mitad / 2); x.lineTo(W, y0 + mitad / 2); x.stroke();
    x.fillStyle = '#5b6872'; x.font = '11px sans-serif'; x.fillText(`+${rango}`, 2, y0 + 10); x.fillText(`−${rango}`, 2, y0 + mitad); x.fillText(etq + ' ' + unidad, pad + 4, y0 + 10);
    canales.forEach((c, k) => {
      x.strokeStyle = colores[k]; x.lineWidth = 1.4; x.beginPath();
      traza.forEach((s, i) => { const px = pad + (i + TRAZA_N - traza.length) / (TRAZA_N - 1) * (W - pad), py = y0 + mitad / 2 - Math.max(-rango, Math.min(rango, s[c])) / rango * (mitad / 2); i ? x.lineTo(px, py) : x.moveTo(px, py); });
      x.stroke();
    });
  };
  x.fillStyle = 'rgba(201,134,0,.13)'; x.fillRect(pad + (TRAZA_N - C.WIN) / (TRAZA_N - 1) * (W - pad), 0, C.WIN / (TRAZA_N - 1) * (W - pad), H);
  graf(0, [0, 1, 2], 2, ['#b8c4cd', '#c98600', '#7f93a6'], 'ax, ay (ámbar), az', '(g)');
  graf(H / 2 + 4, [3, 4, 5], 200, ['#7f93a6', '#b8c4cd', '#1d7a6a'], 'gx, gy, gz (verde)', '(°/s)');
}
window.addEventListener('resize', dibujar);
document.addEventListener('visibilitychange', () => { if (document.hidden && fuente === 'tel' && muestreo) { detenerSensores(); iniciarFuente('demo'); mensaje('El sensor se detuvo al salir de la pestaña.'); } });
window.addEventListener('pagehide', detenerSensores);
$('retry').addEventListener('click', cargarModelo);
luces(0); limpiarScores(); cargarModelo();
