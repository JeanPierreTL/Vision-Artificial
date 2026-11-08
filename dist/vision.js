'use strict';
/* vision.js — sección «Visión trasera». Usa VisionCore (lógica) y, solo con la cámara, el detector COCO-SSD.
   La imagen de la cámara se procesa en el navegador y no se envía ni se guarda. */
(function () {
  const $ = id => document.getElementById(id), V = window.VisionCore, K = V.V;   // K = constantes del núcleo
  const CFG = Object.assign({
    cocoUrl: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',   // cámbialo a una copia local si prefieres no usar CDN
    fpsCam: 8, escenaSeg: 12
  }, window.GIRO_VISION);
  const COL = ['#7f93a6', '#7f93a6', '#ffb000', '#e0372d'], CHIP = ['', '', '', 'bad'];
  let modo = null, rast = new V.Rastreador(), escena = null, timer = null, vig = null, raf = 0, stream = null, detector = null;
  let sinPrev = false, t0 = 0, ocupado = false, ultFrame = 0, ultEnvio = { nivel: -1, t: 0 }, nivelMostrado = -1;
  const cv = $('v-canvas'), cx = cv.getContext('2d'), vid = $('v-video');

  function msg(t, err) { const m = $('v-msg'); m.textContent = t; m.classList.toggle('error', !!err); }
  Object.entries(V.ESCENAS).forEach(([k, e]) => { const o = document.createElement('option'); o.value = k; o.textContent = e.etiqueta; $('v-escena').append(o); });
  $('v-escena').value = 'acerca_rapido';

  /* ---------- salida: texto, chip y alerta al casco ---------- */
  function enviar(nivel, forzar) {
    const ch = window.giroAlertaChar; if (!$('v-ble').checked || !ch || !ch.service.device.gatt.connected) return;
    const ahora = performance.now(); if (!forzar && nivel === ultEnvio.nivel && ahora - ultEnvio.t < 500) return;   // cambio inmediato; si no, latido cada 0,5 s
    ultEnvio = { nivel, t: ahora };
    ch.writeValueWithoutResponse(Uint8Array.of(nivel)).catch(e => msg('No se pudo enviar la alerta al casco: ' + e.message, true));
  }
  function mostrar(est, sinDatos) {
    const n = est.nivel, luz = window.giroEstadoLuz || 0;
    if (n !== nivelMostrado || !!sinDatos !== sinPrev) {
      $('v-nivel').textContent = sinDatos ? 'Visión sin datos' : K.NIVELES[n];
      $('v-nivel').style.color = sinDatos ? '#ffd5cc' : n >= 2 ? COL[n] : '';
      $('v-chip').textContent = sinDatos ? 'Sin datos' : ['Vigilando', 'Vehículo detrás', 'Se acerca', 'Muy cerca'][n]; $('v-chip').className = 'chip ' + (sinDatos ? 'bad' : n === 2 ? '' : CHIP[n]);
      nivelMostrado = n; sinPrev = !!sinDatos;
    }
    $('v-tau').textContent = est.tau !== null && n >= 2 ? `Contacto estimado en ${est.tau.toFixed(1)} s` : '';
    $('v-sub').textContent = sinDatos ? 'La cámara no entrega imágenes. Esto NO significa que la vía esté libre.'
      : V.advertenciaGiro(luz, n) ? 'Atención: estás señalizando un giro y un vehículo se acerca por detrás.'
      : n === 0 ? 'Que no se detecte nada no significa que la vía esté libre.' : '';
    enviar(sinDatos ? 0 : n);
  }

  /* ---------- dibujo ---------- */
  function fondoDemo() {
    const W = cv.width, H = cv.height; cx.fillStyle = '#20262d'; cx.fillRect(0, 0, W, H);
    cx.fillStyle = '#2c343d'; cx.beginPath(); cx.moveTo(W * 0.46, H * 0.4); cx.lineTo(W * 0.54, H * 0.4); cx.lineTo(W, H); cx.lineTo(0, H); cx.fill();
    cx.strokeStyle = '#ffffff30'; cx.setLineDash([14, 14]); cx.lineWidth = 3; cx.beginPath(); cx.moveTo(W / 2, H * 0.4); cx.lineTo(W / 2, H); cx.stroke(); cx.setLineDash([]);
  }
  function dibujar(est) {
    const W = cv.width, H = cv.height;
    if (modo === 'cam' && vid.videoWidth) cx.drawImage(vid, 0, 0, W, H); else fondoDemo();
    for (const p of est.pistas) {
      const [x, y, w, h] = p.bbox, c = COL[p.nivel]; cx.strokeStyle = c; cx.lineWidth = 3; cx.setLineDash(p.confirmada ? [] : [6, 5]);
      cx.strokeRect(x * W, y * H, w * W, h * H); cx.setLineDash([]);
      const et = `${K.NOMBRE[p.cls] || p.cls}${p.tau !== null && p.nivel >= 2 ? ' · ' + p.tau.toFixed(1) + ' s' : ''}`; cx.font = '600 14px sans-serif';
      const tw = cx.measureText(et).width + 10, ty = Math.max(0, y * H - 20); cx.fillStyle = c; cx.fillRect(x * W, ty, tw, 20); cx.fillStyle = '#111'; cx.fillText(et, x * W + 5, ty + 15);
    }
  }

  /* ---------- control ---------- */
  function detener(silencio) {
    clearInterval(timer); clearInterval(vig); cancelAnimationFrame(raf); timer = vig = null; raf = 0;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } vid.srcObject = null;
    if (modo) enviar(0, true); const hubo = modo; modo = null; rast = new V.Rastreador(); nivelMostrado = -1; sinPrev = false; ultEnvio = { nivel: -1, t: 0 };
    $('v-stop').disabled = true; $('v-nivel').textContent = 'Visión detenida'; $('v-nivel').style.color = ''; $('v-chip').textContent = 'Detenida'; $('v-chip').className = 'chip';
    $('v-tau').textContent = ''; $('v-sub').textContent = ''; if (hubo) { fondoDemo(); if (!silencio) msg('Visión detenida.'); }
  }
  function iniciarDemo() {
    detener(true); modo = 'demo'; $('v-stop').disabled = false; msg('Escena simulada: no hay cámara ni detector real.');
    const nueva = () => { escena = new V.EscenaSim($('v-escena').value, (Math.random() * 1e6) | 0); rast = new V.Rastreador(); };
    nueva();
    timer = setInterval(() => {
      let f = escena.siguiente(); if (f.t > CFG.escenaSeg) { nueva(); f = escena.siguiente(); }   // la escena se repite para poder mirarla
      const est = rast.paso(f.dets, f.t); dibujar(est); mostrar(est);
    }, 100);
  }
  const cargarScript = url => new Promise((ok, no) => { const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = () => no(Error('No se pudo descargar el detector.')); document.head.append(s); });
  async function iniciarCam() {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Error('La cámara necesita HTTPS o localhost y un navegador compatible.');
      detener(true); modo = 'carga'; $('v-stop').disabled = false;
      if (!detector) {
        msg('Descargando el detector COCO-SSD (unos 13 MB, solo la primera vez)…');
        if (!window.cocoSsd) await cargarScript(CFG.cocoUrl);
        detector = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
      }
      if (modo !== 'carga') return;                                      // el usuario canceló mientras descargaba
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      vid.srcObject = stream; await vid.play(); modo = 'cam'; t0 = performance.now(); rast = new V.Rastreador();
      msg('Cámara activa. Apunta hacia atrás. La imagen no sale de este dispositivo.');
      vig = setInterval(() => { const e = rast.vigilar((performance.now() - t0) / 1000); if (!e.activo && modo === 'cam') mostrar(e, true); }, 250);
      const bucle = async () => {
        if (modo !== 'cam') return; const ahora = performance.now();
        if (!ocupado && ahora - ultFrame >= 1000 / CFG.fpsCam && vid.videoWidth) {
          ocupado = true; ultFrame = ahora;
          try {
            const W = vid.videoWidth, H = vid.videoHeight, pr = await detector.detect(vid, 10, 0.4);
            if (modo === 'cam') { const est = rast.paso(pr.map(p => ({ cls: p.class, score: p.score, bbox: [p.bbox[0] / W, p.bbox[1] / H, p.bbox[2] / W, p.bbox[3] / H] })), (performance.now() - t0) / 1000); dibujar(est); mostrar(est); }
          } catch (e) { msg('Error del detector: ' + e.message, true); } finally { ocupado = false; }
        }
        raf = requestAnimationFrame(bucle);
      };
      raf = requestAnimationFrame(bucle);
    } catch (e) { detener(true); msg(e.name === 'NotAllowedError' ? 'No se autorizó la cámara.' : e.message, true); }
  }
  $('v-demo').addEventListener('click', iniciarDemo);
  $('v-cam').addEventListener('click', iniciarCam);
  $('v-stop').addEventListener('click', () => detener(false));
  $('v-escena').addEventListener('change', () => { if (modo === 'demo') iniciarDemo(); });
  setInterval(() => { const ok = !!(window.giroAlertaChar && window.giroAlertaChar.service.device.gatt.connected); $('v-ble').disabled = !ok; if (!ok) $('v-ble').checked = false; }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && modo === 'cam') { detener(true); msg('La cámara se detuvo al salir de la pestaña.'); } });
  window.addEventListener('pagehide', () => detener(true));
  fondoDemo();
})();
