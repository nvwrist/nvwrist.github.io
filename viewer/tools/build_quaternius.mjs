// Пакует подготовленные .gltf в .glb: убирает normal/ORM-текстуры, чистит, для библиотек анимаций выкидывает меши.
// Запускается из build_quaternius.py (нужны @gltf-transform/* в /tmp/gt/node_modules).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { prune, dedup, resample, quantize, simplify, weld } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');
await MeshoptSimplifier.ready;
const RATIO = +(process.env.SIMPLIFY || 0.4); // PS1-стиль: оставляем ~40% треугольников

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const [src, out, mode] of jobs) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  if (mode === 'anims') {
    for (const n of root.listNodes()) { n.setMesh(null); n.setSkin(null); }
    root.listMeshes().forEach((m) => m.dispose());
    root.listSkins().forEach((s) => s.dispose());
    root.listMaterials().forEach((m) => m.dispose());
    root.listTextures().forEach((t) => t.dispose());
  } else {
    for (const m of root.listMaterials()) {
      m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
      m.setMetallicFactor(0).setRoughnessFactor(1);
    }
  }
  await doc.transform(prune(), dedup(), resample(), ...(mode === 'anims' ? [] : mode === 'opt' ? [quantize()] : [weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.004, lockBorder: false }), quantize()]));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  console.log((fs.statSync(out).size / 1024).toFixed(0).padStart(6), 'KB', path.relative(process.cwd(), out));
}
