// Анимации KayKit (Rig_Medium, ~140 клипов) → models/lib/anims/kaykit.glb (только кости + клипы, без мешей).
//   cp viewer/tools/build_anims.mjs /tmp/gt/ && LIB_OUT=$PWD/viewer/models/lib node /tmp/gt/build_anims.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, quantize, meshopt, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'fs'; import path from 'path';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const SRC = (process.env.CC0_CACHE || '/tmp/cc0') + '/kaylousberg/kaykit-character-animations';
const OUT = path.join(process.env.LIB_OUT, 'anims');
fs.mkdirSync(OUT, { recursive: true });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(SRC).filter((f) => /Rig_Medium_.*\.glb$/.test(f)).sort();
const out = new (await import('@gltf-transform/core')).Document();
const seen = new Set();
for (const f of files) {
  const d = await io.read(f);
  const r = d.getRoot();
  for (const m of r.listMeshes()) m.dispose();
  for (const s of r.listSkins()) s.dispose();
  for (const a of r.listAnimations()) { if (/^t-?pose$/i.test(a.getName()) || seen.has(a.getName())) a.dispose(); else seen.add(a.getName()); }
  mergeDocuments(out, d);
}
await out.transform(unpartition(), prune(), dedup(), resample({ tolerance: 2e-3 }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const buf = await io.writeBinary(out);
fs.writeFileSync(path.join(OUT, 'kaykit.glb'), buf);
console.log('kaykit.glb', (buf.length / 1024).toFixed(0), 'КБ,', seen.size, 'клипов');
