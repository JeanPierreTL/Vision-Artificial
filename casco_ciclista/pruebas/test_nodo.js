// Prueba en Node: modelo TF.js + lógica del simulador (sim-a-sim: valida el cableado, NO el comportamiento real).
const fs = require('fs'), path = require('path');
const tf = require('../dist/vendor/tf.min.js');
const G = require('../dist/giro-core.js');
(async () => {
  const dir = path.join(__dirname, '../dist/model');
  const mj = JSON.parse(fs.readFileSync(path.join(dir, 'model.json')));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json')));
  const bufs = mj.weightsManifest[0].paths.map(p => fs.readFileSync(path.join(dir, p)));
  const all = Buffer.concat(bufs);
  const model = await tf.loadGraphModel(tf.io.fromMemory({ modelTopology: mj.modelTopology, weightSpecs: mj.weightsManifest[0].weights, weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength), format: mj.format, generatedBy: mj.generatedBy, convertedBy: mj.convertedBy, signature: mj.signature }));
  const infer = async w => { const t = tf.tensor(w, [1, 75, 6]); const o = model.execute(t); const d = Array.from(await o.data()); t.dispose(); o.dispose(); return d; };
  const cfg = { UMBRAL_CONF: meta.confidenceThreshold, ON_N: meta.onConsecutive, OFF_N: meta.offConsecutive };
  // paridad con Keras (ventanas exportadas por el cuaderno, si existen)
  if (fs.existsSync(path.join(__dirname, 'paridad.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'paridad.json'))); let md = 0;
    for (let i = 0; i < p.W.length; i++) { const o = await infer(Float32Array.from(p.W[i].flat())); md = Math.max(md, ...o.map((v, k) => Math.abs(v - p.P[i][k]))); }
    console.log('Paridad TF.js vs Keras (' + p.W.length + ' ventanas): dif. máx = ' + md.toExponential(2));
  }
  async function correr(nombre, seed) {
    const sim = new G.SensorSim(seed), buf = new G.Buffer(), sen = new G.Senalizador(cfg), vistos = new Set();
    for (let i = 0; i < 6 * 50; i++) buf.push(sim.siguiente());          // 6 s de calentamiento
    sim.reproducir(nombre);
    for (let i = 0; i < 6 * 50; i++) {
      buf.push(sim.siguiente());
      if (buf.toca()) { const w = buf.ventana(); const v = G.validarVentana(w); if (!v.ok) throw new Error(v.msg); vistos.add(sen.paso(await infer(w), 0.2)); }
    }
    return [...vistos].sort().map(i => G.C.CLASES[i]);
  }
  const esperado = { izquierda: ['izquierda'], derecha: ['derecha'], mirar_izq: [], mirar_der: [], bache: [], frenada: [], asentir: [], leve: [], espejo: [] };
  let bien = 0, total = 0;
  for (const g of Object.keys(esperado)) for (const seed of [1, 2, 3]) {
    const r = await correr(g, seed), enc = r.filter(x => x !== 'neutro'); total++;
    const ok = JSON.stringify(enc) === JSON.stringify(esperado[g]); if (ok) bien++;
    console.log((ok ? 'OK    ' : 'FALLA ') + g.padEnd(10) + ' semilla ' + seed + ' → luces: ' + (enc.join(',') || 'ninguna'));
  }
  console.log(`Gestos del simulador con el resultado esperado: ${bien}/${total}`);
  // F1
  const bad = new Float32Array(450); bad[3] = NaN;
  console.log('F1 NaN →', G.validarVentana(bad).msg, '| forma →', G.validarVentana(new Float32Array(300)).msg, '| constante →', G.validarVentana(new Float32Array(450)).msg);
  const csv = 't_ms,ax,ay,az,gx,gy,gz\n' + Array.from({ length: 100 }, (_, i) => `${i * 20},0,0.1,1,0,0,0`).join('\n');
  console.log('CSV válido →', G.parseCsv(csv, csv.length).msg, '| sin columnas →', G.parseCsv('a,b\n1,2\n', 9).msg, '| >5MiB →', G.parseCsv(csv, 6e6).msg);
})();
