import * as THREE from 'three';

/*
 * Перенос анимаций между разными скелетами (Mixamo/Странник, UE/Universal, «Героини», KayKit, Quaternius-рыцарь).
 * Кости сопоставляются по «каноническим» ролям (таз, позвоночник, плечо, предплечье…), затем для каждого кадра:
 *   мир_цели(t) = мир_источника(t) · мир_источника(покой)⁻¹ · мир_цели(покой, выровненный)
 * «Выровненный» покой: кость цели повёрнута так, чтобы смотреть туда же, куда кость источника в покое
 * (так A-поза и T-поза не ломают руки). Немаппированные кости цели остаются в позе покоя.
 * Таз двигается с поправкой на длину ног.
 */

const SIDE = { L: /(^left|_l$|\.l$|_l_|(?<=[a-z])l$)/i, R: /(^right|_r$|\.r$|_r_|(?<=[a-z])r$)/i };
const ROLES = [ // роль, регулярка по имени без «стороны», есть ли сторона
  ['hips', /^(hips|pelvis|root_?hips)$/], ['spine', /^(spine|spine_?0?1|spine1|abdomen)$/], ['chest', /^(spine_?0?2|spine2|chest|torso|spine_?0?3|upperchest)$/],
  ['neck', /^(neck|neck_?0?1)$/], ['head', /^head$/],
  ['shoulder', /^(shoulder|clavicle)$/, 1], ['upperArm', /^(arm|upperarm|upper_?arm)$/, 1], ['lowerArm', /^(forearm|lowerarm|lower_?arm)$/, 1],
  ['hand', /^(hand|wrist|palm)$/, 1], ['upperLeg', /^(upleg|thigh|upperleg|upper_?leg)$/, 1], ['lowerLeg', /^(leg|calf|lowerleg|lower_?leg|shin)$/, 1],
  ['foot', /^(foot)$/, 1], ['toes', /^(toebase|toes?|ball)$/, 1],
];
const CHAIN = { spine: 'chest', chest: 'neck', neck: 'head', upperArm: 'lowerArm', lowerArm: 'hand', upperLeg: 'lowerLeg', lowerLeg: 'foot', foot: 'toes' };

function strip(n, side) {
  let s = n.replace(/^mixamorig:?/i, '').toLowerCase();
  if (side === 'L') s = s.replace(/^left/, '').replace(/(_l_|_l$|\.l$|l$)/, ''); else if (side === 'R') s = s.replace(/^right/, '').replace(/(_r_|_r$|\.r$|r$)/, '');
  return s.replace(/[._]+$/, '');
}
/** Роли костей скелета: { hips: Bone, upperArmL: Bone, … } */
export function mapRig(root) {
  const bones = [];
  // в файлах «только анимации» (без мешей) кости — обычные узлы, поэтому берём любые не-меши
  root.traverse((o) => { if ((o.isBone || (!o.isMesh && o !== root)) && o.name && !bones.some((b) => b.name === o.name)) bones.push(o); });
  const out = {};
  for (const b of bones) {
    for (const [role, re, sided] of ROLES) {
      if (sided) {
        for (const side of ['L', 'R']) {
          const key = role + side;
          if (out[key] || !SIDE[side].test(b.name.replace(/^mixamorig:?/i, ''))) continue;
          if (re.test(strip(b.name, side))) out[key] = b;
        }
      } else if (!out[role] && re.test(strip(b.name, null))) out[role] = b;
    }
  }
  // у Quaternius (Героини, рыцарь) ноги растут из Body, а не из Hips — «таз» = общий предок позвоночника и ног
  const anc = (b) => { const a = []; for (let p = b; p; p = p.parent) a.push(p); return a; };
  if (out.hips && out.upperLegL && !anc(out.upperLegL).includes(out.hips)) {
    const up = anc(out.spine || out.hips), common = anc(out.upperLegL).find((x) => up.includes(x) && (x.isBone || x.name));
    if (common && common !== root) out.hips = common;
  }
  // запястье и кисть у KayKit: wrist → hand; берём ближайшую к предплечью
  for (const s of ['L', 'R']) {
    const h = out['hand' + s], la = out['lowerArm' + s];
    if (h && la && h.parent !== la) { let p = h; while (p.parent && p.parent !== la && p.parent.isBone) p = p.parent; if (p.parent === la) out['hand' + s] = p; }
  }
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
function rootSpace(root) { root.updateMatrixWorld(true); return { inv: new THREE.Matrix4().copy(root.matrixWorld).invert() }; }
const worldQ = (b, rs, out = new THREE.Quaternion()) => { _m.multiplyMatrices(rs.inv, b.matrixWorld).decompose(_v, out, new THREE.Vector3()); return out; };
const worldP = (b, rs, out = new THREE.Vector3()) => out.setFromMatrixPosition(_m.multiplyMatrices(rs.inv, b.matrixWorld));

/**
 * Готовит перенос: srcRoot (сцена с костями источника в позе покоя), dstRoot (персонаж в позе покоя).
 * Возвращает retarget(clip) → AnimationClip для цели.
 */
export function createRetargeter(srcRoot, dstRoot) {
  const S = mapRig(srcRoot), D = mapRig(dstRoot);
  const roles = Object.keys(D).filter((r) => S[r]);
  if (!roles.includes('hips')) return null;
  const sRS = rootSpace(srcRoot), dRS = rootSpace(dstRoot);
  const sRest = {}, dAligned = {};
  for (const r of roles) {
    sRest[r] = worldQ(S[r], sRS).invert();
    const dq = worldQ(D[r], dRS);
    // выравнивание направления кости цели под источник
    const base = r.replace(/[LR]$/, ''), side = r.endsWith('L') ? 'L' : r.endsWith('R') ? 'R' : '', next = CHAIN[base] && CHAIN[base] + side;
    if (next && S[next] && D[next]) {
      const ds = worldP(S[next], sRS).sub(worldP(S[r], sRS)).normalize();
      const dd = worldP(D[next], dRS).sub(worldP(D[r], dRS)).normalize();
      if (ds.lengthSq() > 0.5 && dd.lengthSq() > 0.5) dq.premultiply(new THREE.Quaternion().setFromUnitVectors(dd, ds));
    }
    dAligned[r] = dq;
  }
  // порядок костей цели сверху вниз и их покой
  const dBones = [];
  dstRoot.traverse((o) => { if (o.isBone) dBones.push(o); });
  const roleOf = new Map(roles.map((r) => [D[r], r]));
  const restLocal = new Map(dBones.map((b) => [b, b.quaternion.clone()]));
  const parentW = (b) => { // мировой поворот родителя-не-кости (в покое) в пространстве корня
    b.parent.updateMatrixWorld(true);
    const q = new THREE.Quaternion(); _m.multiplyMatrices(dRS.inv, b.parent.matrixWorld).decompose(new THREE.Vector3(), q, new THREE.Vector3()); // с масштабом — только decompose
    return q;
  };
  const outerParent = new Map(dBones.filter((b) => !b.parent?.isBone).map((b) => [b, parentW(b)]));
  // таз: масштаб по длине ног
  const legS = S.upperLegL && S.footL ? worldP(S.upperLegL, sRS).distanceTo(worldP(S.footL, sRS)) : 1;
  const legD = D.upperLegL && D.footL ? worldP(D.upperLegL, dRS).distanceTo(worldP(D.footL, dRS)) : 1;
  const kLeg = legD / Math.max(legS, 1e-6);
  const sHip0 = worldP(S.hips, sRS), dHip0 = worldP(D.hips, dRS);
  const hipParentInv = new THREE.Matrix4().multiplyMatrices(dRS.inv, D.hips.parent.matrixWorld).invert();

  const mixer = new THREE.AnimationMixer(srcRoot);
  return function retarget(clip, fps = 24) {
    const n = Math.max(2, Math.ceil(clip.duration * fps) + 1);
    const times = new Float32Array(n);
    const qv = new Map(roles.map((r) => [r, new Float32Array(n * 4)])), hp = new Float32Array(n * 3);
    mixer.stopAllAction();
    const act = mixer.clipAction(clip); act.play();
    const sW = {}, dW = new Map();
    for (let i = 0; i < n; i++) {
      const t = Math.min(clip.duration, i / fps); times[i] = t;
      mixer.setTime(t); srcRoot.updateMatrixWorld(true);
      for (const r of roles) sW[r] = worldQ(S[r], sRS).multiply(sRest[r]);
      dW.clear();
      for (const b of dBones) {
        const r = roleOf.get(b);
        const pw = b.parent?.isBone ? dW.get(b.parent) : outerParent.get(b);
        let w;
        if (r) {
          w = sW[r].clone().multiply(dAligned[r]);
          const loc = pw.clone().invert().multiply(w), arr = qv.get(r);
          if (i && loc.x * arr[i * 4 - 4] + loc.y * arr[i * 4 - 3] + loc.z * arr[i * 4 - 2] + loc.w * arr[i * 4 - 1] < 0) { loc.x = -loc.x; loc.y = -loc.y; loc.z = -loc.z; loc.w = -loc.w; } // без «переворотов» между кадрами
          arr.set([loc.x, loc.y, loc.z, loc.w], i * 4);
        } else w = pw.clone().multiply(restLocal.get(b));
        dW.set(b, w);
      }
      const hp1 = worldP(S.hips, sRS).sub(sHip0).multiplyScalar(kLeg).add(dHip0).applyMatrix4(hipParentInv);
      hp.set([hp1.x, hp1.y, hp1.z], i * 3);
    }
    act.stop(); mixer.uncacheAction(clip);
    const tracks = roles.map((r) => new THREE.QuaternionKeyframeTrack(D[r].name + '.quaternion', times, qv.get(r)));
    tracks.push(new THREE.VectorKeyframeTrack(D.hips.name + '.position', times, hp));
    const c = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    c.userData = { retargeted: true };
    return c;
  };
}
