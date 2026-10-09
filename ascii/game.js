import * as THREE from './vendor/three.module.min.js';

/* =====================================================================
   ASCII World — 3D scene rendered to an off-screen target, then turned
   into glyphs on the GPU (luminance → density ramp, grass/rain → stroke
   direction, magic → runes) with bloom on emissive things.
   ===================================================================== */

const TAU = Math.PI * 2, rnd = Math.random;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const $ = id => document.getElementById(id);

/* ---------- noise (JS side, for world generation) ---------- */
function h2(x, y) { let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vn(x, y) * .55 + vn(x * 2.07 + 17, y * 2.07 + 9) * .3 + vn(x * 4.3 + 3, y * 4.3 + 31) * .15;
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pathZ = x => Math.sin(x * .05) * 6 + Math.sin(x * .13) * 1.5;

/* ---------- renderer ---------- */
const canvas = $('c');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }); }
catch (e) { $('err').style.display = 'flex'; throw e; }
if (!renderer.capabilities.isWebGL2) { $('err').style.display = 'flex'; throw new Error('WebGL2 required'); }
renderer.setClearColor(0x000000, 1);
const canHalf = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');

const SX = 3, SY = 5;                         // scene texels per glyph cell
let W, H, DPR, cellW, cellH, cols, rows, quality = 1, asciiOn = true, detail = 1, rawRT = null;
const DETAIL = { big: [8, 6, 5], small: [7, 5, 4], names: ['крупно', 'средне', 'мелко'] };
try { const v = JSON.parse(localStorage.getItem('ascii-view') || '{}'); if (typeof v.ascii === 'boolean') asciiOn = v.ascii; if (v.detail >= 0 && v.detail <= 2) detail = v.detail; } catch (_) { }
let sceneRT, cellRT, bA, bB;

/* ---------- glyph atlas ---------- */
const RAMP = " .,:;~-=+ioxcvzuwdbpqQO0&%$#8@";
const DIRG = "-/|\\";
const RUNE = "[]dbQUo(){}<>cpq";
const GLYPHS = RAMP + DIRG + RUNE;
const atlas = (() => {
  const gw = 40, gh = 70, c = document.createElement('canvas');
  c.width = GLYPHS.length * gw; c.height = gh;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  g.font = `${Math.round(gh * .78)}px "DejaVu Sans Mono",Menlo,Consolas,"Liberation Mono",monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < GLYPHS.length; i++) {
    const ch = GLYPHS[i], x0 = i * gw;
    if (i >= RAMP.length && i < RAMP.length + 4) {
      // directional strokes: long thin lines, like blades of grass / rain
      g.lineWidth = 4.5; g.lineCap = 'round'; g.beginPath();
      const k = i - RAMP.length, m = 7;
      if (k === 0) { g.moveTo(x0 + m, gh / 2); g.lineTo(x0 + gw - m, gh / 2); }
      if (k === 1) { g.moveTo(x0 + m, gh - m); g.lineTo(x0 + gw - m, m); }
      if (k === 2) { g.moveTo(x0 + gw / 2, m); g.lineTo(x0 + gw / 2, gh - m); }
      if (k === 3) { g.moveTo(x0 + m, m); g.lineTo(x0 + gw - m, gh - m); }
      g.stroke();
    } else g.fillText(ch, x0 + gw / 2, gh * .54);
  }
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  return t;
})();

/* ---------- shared uniforms / GLSL ---------- */
const MAXL = 8;
const U = {
  uTime: { value: 0 },
  uAmb: { value: new THREE.Color(.1, .12, .18) },
  uMoonDir: { value: new THREE.Vector3(.35, .85, .4).normalize() },
  uMoonCol: { value: new THREE.Color(.3, .35, .45) },
  uLP: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
  uLC: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
  uLR: { value: new Array(MAXL).fill(1) },
  uNL: { value: 0 },
  uFogCol: { value: new THREE.Color(0, 0, 0) },
  uFogD: { value: .03 },
  uWind: { value: new THREE.Vector2(-1, .2).normalize() },
  uWindS: { value: .5 },
  uPlayer: { value: new THREE.Vector3() },
  uFocus: { value: new THREE.Vector3() },
  uRes: { value: new THREE.Vector2(1, 1) },
};
const COMMON = /* glsl */`
uniform float uTime; uniform vec3 uAmb; uniform vec3 uMoonDir; uniform vec3 uMoonCol;
uniform vec3 uLP[${MAXL}]; uniform vec3 uLC[${MAXL}]; uniform float uLR[${MAXL}]; uniform int uNL;
uniform vec3 uFogCol; uniform float uFogD; uniform vec2 uWind; uniform float uWindS;
uniform vec3 uPlayer; uniform vec3 uFocus; uniform vec2 uRes;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
vec3 lightAt(vec3 p, vec3 n){
  vec3 c = uAmb + uMoonCol*max(dot(n,uMoonDir),0.);
  for(int i=0;i<${MAXL};i++){ if(i>=uNL) break;
    vec3 d=uLP[i]-p; float dist=length(d); float a=clamp(1.-dist/uLR[i],0.,1.); a*=a;
    float nd=max(dot(n,d/max(dist,1e-3)),0.)*.7+.3; c+=uLC[i]*a*nd; }
  return c;
}
vec3 fogIt(vec3 c, vec3 p){ float d=length(p-cameraPosition); float f=1.-exp(-max(d-10.,0.)*uFogD); return mix(c,uFogCol,f); }
float pathZ(float x){ return sin(x*.05)*6.+sin(x*.13)*1.5; }
`;

const STD_VS = COMMON + /* glsl */`
uniform float uSway;
varying vec3 vP;
void main(){
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position,1.);
  if(uSway>0.){
    vec3 ip = m[3].xyz; float h = max(wp.y-ip.y,0.);
    float s = sin(uTime*1.3+ip.x*.6+ip.z*.4)+.5*sin(uTime*2.1+ip.z*.9);
    wp.xz += uWind*(s*.3+.5)*uWindS*h*.06*uSway;
  }
  vP = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;
const STD_FS = COMMON + /* glsl */`
uniform vec3 uColor; uniform vec3 uEmis; uniform float uRim; uniform float uMode; uniform float uPat; uniform vec3 uFill;
varying vec3 vP;
void main(){
  vec3 n = normalize(cross(dFdx(vP),dFdy(vP)));
  vec3 V = normalize(cameraPosition-vP);
  if(dot(n,V)<0.) n=-n;
  vec3 base = uColor;
  if(uPat>.5 && uPat<1.5){            // bricks
    vec2 q = vec2(vP.x+vP.z, vP.y); float row=floor(q.y/.42); float off=mod(row,2.)*.45;
    vec2 b = fract(vec2((q.x+off)/.9, q.y/.42));
    float mort = step(b.x,.07)+step(b.y,.12);
    base *= mort>0. ? .18 : (.7+.6*hash(vec2(floor((q.x+off)/.9),row)));
  } else if(uPat>1.5 && uPat<2.5){    // floor slabs
    vec2 b = fract(vP.xz*.9);
    float mort = step(b.x,.07)+step(b.y,.07);
    base *= mort>0. ? .15 : (.45+.8*noise(vP.xz*2.1));
  } else if(uPat>2.5){                // leafy / bark noise
    base *= .55+.9*noise(vP.xz*2.6+vP.y*3.1);
  }
  vec3 L = lightAt(vP,n) + uFill;
  float rim = pow(1.-max(dot(n,V),0.),2.)*uRim;
  vec3 c = base*L + uEmis + rim*(base+.15)*(uAmb*3.+.25);
  c = fogIt(c,vP);
  gl_FragColor = vec4(c,uMode);
}`;
function stdMat({ color = [1, 1, 1], emis = [0, 0, 0], rim = 0, mode = 1, pat = 0, sway = 0, fill = [0, 0, 0] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(...color) }, uEmis: { value: new THREE.Color(...emis) }, uRim: { value: rim }, uMode: { value: mode }, uPat: { value: pat }, uSway: { value: sway }, uFill: { value: new THREE.Color(...fill) } },
    vertexShader: STD_VS, fragmentShader: STD_FS,
  });
}

/* ---------- scene & camera ---------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, .3, 200);
const forest = new THREE.Group(), dungeon = new THREE.Group(), weatherG = new THREE.Group();
scene.add(forest, dungeon, weatherG);
dungeon.visible = false;

/* ---------- ground ---------- */
const groundMat = new THREE.ShaderMaterial({
  uniforms: { ...U },
  vertexShader: COMMON + `varying vec3 vP; void main(){ vec4 wp=modelMatrix*vec4(position,1.); vP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
  fragmentShader: COMMON + /* glsl */`
  varying vec3 vP;
  void main(){
    float dp = abs(vP.z-pathZ(vP.x));
    vec3 soil = vec3(.012,.022,.015)*(.4+.9*noise(vP.xz*.8));
    float pm = 1.-smoothstep(1.35,1.9,dp+(noise(vP.xz*1.4)-.5)*.7);
    // irregular cobbles: voronoi cells with dark gaps
    vec2 g = vP.xz*1.9; vec2 ig=floor(g), fg=fract(g);
    float d1=9., d2=9.; vec2 cid=vec2(0.);
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
      vec2 o=vec2(float(x),float(y)); vec2 pt=o+vec2(hash(ig+o),hash(ig+o+19.))*.85+.075;
      float d=length(pt-fg); if(d<d1){d2=d1;d1=d;cid=ig+o;} else if(d<d2) d2=d;
    }
    float st = smoothstep(.02,.16,d2-d1);
    vec3 stone = vec3(.40,.38,.35)*(.45+.7*hash(cid))*(.1+.9*st)*(.8+.4*noise(vP.xz*6.));
    vec3 base = mix(soil,stone,pm);
    vec3 c = base*lightAt(vP,vec3(0,1,0));
    gl_FragColor = vec4(fogIt(c,vP),1.);
  }`,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), groundMat);
forest.add(ground);

/* ---------- grass (instanced blades, wind in the vertex shader) ---------- */
const GRASS_TILE = 44;
const grass = (() => {
  const SEG = 4, pos = [], idx = [];
  for (let k = 0; k <= SEG; k++) {
    const y = k / SEG;
    if (k < SEG) { pos.push(-.5, y, 0, .5, y, 0); } else pos.push(0, 1, 0);
  }
  for (let k = 0; k < SEG - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const t = (SEG - 1) * 2; idx.push(t, t + 1, t + 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(idx); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const N = 70000, aI = new Float32Array(N * 4), aV = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    aI[i * 4] = rnd() * GRASS_TILE; aI[i * 4 + 1] = rnd() * GRASS_TILE; aI[i * 4 + 2] = rnd() * TAU; aI[i * 4 + 3] = rnd();
    aV[i] = rnd();
  }
  geo.setAttribute('aI', new THREE.InstancedBufferAttribute(aI, 4));
  geo.setAttribute('aV', new THREE.InstancedBufferAttribute(aV, 1));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uTile: { value: GRASS_TILE }, uB0: { value: new THREE.Vector2() }, uB1: { value: new THREE.Vector2() }, uCamp: { value: new THREE.Vector2() } },
    side: THREE.DoubleSide,
    vertexShader: COMMON + /* glsl */`
    attribute vec4 aI; attribute float aV;
    uniform float uTile; uniform vec2 uB0, uB1, uCamp;
    varying vec3 vP; varying float vH; varying float vAng; varying float vVar;
    void main(){
      vec2 c = uFocus.xz;
      vec2 root = c + mod(aI.xy - c + uTile*.5, uTile) - uTile*.5;
      float h = .5 + aI.w*.8;
      h *= smoothstep(1.3, 2.3, abs(root.y - pathZ(root.x)));
      if(root.x>uB0.x && root.x<uB1.x && root.y>uB0.y && root.y<uB1.y) h = 0.;
      h *= smoothstep(1.2, 2.2, length(root-uCamp));
      h *= .45 + .85*noise(root*.13 + 3.);
      float edge = smoothstep(uTile*.5, uTile*.36, length(root-c));
      h *= edge;
      float y = position.y;
      // wind: travelling gusts + per-blade flutter
      float gust = noise(root*.11 - uWind*uTime*1.7);
      gust = gust*gust*2.2;
      float flutter = sin(uTime*(2.6+aV) + aV*6.28 + dot(root,vec2(.7,.4)))*.22;
      float bend = (gust + flutter + .2) * (.25 + uWindS) ;
      vec2 bv = uWind*bend;
      // push away from the player
      vec2 dp = root - uPlayer.xz; float dl = length(dp);
      bv += (dl>1e-3 ? dp/dl : vec2(0.)) * clamp(1.-dl/1.4,0.,1.)*1.8;
      float bl = min(length(bv), 1.6);
      float droop = 1. - .38*bl;
      float ca = cos(aI.z), sa = sin(aI.z);
      vec2 side = vec2(ca,sa) * position.x * .06 * (1.-y*.8);
      vec3 wp = vec3(root.x + side.x + bv.x*y*y*h, y*h*droop, root.y + side.y + bv.y*y*y*h);
      vec3 tip = vec3(root.x + bv.x*h, h*droop, root.y + bv.y*h);
      vec4 c0 = projectionMatrix*viewMatrix*vec4(root.x,0.,root.y,1.);
      vec4 c1 = projectionMatrix*viewMatrix*vec4(tip,1.);
      vec2 dd = (c1.xy/c1.w - c0.xy/c0.w)*uRes;
      float ang = atan(dd.y, dd.x); if(ang<0.) ang += 3.14159265;
      vAng = ang/3.14159265; vP = wp; vH = y; vVar = aV;
      gl_Position = projectionMatrix*viewMatrix*vec4(wp,1.);
    }`,
    fragmentShader: COMMON + /* glsl */`
    varying vec3 vP; varying float vH; varying float vAng; varying float vVar;
    void main(){
      vec3 tipc = mix(vec3(.26,.46,.27), vec3(.40,.52,.30), vVar);
      vec3 base = mix(vec3(.03,.07,.04), tipc, smoothstep(0.,1.,vH));
      vec3 c = base*lightAt(vP, vec3(0.,1.,0.))*1.2;
      gl_FragColor = vec4(fogIt(c,vP), .1 + .8*clamp(vAng,0.,.999));
    }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  forest.add(mesh);
  return { mesh, geo, mat, N };
})();

/* ---------- forest layout ---------- */
const DOOR = { x: 40, z: pathZ(40) - 3.4 };
const BLD = { x0: 35, x1: 45, z0: DOOR.z - 7, z1: DOOR.z };
const CAMP = { x: 3.2, z: -3.2 };
grass.mat.uniforms.uB0.value.set(BLD.x0 - .4, BLD.z0 - .4);
grass.mat.uniforms.uB1.value.set(BLD.x1 + .4, BLD.z1 + .4);
grass.mat.uniforms.uCamp.value.set(CAMP.x, CAMP.z);

const circles = new Map();            // spatial hash of round obstacles
const boxes = [];                     // axis-aligned obstacles in the forest
function addCircle(x, z, r) { const k = (Math.floor(x / 4)) + ',' + (Math.floor(z / 4)); if (!circles.has(k)) circles.set(k, []); circles.get(k).push({ x, z, r }); }

(function buildTrees() {
  const trunks = [], cans = [];
  for (let gx = -120; gx <= 120; gx += 2.3) for (let gz = -120; gz <= 120; gz += 2.3) {
    const x = gx + (h2(gx * 10, gz * 10) - .5) * 2, z = gz + (h2(gz * 10 + 3, gx * 10) - .5) * 2;
    const d = fbm(x * .045 + 51, z * .045 + 12);
    const p = (d - .47) * 3.4 + .06;
    if (h2(gx * 7 + 1, gz * 7) > p) continue;
    if (Math.abs(z - pathZ(x)) < 3.2) continue;
    if (Math.hypot(x - 1, z - 1) < 6.5) continue;
    if (x > BLD.x0 - 6 && x < BLD.x1 + 6 && z > BLD.z0 - 5 && z < BLD.z1 + 6) continue;
    const s = .75 + h2(gx, gz * 3) * .75;
    trunks.push([x, z, s]); cans.push([x, z, s, h2(gz, gx) * TAU]);
    addCircle(x, z, .35 * s);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const trunkGeo = new THREE.CylinderGeometry(.16, .26, 1, 6).translate(0, .5, 0);
  const trunk = new THREE.InstancedMesh(trunkGeo, stdMat({ color: [.5, .42, .34], pat: 3 }), trunks.length);
  trunks.forEach(([x, z, s], i) => { m4.compose(v.set(x, 0, z), q.identity(), sc.set(s, 2.2 * s, s)); trunk.setMatrixAt(i, m4); });
  const canGeo = new THREE.IcosahedronGeometry(1, 0);
  const canMat = stdMat({ color: [.72, .84, .74], pat: 3, sway: 1 });
  const can1 = new THREE.InstancedMesh(canGeo, canMat, cans.length), can2 = new THREE.InstancedMesh(canGeo, canMat, cans.length);
  cans.forEach(([x, z, s, r], i) => {
    q.setFromEuler(e.set(0, r, 0));
    m4.compose(v.set(x, 2.2 * s + 1.1 * s, z), q, sc.set(1.7 * s, 1.35 * s, 1.7 * s)); can1.setMatrixAt(i, m4);
    m4.compose(v.set(x + .3 * s, 2.2 * s + 2.4 * s, z - .2 * s), q, sc.set(1.1 * s, 1.0 * s, 1.1 * s)); can2.setMatrixAt(i, m4);
  });
  [trunk, can1, can2].forEach(m => { m.frustumCulled = false; forest.add(m); });
  // rocks
  const rocks = [];
  for (let i = 0; i < 260; i++) {
    const x = (rnd() - .5) * 220, z = (rnd() - .5) * 220;
    if (Math.abs(z - pathZ(x)) < 2.4 || Math.hypot(x, z) < 6) continue;
    if (x > BLD.x0 - 2 && x < BLD.x1 + 2 && z > BLD.z0 - 2 && z < BLD.z1 + 3) continue;
    rocks.push([x, z, .25 + rnd() * .55]);
  }
  const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), stdMat({ color: [.42, .42, .4], pat: 3 }), rocks.length);
  rocks.forEach(([x, z, s], i) => { q.setFromEuler(e.set(rnd(), rnd() * 6, rnd())); m4.compose(v.set(x, s * .35, z), q, sc.set(s, s * .7, s)); rock.setMatrixAt(i, m4); if (s > .4) addCircle(x, z, s * .8); });
  rock.frustumCulled = false; forest.add(rock);
})();

/* ruins with a doorway into the depths */
const torchPos = [];
(function buildRuins() {
  const wm = stdMat({ color: [.5, .5, .47], pat: 1 });
  const add = (x0, x1, y0, y1, z0, z1, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), wm);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); forest.add(m);
    if (solid) boxes.push({ x0, x1, z0, z1 });
  };
  const { x0, x1, z0, z1 } = BLD, t = .7, Ht = 3.6;
  add(x0, x1, 0, Ht, z0, z0 + t);                 // back
  add(x0, x0 + t, 0, Ht * .85, z0, z1);           // left
  add(x1 - t, x1, 0, Ht * .7, z0, z1);            // right (crumbled)
  add(x0, DOOR.x - 1.1, 0, Ht, z1 - t, z1);       // front left
  add(DOOR.x + 1.1, x1, 0, Ht * .9, z1 - t, z1);  // front right
  add(DOOR.x - 1.1, DOOR.x + 1.1, 2.5, Ht, z1 - t, z1, false); // lintel
  // pillars and fallen blocks
  for (const [px, pz, ph] of [[x0 - 1.6, z1 + 1.2, 2.6], [x1 + 1.6, z1 + 1.2, 1.4], [x0 - 1.8, z0 + 2, 3.2]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.42, .5, ph, 7), wm); m.position.set(px, ph / 2, pz); forest.add(m); addCircle(px, pz, .55);
  }
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(.9, .45, .55), wm);
    m.position.set(x0 - 3 + rnd() * (x1 - x0 + 6), .22, z1 + 2 + rnd() * 3); m.rotation.y = rnd() * 3; forest.add(m);
  }
  // inner darkness + portal glow
  const inner = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 2 * t, .05, z1 - z0 - 2 * t), stdMat({ color: [0, 0, 0], emis: [.0, .0, .0] }));
  inner.position.set((x0 + x1) / 2, .03, (z0 + z1) / 2); forest.add(inner);
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.45), stdMat({ color: [0, 0, 0], emis: [.02, .09, .05] }));
  portal.position.set(DOOR.x, 1.25, z1 - t - .05); forest.add(portal);
  // torches
  for (const sx of [-1.9, 1.9]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, 1.5, 5), stdMat({ color: [.3, .22, .15] }));
    post.position.set(DOOR.x + sx, .75, z1 + .45); forest.add(post);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.22, .12, .2, 6), stdMat({ color: [.25, .2, .16], emis: [.5, .2, .05] }));
    bowl.position.set(DOOR.x + sx, 1.55, z1 + .45); forest.add(bowl);
    torchPos.push(new THREE.Vector3(DOOR.x + sx, 1.7, z1 + .45));
    addCircle(DOOR.x + sx, z1 + .45, .2);
  }
})();

/* campfire */
(function buildCamp() {
  const sm = stdMat({ color: [.4, .38, .36] });
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU, m = new THREE.Mesh(new THREE.DodecahedronGeometry(.17, 0), sm);
    m.position.set(CAMP.x + Math.cos(a) * .62, .1, CAMP.z + Math.sin(a) * .62); forest.add(m);
  }
  const lm = stdMat({ color: [.3, .2, .12], emis: [.25, .08, .01] });
  for (const r of [.5, -.6]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .9, 5), lm); l.rotation.set(Math.PI / 2, 0, r); l.position.set(CAMP.x, .1, CAMP.z); forest.add(l); }
  addCircle(CAMP.x, CAMP.z, .8);
  // logs to sit on
  for (const [dx, dz, r] of [[-1.9, .4, .3], [1.7, 1.2, -.5]]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 1.3, 6), stdMat({ color: [.33, .25, .18], pat: 3 }));
    l.rotation.set(0, r, Math.PI / 2); l.position.set(CAMP.x + dx, .2, CAMP.z + dz); forest.add(l);
  }
})();

/* ---------- characters (low-poly) ---------- */
function makeCharacter({ robe = [.9, .87, .8], hat = [.42, .4, .5], orb = [1.6, 1.1, .5], fill = [.02, .02, .02], rimK = 1.2, beard = [.93, .93, .9], trim = [.95, .72, .3] } = {}) {
  const g = new THREE.Group();
  const M = (color, o = {}) => stdMat({ color, rim: rimK, fill, ...o });
  const mRobe = M(robe), mRobeD = M(robe.map(v => v * .6)), mHat = M(hat), mSkin = M([.88, .72, .58], { rim: .8 }),
    mDark = M([.2, .18, .17], { rim: .8 }), mBoot = M([.34, .23, .15], { rim: .7 }), mStaff = M([.47, .32, .19], { rim: .6 }),
    mBeard = M(beard), mTrim = M(trim, { emis: trim.map(v => v * .12) }), mOrb = stdMat({ color: [0, 0, 0], emis: orb });
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const body = new THREE.Group(); g.add(body);
  // robe: flared skirt with trimmed hem, torso, belt with buckle and pouch
  add(body, new THREE.CylinderGeometry(.27, .47, .78, 10), mRobe, 0, .58);
  add(body, new THREE.CylinderGeometry(.475, .5, .07, 10), mTrim, 0, .2);
  add(body, new THREE.CylinderGeometry(.24, .27, .46, 9), mRobe, 0, 1.15);
  add(body, new THREE.CylinderGeometry(.285, .285, .08, 9), mDark, 0, .96);
  add(body, new THREE.BoxGeometry(.1, .08, .04), mTrim, 0, .96, .28);
  add(body, new THREE.BoxGeometry(.12, .15, .09), mBoot, -.25, .86, .1);
  // robe front seam
  add(body, new THREE.BoxGeometry(.035, .7, .02), mTrim, 0, .58, .39).rotation.x = -.3;
  // mantle + shoulder pads
  add(body, new THREE.CylinderGeometry(.2, .37, .2, 9), mRobeD, 0, 1.4);
  for (const sx of [-.3, .3]) add(body, new THREE.IcosahedronGeometry(.11, 0), mRobeD, sx, 1.36, 0).scale.set(1.1, .7, 1);
  // cloak hinged at the shoulders, flutters
  const cloakP = new THREE.Group(); cloakP.position.set(0, 1.42, -.2); body.add(cloakP);
  const cloakGeo = new THREE.CylinderGeometry(.3, .5, 1.25, 8, 1, true, Math.PI * .55, Math.PI * .9);
  add(cloakP, cloakGeo, mRobeD, 0, -.62, .2);
  // head: face, nose, eyes, eyebrows, long beard, moustache
  const head = add(body, new THREE.IcosahedronGeometry(.155, 1), mSkin, 0, 1.6); head.scale.set(1, 1.1, 1);
  add(body, new THREE.ConeGeometry(.032, .1, 4), mSkin, 0, 1.585, .17).rotation.x = Math.PI / 2;
  for (const ex of [-.058, .058]) { add(body, new THREE.BoxGeometry(.034, .026, .02), mDark, ex, 1.63, .145); add(body, new THREE.BoxGeometry(.06, .018, .02), mBeard, ex, 1.665, .145); }
  add(body, new THREE.ConeGeometry(.14, .5, 8), mBeard, 0, 1.33, .1).rotation.x = Math.PI + .15;
  add(body, new THREE.BoxGeometry(.18, .035, .04), mBeard, 0, 1.55, .155);
  // hat: wide brim, band, crown and bent tip
  add(body, new THREE.CylinderGeometry(.34, .36, .035, 14), mHat, 0, 1.77);
  add(body, new THREE.CylinderGeometry(.18, .24, .3, 10), mHat, 0, 1.91);
  add(body, new THREE.CylinderGeometry(.243, .243, .06, 10), mTrim, 0, 1.79);
  const tipP = new THREE.Group(); tipP.position.set(0, 2.05, 0); tipP.rotation.x = -.5; body.add(tipP);
  add(tipP, new THREE.ConeGeometry(.18, .55, 9), mHat, 0, .26);
  add(tipP, new THREE.IcosahedronGeometry(.035, 0), mTrim, 0, .54);
  // limbs: tapered legs with boots, flared sleeves with hands
  const limb = (x, y, len, r0, r1, mat) => { const p = new THREE.Group(); p.position.set(x, y, 0); add(p, new THREE.CylinderGeometry(r0, r1, len, 7), mat, 0, -len / 2); return p; };
  const legL = limb(-.13, .56, .46, .075, .065, mDark), legR = limb(.13, .56, .46, .075, .065, mDark);
  for (const l of [legL, legR]) { add(l, new THREE.BoxGeometry(.14, .13, .24), mBoot, 0, -.49, .04); add(l, new THREE.CylinderGeometry(.085, .085, .05, 7), mBoot, 0, -.4); }
  const armL = limb(-.34, 1.33, .56, .075, .135, mRobe), armR = limb(.34, 1.33, .56, .075, .135, mRobe);
  for (const a of [armL, armR]) { add(a, new THREE.CylinderGeometry(.14, .14, .05, 8), mTrim, 0, -.55); add(a, new THREE.IcosahedronGeometry(.065, 1), mSkin, 0, -.62); }
  armL.rotation.z = -.14; armR.rotation.z = .14;
  body.add(armL, armR); g.add(legL, legR);
  // staff with ring, prongs and crystal
  add(armR, new THREE.CylinderGeometry(.03, .042, 2.15, 6), mStaff, 0, -.32, .1);
  add(armR, new THREE.TorusGeometry(.075, .018, 4, 10), mTrim, 0, .72, .1).rotation.x = Math.PI / 2;
  for (let k = 0; k < 3; k++) { const a = k / 3 * TAU, pr = add(armR, new THREE.ConeGeometry(.02, .2, 4), mStaff, Math.cos(a) * .07, .86, .1 + Math.sin(a) * .07); pr.rotation.set(Math.sin(a) * .5, 0, -Math.cos(a) * .5); }
  const orbM = add(armR, new THREE.OctahedronGeometry(.1, 0), mOrb, 0, .9, .1); orbM.scale.y = 1.4;
  return { g, body, legL, legR, armL, armR, orbM, mOrb, cloakP, tipP, phase: 0, cast: 0 };
}
function animChar(c, dt, moving, speed) {
  c.phase += dt * (moving ? speed * 2.1 : 0);
  const t = U.uTime.value, s = moving ? Math.sin(c.phase) : 0, k = 1 - Math.exp(-dt * 12);
  c.legL.rotation.x = lerp(c.legL.rotation.x, s * .7, k);
  c.legR.rotation.x = lerp(c.legR.rotation.x, -s * .7, k);
  c.armL.rotation.x = lerp(c.armL.rotation.x, -s * .6, k);
  c.armR.rotation.x = lerp(c.armR.rotation.x, c.cast > 0 ? -1.5 : s * .35, 1 - Math.exp(-dt * 18));
  c.body.position.y = moving ? Math.abs(Math.cos(c.phase)) * .06 : Math.sin(t * 2) * .012;
  const flap = Math.sin(t * 5 + c.phase) * .08 + Math.sin(t * 1.7) * .05 * (.4 + U.uWindS.value);
  c.cloakP.rotation.x = lerp(c.cloakP.rotation.x, (moving ? .45 : .08) + flap, k);
  c.tipP.rotation.z = Math.sin(t * 1.3 + c.phase * .5) * .12;
  c.cast -= dt;
}
const orbWorld = (c, out) => c.orbM.getWorldPosition(out);

/* ---------- particles (billboards, instanced) ---------- */
const PMAX = 5000;
const parts = [];
const pGeo = new THREE.InstancedBufferGeometry();
pGeo.setIndex([0, 1, 2, 0, 2, 3]);
pGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 4), pMode = new Float32Array(PMAX);
const pPosA = new THREE.InstancedBufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage);
const pColA = new THREE.InstancedBufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage);
const pModeA = new THREE.InstancedBufferAttribute(pMode, 1).setUsage(THREE.DynamicDrawUsage);
pGeo.setAttribute('iPos', pPosA); pGeo.setAttribute('iCol', pColA); pGeo.setAttribute('iMode', pModeA);
pGeo.instanceCount = 0;
const pMesh = new THREE.Mesh(pGeo, new THREE.ShaderMaterial({
  uniforms: { ...U },
  vertexShader: COMMON + /* glsl */`
  attribute vec3 iPos; attribute vec4 iCol; attribute float iMode;
  varying vec3 vC; varying float vM; varying vec2 vQ;
  void main(){
    vec3 r = vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
    vec3 u = vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
    vec3 wp = iPos + (r*position.x + u*position.y)*iCol.a;
    vC = iCol.rgb; vM = iMode; vQ = position.xy;
    gl_Position = projectionMatrix*viewMatrix*vec4(wp,1.);
  }`,
  fragmentShader: /* glsl */`
  varying vec3 vC; varying float vM; varying vec2 vQ;
  void main(){ if(dot(vQ,vQ)>1.) discard; gl_FragColor = vec4(vC, vM); }`,
}));
pMesh.frustumCulled = false; scene.add(pMesh);
const RUNEM = .05;
function emit(o) {
  if (parts.length >= PMAX) return;
  o.vx ??= 0; o.vy ??= 0; o.vz ??= 0; o.grav ??= 0; o.drag ??= 0; o.mode ??= 1; o.size ??= .1; o.life ??= 1;
  o.max = o.life; parts.push(o);
}
function updateParts(dt) {
  let n = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    if (p.orbit) {
      const o = p.orbit; o.a += o.w * dt; o.r += o.dr * dt; p.y += p.vy * dt;
      p.x = o.c.x + Math.cos(o.a) * o.r; p.z = o.c.z + Math.sin(o.a) * o.r;
    } else {
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d - p.grav * dt; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
  }
  for (const p of parts) {
    const k = clamp(p.life / p.max, 0, 1), f = p.fade === false ? 1 : k;
    pPos[n * 3] = p.x; pPos[n * 3 + 1] = p.y; pPos[n * 3 + 2] = p.z;
    pCol[n * 4] = p.r * f; pCol[n * 4 + 1] = p.g * f; pCol[n * 4 + 2] = p.b * f;
    pCol[n * 4 + 3] = p.size * (p.shrink ? .3 + .7 * k : 1) * (p.grow ? 1 + (1 - k) * p.grow : 1);
    pMode[n] = p.mode; n++;
  }
  pGeo.instanceCount = n;
  pPosA.needsUpdate = pColA.needsUpdate = pModeA.needsUpdate = true;
  pPosA.addUpdateRange?.(0, n * 3); pColA.addUpdateRange?.(0, n * 4); pModeA.addUpdateRange?.(0, n);
}

/* ---------- rain & snow (instanced, wrapped around the camera) ---------- */
const RAIN_MAX = 4500;
const rain = (() => {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  const a = new Float32Array(RAIN_MAX * 4);
  for (let i = 0; i < RAIN_MAX; i++) { a[i * 4] = rnd() * 36; a[i * 4 + 1] = rnd() * 16; a[i * 4 + 2] = rnd() * 36; a[i * 4 + 3] = rnd(); }
  geo.setAttribute('aO', new THREE.InstancedBufferAttribute(a, 4));
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uFlash: { value: 0 } },
    vertexShader: COMMON + /* glsl */`
    attribute vec4 aO; uniform float uFlash;
    varying float vAng; varying float vB; varying vec3 vP;
    void main(){
      vec2 c = uFocus.xz;
      float fall = 15. + aO.w*7.;
      float y = mod(aO.y - uTime*fall, 16.);
      vec3 vel = vec3(uWind.x*(2.+uWindS*8.), -fall, uWind.y*(2.+uWindS*8.));
      vec3 p = vec3(0., y, 0.);
      p.xz = c + mod(aO.xz - c + 18. + (-vel.xz/fall)*y, 36.) - 18.;
      vec3 d = normalize(vel);
      vec3 vd = normalize(cameraPosition - p);
      vec3 rr = normalize(cross(d, vd));
      float len = .7 + aO.w*.6;
      vec3 wp = p + d*(position.y-.5)*len + rr*position.x*.018;
      vec4 c0 = projectionMatrix*viewMatrix*vec4(p,1.), c1 = projectionMatrix*viewMatrix*vec4(p+d,1.);
      vec2 dd = (c1.xy/c1.w - c0.xy/c0.w)*uRes; float ang = atan(dd.y,dd.x); if(ang<0.) ang += 3.14159265;
      vAng = ang/3.14159265; vB = .55 + aO.w*.45 + uFlash; vP = wp;
      gl_Position = projectionMatrix*viewMatrix*vec4(wp,1.);
    }`,
    fragmentShader: COMMON + /* glsl */`
    varying float vAng; varying float vB; varying vec3 vP;
    void main(){
      vec3 c = vec3(.50,.58,.72)*vB*(.55 + .7*min(lightAt(vP,vec3(0,1,0)), vec3(1.6)));
      gl_FragColor = vec4(c, .1 + .8*clamp(vAng,0.,.999));
    }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; weatherG.add(mesh);
  return { geo, mat };
})();
const SNOW_MAX = 2500;
const snow = (() => {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  const a = new Float32Array(SNOW_MAX * 4);
  for (let i = 0; i < SNOW_MAX; i++) { a[i * 4] = rnd() * 36; a[i * 4 + 1] = rnd() * 14; a[i * 4 + 2] = rnd() * 36; a[i * 4 + 3] = rnd(); }
  geo.setAttribute('aO', new THREE.InstancedBufferAttribute(a, 4));
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: COMMON + /* glsl */`
    attribute vec4 aO; varying vec2 vQ;
    void main(){
      vec2 c = uFocus.xz; float fall = 1.1 + aO.w*.9;
      float y = mod(aO.y - uTime*fall, 14.);
      vec3 p = vec3(0., y, 0.);
      vec2 sway = vec2(sin(uTime*1.3+aO.w*30.), cos(uTime*1.1+aO.w*20.))*.5 + uWind*uWindS*y*.4;
      p.xz = c + mod(aO.xz - c + 18. + sway, 36.) - 18.;
      vec3 r = vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
      vec3 u = vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
      vQ = position.xy;
      gl_Position = projectionMatrix*viewMatrix*vec4(p + (r*position.x+u*position.y)*(.04+aO.w*.04),1.);
    }`,
    fragmentShader: `varying vec2 vQ; void main(){ if(dot(vQ,vQ)>1.) discard; gl_FragColor = vec4(vec3(.85,.9,1.),1.); }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; weatherG.add(mesh);
  return { geo };
})();

/* ---------- dungeon ---------- */
const DW = 48, DH = 48, TS = 2;
const D = { map: null, start: new THREE.Vector3(), exit: new THREE.Vector3(), braziers: [], monsters: [] };
(function buildDungeon() {
  const r = mulberry(4242), map = new Uint8Array(DW * DH), rooms = [{ x: DW / 2 - 4, y: DH / 2 - 3, w: 8, h: 7 }];
  for (let i = 0; i < 400 && rooms.length < 13; i++) {
    const w = 4 + (r() * 6 | 0), h = 4 + (r() * 5 | 0), x = 2 + (r() * (DW - w - 4) | 0), y = 2 + (r() * (DH - h - 4) | 0);
    if (rooms.some(o => x < o.x + o.w + 2 && x + w + 2 > o.x && y < o.y + o.h + 2 && y + h + 2 > o.y)) continue;
    rooms.push({ x, y, w, h });
  }
  const carve = (x, y) => { if (x > 0 && y > 0 && x < DW - 1 && y < DH - 1) map[y * DW + x] = 1; };
  rooms.forEach(o => { for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) carve(x, y); });
  const cen = o => [o.x + (o.w >> 1), o.y + (o.h >> 1)];
  const left = rooms.slice(1), order = [rooms[0]];
  while (left.length) { const [cx, cy] = cen(order[order.length - 1]); left.sort((a, b) => Math.hypot(cen(a)[0] - cx, cen(a)[1] - cy) - Math.hypot(cen(b)[0] - cx, cen(b)[1] - cy)); order.push(left.shift()); }
  const corridor = (a, b) => { let [x, y] = cen(a); const [tx, ty] = cen(b); while (x !== tx) { carve(x, y); x += Math.sign(tx - x); } while (y !== ty) { carve(x, y); y += Math.sign(ty - y); } };
  for (let i = 0; i < order.length - 1; i++) corridor(order[i], order[i + 1]);
  for (let i = 0; i < 3; i++) corridor(order[r() * order.length | 0], order[r() * order.length | 0]);
  D.map = map;
  const t2w = (tx, ty) => [(tx + .5 - DW / 2) * TS, (ty + .5 - DH / 2) * TS];
  const floors = [], walls = [];
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
    if (map[y * DW + x]) { floors.push(t2w(x, y)); continue; }
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < DW && yy < DH && map[yy * DW + xx]) { near = true; break; } }
    if (near) walls.push(t2w(x, y));
  }
  const m4 = new THREE.Matrix4();
  const fl = new THREE.InstancedMesh(new THREE.BoxGeometry(TS, .2, TS), stdMat({ color: [.75, .8, .72], pat: 2 }), floors.length);
  floors.forEach(([x, z], i) => { m4.makeTranslation(x, -.1, z); fl.setMatrixAt(i, m4); });
  const wl = new THREE.InstancedMesh(new THREE.BoxGeometry(TS, 2.8, TS), stdMat({ color: [.75, .8, .72], pat: 1 }), walls.length);
  walls.forEach(([x, z], i) => { m4.makeTranslation(x, 1.4, z); wl.setMatrixAt(i, m4); });
  fl.frustumCulled = wl.frustumCulled = false; dungeon.add(fl, wl);
  const [sx, sz] = t2w(...cen(rooms[0]));
  D.start.set(sx, 0, sz + 1.5); D.exit.set(sx, 0, sz - 2.2);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.55, .8, 10).rotateX(-Math.PI / 2), stdMat({ color: [0, 0, 0], emis: [.25, .9, .35] }));
  ring.position.set(sx, .02, sz - 2.2); dungeon.add(ring);
  const bm = stdMat({ color: [.3, .27, .24], emis: [.35, .12, .02] });
  rooms.forEach((o, i) => {
    if (i % 2) return;
    const [x, z] = t2w(o.x + 1, o.y + 1);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(.3, .18, .7, 6), bm); b.position.set(x, .35, z); dungeon.add(b);
    D.braziers.push(new THREE.Vector3(x, .8, z));
  });
  const eyeMat = stdMat({ color: [0, 0, 0], emis: [.5, 2.2, .6] }), bodyMat = stdMat({ color: [.16, .2, .16], rim: .5 });
  for (let i = 0; i < 12; i++) {
    const o = rooms[1 + (r() * (rooms.length - 1) | 0)], [x, z] = t2w(o.x + (r() * o.w | 0), o.y + (r() * o.h | 0));
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(.5, 0), bodyMat); body.scale.set(1, 1.35, 1); body.position.y = .7; g.add(body);
    const eyes = new THREE.Group(); eyes.position.set(0, 1.12, .36); g.add(eyes);
    for (const ex of [-.15, .15]) { const e = new THREE.Mesh(new THREE.IcosahedronGeometry(.07, 0), eyeMat); e.position.x = ex; eyes.add(e); }
    g.position.set(x, 0, z); dungeon.add(g);
    D.monsters.push({ g, eyes, hx: x, hz: z, alive: true, rt: 0, ph: r() * 10 });
  }
})();
function dSolid(x, z) {
  const tx = Math.floor(x / TS + DW / 2), ty = Math.floor(z / TS + DH / 2);
  return tx < 0 || ty < 0 || tx >= DW || ty >= DH || !D.map[ty * DW + tx];
}

/* ---------- collision ---------- */
let zone = 'forest';
function fSolid(x, z, rad) {
  for (const b of boxes) if (x > b.x0 - rad && x < b.x1 + rad && z > b.z0 - rad && z < b.z1 + rad) return true;
  const kx = Math.floor(x / 4), kz = Math.floor(z / 4);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const l = circles.get((kx + i) + ',' + (kz + j)); if (!l) continue;
    for (const c of l) { const dx = x - c.x, dz = z - c.z, rr = c.r + rad; if (dx * dx + dz * dz < rr * rr) return true; }
  }
  return false;
}
function solid(x, z, rad = .3) {
  if (zone === 'forest') return fSolid(x, z, rad);
  return dSolid(x - rad, z - rad) || dSolid(x + rad, z - rad) || dSolid(x - rad, z + rad) || dSolid(x + rad, z + rad);
}
function tryMove(o, dx, dz) { let moved = false; if (!solid(o.x + dx, o.z)) { o.x += dx; moved = true; } if (!solid(o.x, o.z + dz)) { o.z += dz; moved = true; } return moved; }

/* ---------- state ---------- */
const SP = [
  { n: 'Arcane', c: [.4, 1.9, 1.7], col: '#5fe' },
  { n: 'Fire', c: [2.4, 1.0, .25], col: '#f94' },
  { n: 'Nature', c: [.8, 2.2, .45], col: '#8f6' },
];
const P = { name: 'Странник', x: 0, z: 3, yaw: 0, hp: 5, cd: 0, spell: 0, inv: 0, hurt: 0, say: '', sayT: 0 };
const hero = makeCharacter({ fill: [.07, .065, .06], rimK: 1.7 });
scene.add(hero.g);
const NPC_DEF = [['Mira', [.75, .45, .55], [.35, .18, .25]], ['Kael', [.45, .55, .8], [.18, .22, .4]], ['Oru', [.5, .7, .45], [.2, .3, .18]]];
const NPCS = NPC_DEF.map(([name, robe, hat], i) => {
  const c = makeCharacter({ robe, hat, orb: SP[i].c });
  forest.add(c.g);
  const a = rnd() * TAU, x = CAMP.x + Math.cos(a) * 5, z = CAMP.z + Math.sin(a) * 4;
  return { name, c, x, z, tx: x, tz: z, yaw: 0, wait: rnd() * 3, cd: 4 + rnd() * 6, talk: 6 + rnd() * 14, sp: i, say: '', sayT: 0, mv: false, col: `rgb(${robe.map(v => v * 255 | 0)})` };
});
const LINES = ['кто-нибудь видел вход в руины?', 'этот дождь просто чудо', 'ищу пати в Глубины', 'красивый посох!', 'смотри как трава гнётся', 'гг', 'осторожно, там глаза в темноте', 'у костра тепло', 'кто умеет в Arcane?'];

/* weather presets */
const WX = [
  { n: 'Ясно', rain: 0, snow: 0, fog: .012, wind: .35, storm: 0, amb: [.11, .13, .2], moon: [.45, .52, .68], fogc: [.02, .025, .04] },
  { n: 'Дождь', rain: .7, snow: 0, fog: .022, wind: .75, storm: 0, amb: [.075, .09, .13], moon: [.3, .35, .46], fogc: [.03, .035, .05] },
  { n: 'Гроза', rain: 1, snow: 0, fog: .03, wind: 1.35, storm: 1, amb: [.05, .06, .09], moon: [.17, .2, .28], fogc: [.02, .025, .04] },
  { n: 'Снег', rain: 0, snow: 1, fog: .03, wind: .3, storm: 0, amb: [.12, .13, .17], moon: [.38, .42, .52], fogc: [.08, .085, .1] },
  { n: 'Туман', rain: 0, snow: 0, fog: .12, wind: .15, storm: 0, amb: [.08, .09, .11], moon: [.2, .22, .26], fogc: [.13, .14, .16] },
];
const DUN_WX = { rain: 0, snow: 0, fog: .09, wind: 0, storm: 0, amb: [.004, .006, .008], moon: [0, 0, 0], fogc: [0, 0, 0] };
let wxIdx = 1;
const Wc = { rain: 0, snow: 0, fog: .02, wind: .5, storm: 0, amb: [.06, .07, .1], moon: [.2, .24, .3], fogc: [0, 0, 0] };
let flash = 0, flashT = 3, flash2 = 0;
const focus = new THREE.Vector3(P.x, 0, P.z);
let T = 0, fadeV = 0, fadeDir = 0, fadeTo = null;
const projs = [];

/* ---------- UI ---------- */
const logEl = $('log'), toastEl = $('toast'), zoneEl = $('zone'), heartsEl = $('hearts'), fadeEl = $('fade'), tagsEl = $('tags');
function say(who, txt, col) {
  const d = document.createElement('div'); d.innerHTML = '<b></b> <span></span>';
  d.firstChild.textContent = who + ':'; d.firstChild.style.color = col || '#9ab'; d.lastChild.textContent = txt; logEl.appendChild(d);
  while (logEl.children.length > 6) logEl.removeChild(logEl.firstChild);
  setTimeout(() => { d.style.opacity = 0; }, 11000); setTimeout(() => d.remove(), 12500);
}
let toastTm; function toast(t) { toastEl.textContent = t; toastEl.style.opacity = 1; clearTimeout(toastTm); toastTm = setTimeout(() => { toastEl.style.opacity = 0; }, 2400); }
function hud() {
  zoneEl.innerHTML = (zone === 'forest' ? 'Шепчущий лес' : 'Глубины руин') + '<small></small>';
  zoneEl.lastChild.textContent = (zone === 'forest' ? WX[wxIdx].n : 'тьма') + ' · ' + SP[P.spell].n;
  heartsEl.textContent = '♥'.repeat(Math.max(0, P.hp)) + '♡'.repeat(Math.max(0, 5 - P.hp));
}
setTimeout(() => { $('hint').style.opacity = 0; }, 16000);
function makeTag(name, col) {
  const d = document.createElement('div'); d.className = 'tag'; d.innerHTML = '<span></span><b></b>';
  d.lastChild.textContent = name; d.lastChild.style.color = col; tagsEl.appendChild(d); return d;
}
P.tag = makeTag(P.name, '#fff');
NPCS.forEach(n => { n.tag = makeTag(n.name, n.col); });

/* ---------- input ---------- */
const keys = {}, joy = { x: 0, y: 0 }; let chatOpen = false; const chatEl = $('chat');
addEventListener('keydown', e => {
  if (chatOpen) {
    if (e.code === 'Enter') { const t = chatEl.value.trim(); if (t) { P.say = t; P.sayT = 5; say(P.name, t, '#ffd98a'); } closeChat(); }
    else if (e.code === 'Escape') closeChat();
    return;
  }
  if (e.code === 'Enter') { chatOpen = true; chatEl.style.display = 'block'; chatEl.value = ''; chatEl.focus(); e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === 'Space') { cast(null); e.preventDefault(); }
  if (e.code === 'KeyQ') { P.spell = (P.spell + 1) % SP.length; hud(); }
  if (e.code === 'KeyV') setView(!asciiOn, detail);
  if (e.code === 'KeyZ') setView(asciiOn, (detail + 1) % 3);
  if (/^Digit[1-5]$/.test(e.code)) setWx(+e.code[5] - 1);
});
function closeChat() { chatOpen = false; chatEl.style.display = 'none'; chatEl.blur(); }
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let stick = null; const stickEl = $('stick');
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') { cast({ x: e.clientX, y: e.clientY }); return; }
  if (!stick) { stick = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; stickEl.style.display = 'block'; stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px'; }
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
});
canvas.addEventListener('pointermove', e => {
  if (stick && e.pointerId === stick.id) {
    let dx = e.clientX - stick.x, dy = e.clientY - stick.y; const d = Math.hypot(dx, dy), m = 55;
    if (d > m) { dx *= m / d; dy *= m / d; }
    joy.x = dx / m; joy.y = dy / m; stickEl.firstChild.style.transform = `translate(${dx}px,${dy}px)`;
    stick.moved = stick.moved || d > 10;
  }
});
const endStick = e => {
  if (stick && e.pointerId === stick.id) {
    if (!stick.moved && performance.now() - stick.t < 250) cast({ x: stick.x, y: stick.y }); // quick tap = cast there
    stick = null; joy.x = joy.y = 0; stickEl.style.display = 'none'; stickEl.firstChild.style.transform = '';
  }
};
canvas.addEventListener('pointerup', endStick); canvas.addEventListener('pointercancel', endStick);
$('cast').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); cast(null); });
$('bWx').onclick = () => setWx((wxIdx + 1) % WX.length);
$('bSp').onclick = () => { P.spell = (P.spell + 1) % SP.length; hud(); };
$('bAscii').onclick = () => setView(!asciiOn, detail);
$('bDet').onclick = () => setView(asciiOn, (detail + 1) % 3);
function setView(a, d) {
  asciiOn = a; detail = d; resize(); viewBtns();
  toast(asciiOn ? 'ASCII · ' + DETAIL.names[detail] : 'без ASCII');
  try { localStorage.setItem('ascii-view', JSON.stringify({ ascii: asciiOn, detail })); } catch (_) { }
}
function viewBtns() { $('bAscii').textContent = asciiOn ? '▦ ASCII: вкл' : '▦ ASCII: выкл'; $('bDet').textContent = '◫ ' + DETAIL.names[detail]; $('bDet').style.display = asciiOn ? '' : 'none'; }
canvas.addEventListener('contextmenu', e => e.preventDefault());
function setWx(i) { wxIdx = i; if (zone === 'forest') toast(WX[i].n); hud(); }

/* ---------- spells ---------- */
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.9), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const projGeo = new THREE.IcosahedronGeometry(.2, 0);
const projMats = SP.map(s => stdMat({ color: [0, 0, 0], emis: s.c.map(v => v * 1.3) }));
function screenToWorld(x, y, out) {
  const nx = x / (cols * cellW) * 2 - 1, ny = (H - y) / (rows * cellH) * 2 - 1;
  ray.setFromCamera({ x: nx, y: ny }, camera);
  return ray.ray.intersectPlane(plane, out);
}
function cast(target) {
  if (P.cd > 0 || fadeDir) return;
  P.cd = .38;
  let dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
  if (target && screenToWorld(target.x, target.y, tmpV)) {
    dx = tmpV.x - P.x; dz = tmpV.z - P.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    P.yaw = Math.atan2(dx, dz); hero.g.rotation.y = P.yaw;
  }
  hero.cast = .3;
  fireSpell(hero, P, dx, dz, P.spell, true);
}
function fireSpell(ch, o, dx, dz, si, mine) {
  ch.g.updateMatrixWorld(true);
  const ob = orbWorld(ch, new THREE.Vector3());
  const m = new THREE.Mesh(projGeo, projMats[si]); m.position.copy(ob); scene.add(m);
  projs.push({ m, x: ob.x, y: Math.max(ob.y, 1.1), z: ob.z, vx: dx * 15, vz: dz * 15, life: 1.3, sp: si, mine });
  // sigil: rune ring around the caster
  const c = SP[si].c, center = { x: o.x, z: o.z };
  for (let i = 0; i < 22; i++) emit({ x: 0, y: .15 + rnd() * .2, z: 0, vy: .9 + rnd() * .6, orbit: { c: center, a: i / 22 * TAU, w: 2.6, r: .9, dr: 1.1 }, r: c[0], g: c[1], b: c[2], size: .09, life: .75, mode: RUNEM });
  for (let i = 0; i < 10; i++) emit({ x: ob.x, y: ob.y, z: ob.z, vx: (rnd() - .5) * 3, vy: rnd() * 2, vz: (rnd() - .5) * 3, r: c[0], g: c[1], b: c[2], size: .06, life: .35, drag: 3 });
}
function burst(x, y, z, si, n) {
  const c = SP[si].c;
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, e = (rnd() - .3) * 1.4, s = 2 + rnd() * 6;
    emit({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 1, vz: Math.sin(a) * Math.cos(e) * s, r: c[0], g: c[1], b: c[2], size: .08 + rnd() * .05, life: .5 + rnd() * .5, drag: 2.5, grav: 3, mode: rnd() < .6 ? RUNEM : 1 });
  }
}

/* ---------- zone switching ---------- */
function startTransition(to) { if (!fadeDir) { fadeDir = 1; fadeTo = to; } }
function enterZone(z) {
  zone = z; parts.length = 0;
  for (const p of projs) scene.remove(p.m); projs.length = 0;
  forest.visible = z === 'forest'; dungeon.visible = z === 'dungeon';
  NPCS.forEach(n => { n.tag.style.display = z === 'forest' ? '' : 'none'; });
  if (z === 'dungeon') {
    P.x = D.start.x; P.z = D.start.z; P.yaw = Math.PI; toast('Глубины руин');
    Object.assign(Wc, { rain: 0, snow: 0, storm: 0, wind: 0 });
    D.monsters.forEach(m => { m.alive = true; m.g.visible = true; m.g.position.set(m.hx, 0, m.hz); });
  } else { P.x = DOOR.x; P.z = DOOR.z + 2.2; P.yaw = 0; toast('Шепчущий лес'); }
  focus.set(P.x, 0, P.z); hud();
}

/* ---------- lights ---------- */
const cand = [];
function L(x, y, z, r, cr, cg, cb) { cand.push([x, y, z, r, cr, cg, cb, 0]); }
const flick = (s, sp = 7) => .82 + .25 * vn(T * sp + s * 13.1, s) + .08 * Math.sin(T * 23 + s);
function pushLights() {
  for (const c of cand) { const dx = c[0] - P.x, dz = c[2] - P.z; c[7] = dx * dx + dz * dz - c[3] * c[3] * .5; }
  cand.sort((a, b) => a[7] - b[7]);
  const n = Math.min(MAXL, cand.length);
  for (let i = 0; i < n; i++) { const c = cand[i]; U.uLP.value[i].set(c[0], c[1], c[2]); U.uLC.value[i].set(c[4], c[5], c[6]); U.uLR.value[i] = c[3]; }
  U.uNL.value = n; cand.length = 0;
}

/* ---------- update ---------- */
function turn(a, b, k) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; }
const emitAcc = { v: 0 };
function update(dt) {
  T += dt; U.uTime.value = T;
  P.cd -= dt; P.sayT -= dt; P.inv -= dt; P.hurt -= dt;
  if (fadeDir === 1) { fadeV += dt * 2.5; if (fadeV >= 1) { fadeV = 1; enterZone(fadeTo); fadeDir = -1; } }
  else if (fadeDir === -1) { fadeV -= dt * 1.8; if (fadeV <= 0) { fadeV = 0; fadeDir = 0; } }
  fadeEl.style.opacity = fadeV;

  /* movement (camera-relative: up = away from camera) */
  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x,
    mz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + joy.y;
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  const run = keys.ShiftLeft || keys.ShiftRight || ml > .95 && (joy.x || joy.y);
  const spd = (run ? 6.2 : 3.6) * (fadeDir ? 0 : 1);
  const moving = ml > .12 && !chatOpen && !fadeDir;
  if (moving) {
    tryMove(P, mx * spd * dt, mz * spd * dt);
    P.yaw = turn(P.yaw, Math.atan2(mx, mz), 1 - Math.exp(-dt * 14));
    if (zone === 'forest' && rnd() < dt * 6) emit({ x: P.x + (rnd() - .5) * .4, y: .05, z: P.z + (rnd() - .5) * .4, vy: .6, r: .25, g: .3, b: .22, size: .05, life: .4 });
  }
  hero.g.position.set(P.x, 0, P.z); hero.g.rotation.y = P.yaw;
  animChar(hero, dt, moving, spd);
  U.uPlayer.value.set(P.x, 0, P.z);

  /* zone triggers */
  if (!fadeDir) {
    if (zone === 'forest' && Math.abs(P.x - DOOR.x) < 1.1 && P.z < DOOR.z - .5 && P.z > BLD.z0) startTransition('dungeon');
    if (zone === 'dungeon' && Math.hypot(P.x - D.exit.x, P.z - D.exit.z) < .8) startTransition('forest');
  }

  /* camera */
  const fk = 1 - Math.exp(-dt * 4.5);
  focus.x = lerp(focus.x, P.x, fk); focus.z = lerp(focus.z, P.z, fk);
  U.uFocus.value.copy(focus);
  const aspect = (cols * cellW) / (rows * cellH);
  const dist = aspect < 1 ? 11 + (1 - aspect) * 4.5 : 10.5, pitch = .9;
  camera.position.set(focus.x, Math.sin(pitch) * dist + .8, focus.z + Math.cos(pitch) * dist);
  camera.lookAt(focus.x, 1.1, focus.z);
  ground.position.set(Math.round(focus.x), 0, Math.round(focus.z));

  /* weather */
  const tg = zone === 'forest' ? WX[wxIdx] : DUN_WX, wk = zone === 'dungeon' ? 1 : 1 - Math.exp(-dt * 1.2);
  for (const k of ['rain', 'snow', 'fog', 'wind', 'storm']) Wc[k] = lerp(Wc[k], tg[k], wk);
  for (const k of ['amb', 'moon', 'fogc']) for (let i = 0; i < 3; i++) Wc[k][i] = lerp(Wc[k][i], tg[k][i], wk);
  if (zone === 'forest' && Wc.storm > .5) { flashT -= dt; if (flashT <= 0) { flash = 1; flash2 = .16; flashT = 2.5 + rnd() * 7; } }
  if (flash2 > 0) { flash2 -= dt; if (flash2 <= 0) flash = Math.max(flash, .7); }
  flash = Math.max(0, flash - dt * 2.6);
  const fl = flash * flash;
  U.uAmb.value.setRGB(Wc.amb[0] + fl * .25, Wc.amb[1] + fl * .28, Wc.amb[2] + fl * .4);
  U.uMoonCol.value.setRGB(Wc.moon[0] + fl * .7, Wc.moon[1] + fl * .75, Wc.moon[2] + fl * .9);
  U.uFogCol.value.setRGB(...Wc.fogc); U.uFogD.value = Wc.fog;
  U.uWindS.value = Wc.wind;
  const wa = -2.6 + Math.sin(T * .05) * .3; U.uWind.value.set(Math.cos(wa), Math.sin(wa) * .5).normalize();
  rain.geo.instanceCount = zone === 'forest' ? Math.floor(RAIN_MAX * Wc.rain * quality) : 0;
  rain.mat.uniforms.uFlash.value = fl;
  snow.geo.instanceCount = zone === 'forest' ? Math.floor(SNOW_MAX * Wc.snow) : 0;

  /* emitters */
  emitAcc.v += dt * 60; const ne = Math.floor(emitAcc.v); emitAcc.v -= ne;
  if (zone === 'forest') {
    const ff = flick(5, 9);
    L(CAMP.x, .9, CAMP.z, 8.5, 1.4 * ff, .7 * ff, .25 * ff);
    for (let i = 0; i < ne; i++) {
      const hot = rnd();
      emit({ x: CAMP.x + (rnd() - .5) * .5, y: .15, z: CAMP.z + (rnd() - .5) * .5, vx: U.uWind.value.x * Wc.wind * .6 + (rnd() - .5) * .3, vy: 1.4 + rnd() * 1.3, vz: (rnd() - .5) * .3, r: 2.6, g: .9 + hot * 1.2, b: .2 + hot * .2, size: .09 + rnd() * .1, life: .45 + rnd() * .4, shrink: 1 });
      if (rnd() < .15) emit({ x: CAMP.x, y: .5, z: CAMP.z, vx: (rnd() - .5) * 1.2, vy: 2 + rnd() * 2, vz: (rnd() - .5) * 1.2, r: 2.5, g: 1.3, b: .3, size: .035, life: 1.2 + rnd(), drag: .5 });
    }
    torchPos.forEach((t, j) => {
      const f = flick(j + 7, 9); L(t.x, t.y + .2, t.z, 6, 1.2 * f, .62 * f, .22 * f);
      for (let i = 0; i < Math.ceil(ne / 2); i++) emit({ x: t.x + (rnd() - .5) * .2, y: t.y, z: t.z + (rnd() - .5) * .2, vy: 1 + rnd(), vx: U.uWind.value.x * Wc.wind * .4, r: 2.4, g: 1.1, b: .3, size: .06 + rnd() * .05, life: .35 + rnd() * .3, shrink: 1 });
    });
    L(DOOR.x, 1.2, DOOR.z - 1.2, 4, .1, .45, .2);
    if (rnd() < dt * 8) emit({ x: DOOR.x + (rnd() - .5) * 1.6, y: .3 + rnd() * 1.8, z: DOOR.z - .4, vz: .5 + rnd() * .5, vy: .2, r: .3, g: 1.6, b: .6, size: .07, life: 1.2, mode: RUNEM });
    // fireflies on calm nights
    if (Wc.rain < .2 && Wc.snow < .2 && rnd() < dt * 3) {
      emit({ x: focus.x + (rnd() - .5) * 22, y: .3 + rnd() * 1.2, z: focus.z + (rnd() - .5) * 16, vx: (rnd() - .5) * .4, vy: (rnd() - .3) * .2, vz: (rnd() - .5) * .4, r: 1.6, g: 2, b: .5, size: .05, life: 3 + rnd() * 2 });
    }
    // rain splashes
    const ns = Wc.rain * dt * 90;
    for (let i = 0; i < Math.floor(ns) + (rnd() < ns % 1 ? 1 : 0); i++)
      emit({ x: focus.x + (rnd() - .5) * 26, y: .04, z: focus.z + (rnd() - .5) * 20, r: .45, g: .55, b: .7, size: .03, grow: 2.5, life: .28 });
  } else {
    D.braziers.forEach((b, j) => {
      if (Math.abs(b.x - P.x) > 26 || Math.abs(b.z - P.z) > 26) return;
      const f = flick(j + 20, 9); L(b.x, b.y + .3, b.z, 6, 1.1 * f, .55 * f, .18 * f);
      for (let i = 0; i < Math.ceil(ne / 2); i++) emit({ x: b.x + (rnd() - .5) * .3, y: b.y, z: b.z + (rnd() - .5) * .3, vy: 1.1 + rnd(), r: 2.4, g: 1.1, b: .3, size: .07 + rnd() * .05, life: .35 + rnd() * .3, shrink: 1 });
    });
    if (rnd() < dt * 6) emit({ x: D.exit.x + (rnd() - .5) * 1.2, y: .1, z: D.exit.z + (rnd() - .5) * 1.2, vy: .8, r: .3, g: 1.4, b: .5, size: .07, life: 1.2, mode: RUNEM });
  }
  /* hero lantern (staff orb) */
  hero.g.updateMatrixWorld(true);
  const ob = orbWorld(hero, tmpV2), lf = flick(1, 8);
  const dun = zone === 'dungeon';
  if (dun) { hero.mOrb.uniforms.uEmis.value.setRGB(1.1, 2.2, .5); L(ob.x, ob.y + .4, ob.z, 9, 1.05 * lf, 1.55 * lf, .45 * lf); }
  else { hero.mOrb.uniforms.uEmis.value.setRGB(2.2, 1.4, .6); L(ob.x, ob.y + .4, ob.z, 7, .85 * lf, .58 * lf, .32 * lf); }
  if (rnd() < dt * 14) emit({ x: ob.x + (rnd() - .5) * .15, y: ob.y, z: ob.z + (rnd() - .5) * .15, vy: .7, r: dun ? 1 : 2, g: dun ? 2 : 1.3, b: .5, size: .035, life: .6 });

  /* NPCs */
  if (zone === 'forest') for (const n of NPCS) {
    n.wait -= dt; n.mv = false;
    if (n.wait <= 0) {
      const dx = n.tx - n.x, dz = n.tz - n.z, d = Math.hypot(dx, dz);
      if (d < .6) { const a = rnd() * TAU, r = 3 + rnd() * 9; n.tx = CAMP.x + Math.cos(a) * r; n.tz = CAMP.z + Math.sin(a) * r * .8; n.wait = 1 + rnd() * 4; }
      else {
        n.mv = true;
        if (!tryMove(n, dx / d * 2.4 * dt, dz / d * 2.4 * dt)) { n.tx = n.x + (rnd() - .5) * 6; n.tz = n.z + (rnd() - .5) * 6; n.wait = .3; }
        n.yaw = turn(n.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 8));
      }
    }
    n.c.g.position.set(n.x, 0, n.z); n.c.g.rotation.y = n.yaw;
    animChar(n.c, dt, n.mv, 2.4);
    n.sayT -= dt; n.cd -= dt; n.talk -= dt;
    if (n.cd <= 0) {
      n.cd = 6 + rnd() * 9; const a = rnd() * TAU; n.yaw = Math.atan2(Math.cos(a), Math.sin(a)); n.c.g.rotation.y = n.yaw; n.c.cast = .3;
      fireSpell(n.c, n, Math.sin(n.yaw), Math.cos(n.yaw), n.sp, false);
    }
    if (n.talk <= 0) { n.talk = 14 + rnd() * 25; n.say = LINES[rnd() * LINES.length | 0]; n.sayT = 5; say(n.name, n.say, n.col); }
    n.c.g.updateMatrixWorld(true);
    const o2 = orbWorld(n.c, tmpV); const c = SP[n.sp].c; L(o2.x, o2.y, o2.z, 3.5, c[0] * .35, c[1] * .35, c[2] * .35);
  }

  /* monsters */
  if (dun) for (const m of D.monsters) {
    if (!m.alive) { m.rt -= dt; if (m.rt <= 0) { m.alive = true; m.g.visible = true; m.g.position.set(m.hx, 0, m.hz); } continue; }
    const p = m.g.position, dx = P.x - p.x, dz = P.z - p.z, d = Math.hypot(dx, dz);
    const o = { x: p.x, z: p.z };
    if (d < 14) tryMove(o, dx / d * 1.7 * dt, dz / d * 1.7 * dt);
    else tryMove(o, (m.hx + Math.sin(T * .4 + m.ph) * 2 - p.x) * .5 * dt, (m.hz + Math.cos(T * .3 + m.ph) * 2 - p.z) * .5 * dt);
    p.x = o.x; p.z = o.z; p.y = Math.abs(Math.sin(T * 3 + m.ph)) * .08;
    m.g.rotation.y = Math.atan2(dx, dz);
    m.eyes.scale.y = Math.sin(T * .9 + m.ph * 3) > .96 ? .1 : 1;
    if (d < 1.1 && P.inv <= 0 && !fadeDir) {
      P.hp--; P.inv = 1.1; P.hurt = .3; hud();
      if (P.hp <= 0) { P.hp = 5; toast('Вы погибли'); startTransition('dungeon'); }
    }
    
  }

  /* projectiles */
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]; p.life -= dt;
    const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    let hit = p.life <= 0 || solid(nx, nz, .05);
    if (!hit && dun && p.mine) for (const m of D.monsters) {
      if (m.alive && Math.hypot(m.g.position.x - nx, m.g.position.z - nz) < .8) {
        m.alive = false; m.g.visible = false; m.rt = 15; hit = true; burst(m.g.position.x, 1, m.g.position.z, p.sp, 60);
      }
    }
    if (hit) { burst(p.x, p.y, p.z, p.sp, 36); scene.remove(p.m); projs.splice(i, 1); continue; }
    p.x = nx; p.z = nz; p.m.position.set(p.x, p.y + Math.sin(T * 20) * .03, p.z); p.m.rotation.y += dt * 9;
    const c = SP[p.sp].c; L(p.x, p.y, p.z, 6, c[0] * .7, c[1] * .7, c[2] * .7);
    for (let k = 0; k < 3; k++) emit({ x: p.x + (rnd() - .5) * .3, y: p.y + (rnd() - .5) * .3, z: p.z + (rnd() - .5) * .3, vx: (rnd() - .5) * .8, vy: (rnd() - .5) * .8, vz: (rnd() - .5) * .8, r: c[0], g: c[1], b: c[2], size: .08, life: .3 + rnd() * .3, mode: k ? RUNEM : 1 });
  }

  updateParts(dt);
  pushLights();
  hero.g.visible = true;
}

/* ---------- name tags ---------- */
const tagV = new THREE.Vector3();
function placeTag(el, x, y, z, sayT, txt) {
  tagV.set(x, y, z).project(camera);
  const sx = (tagV.x * .5 + .5) * cols * cellW, sy = H - (tagV.y * .5 + .5) * rows * cellH;
  el.style.transform = `translate(${sx | 0}px,${sy | 0}px) translate(-50%,-100%)`;
  const sp = el.firstChild;
  if (sayT > 0) { if (sp.textContent !== txt) sp.textContent = txt; sp.classList.add('on'); } else sp.classList.remove('on');
}

/* ---------- post-processing ---------- */
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; postScene.add(quad);
const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;
const cellMat = new THREE.ShaderMaterial({
  defines: { SX, SY },
  uniforms: { tScene: { value: null }, uR: { value: RAMP.length }, uDir: { value: RAMP.length }, uRune: { value: RAMP.length + 4 }, uRuneN: { value: RUNE.length }, uTime: U.uTime },
  vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  fragmentShader: /* glsl */`
  uniform sampler2D tScene; uniform float uR, uDir, uRune, uRuneN, uTime;
  void main(){
    ivec2 cell = ivec2(gl_FragCoord.xy);
    ivec2 b = cell*ivec2(SX,SY);
    vec3 sum = vec3(0.); float bl = -1.; vec4 best = vec4(0.);
    for(int j=0;j<SY;j++) for(int i=0;i<SX;i++){
      vec4 t = texelFetch(tScene, b+ivec2(i,j), 0);
      sum += t.rgb; float l = dot(t.rgb, vec3(.3,.59,.11));
      if(l>bl){ bl=l; best=t; }
    }
    vec3 avg = sum/float(SX*SY);
    float lum = dot(avg, vec3(.3,.59,.11));
    float g; vec3 col;
    if(best.a > .95){
      float k = clamp(lum*1.6, 0., 1.);
      g = floor(pow(k,1.15)*(uR-1.)+.5); col = mix(avg, best.rgb, .55);
    } else if(best.a > .09){
      float a = (best.a-.1)/.8;
      g = uDir + mod(floor(a*4.+.5), 4.);
      col = best.rgb;
    } else {
      float h = fract(sin(dot(vec2(cell)+floor(uTime*9.), vec2(12.9898,78.233)))*43758.5453);
      g = uRune + floor(h*uRuneN); col = best.rgb;
    }
    if(bl < .014) g = 0.;
    float m = max(max(col.r,col.g),col.b);
    vec3 cc = m > 0. ? col/m * min(1.15, .22 + m*1.5) : col;
    gl_FragColor = vec4(min(cc,vec3(1.)), g/255.);
  }`,
});
const brightMat = new THREE.ShaderMaterial({
  uniforms: { tScene: { value: null }, uTh: { value: canHalf ? 1.0 : .82 } }, vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tScene; uniform float uTh; varying vec2 vUv;
  void main(){ vec3 c = texture2D(tScene, vUv).rgb; float l = max(max(c.r,c.g),c.b); gl_FragColor = vec4(c*smoothstep(uTh, uTh+.6, l), 1.); }`,
});
const blurMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
  void main(){
    vec3 c = texture2D(tSrc,vUv).rgb*.227;
    c += (texture2D(tSrc,vUv+uDir*1.385).rgb + texture2D(tSrc,vUv-uDir*1.385).rgb)*.316;
    c += (texture2D(tSrc,vUv+uDir*3.23).rgb + texture2D(tSrc,vUv-uDir*3.23).rgb)*.07;
    gl_FragColor = vec4(c,1.);
  }`,
});
const finalMat = new THREE.ShaderMaterial({
  uniforms: { tCell: { value: null }, tRaw: { value: null }, uRaw: { value: 0 }, tAtlas: { value: atlas }, tBloom: { value: null }, uCellPx: { value: new THREE.Vector2() }, uGridPx: { value: new THREE.Vector2() }, uGlyphN: { value: GLYPHS.length }, uBloomK: { value: 1.1 } },
  vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  fragmentShader: /* glsl */`
  uniform sampler2D tCell, tAtlas, tBloom, tRaw; uniform vec2 uCellPx, uGridPx; uniform float uGlyphN, uBloomK, uRaw;
  void main(){
    vec2 fc = gl_FragCoord.xy, cf = fc/uCellPx;
    if(uRaw > .5){
      vec3 r = texture2D(tRaw, fc/uGridPx).rgb*2.2 + texture2D(tBloom, fc/uGridPx).rgb*uBloomK*.8;
      r = 1. - exp(-r*1.6);
      gl_FragColor = vec4(pow(r, vec3(.8)), 1.);
      return;
    }
    ivec2 cell = ivec2(floor(cf)); vec2 lc = fract(cf);
    vec4 cv = texelFetch(tCell, cell, 0);
    float g = floor(cv.a*255.+.5);
    float m = 0.;
    if(g > 0.){
      vec2 uv = vec2((g+lc.x)/uGlyphN, lc.y);
      m = textureGrad(tAtlas, uv, vec2(1./(uCellPx.x*uGlyphN),0.), vec2(0.,1./uCellPx.y)).r;
    }
    vec3 bloom = texture2D(tBloom, fc/uGridPx).rgb;
    vec3 c = vec3(.018,.018,.035) + cv.rgb*m + bloom*uBloomK;
    gl_FragColor = vec4(c, 1.);
  }`,
});
function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(postScene, postCam); }

function makeRT(w, h, opts) { return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), Object.assign({ depthBuffer: false }, opts)); }
function resize() {
  W = innerWidth; H = innerHeight;
  DPR = Math.min(2, devicePixelRatio || 1) * (quality < 1 ? .75 : 1);
  renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
  const small = Math.min(W, H) < 600;
  cellW = (small ? DETAIL.small : DETAIL.big)[detail]; cellH = Math.round(cellW * 1.75);
  cols = Math.ceil(W / cellW); rows = Math.ceil(H / cellH);
  [sceneRT, cellRT, bA, bB, rawRT].forEach(r => r && r.dispose()); rawRT = null;
  sceneRT = makeRT(cols * SX, rows * SY, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType });
  cellRT = makeRT(cols, rows, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const bw = Math.ceil(cols * SX / 3), bh = Math.ceil(rows * SY / 3);
  bA = makeRT(bw, bh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType });
  bB = makeRT(bw, bh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType });
  camera.aspect = (cols * cellW) / (rows * cellH);
  camera.fov = camera.aspect < 1 ? 40 : 34;
  camera.updateProjectionMatrix();
  U.uRes.value.set(cols * cellW, rows * cellH);
  finalMat.uniforms.uCellPx.value.set(cellW * DPR, cellH * DPR);
  finalMat.uniforms.uGridPx.value.set(cols * cellW * DPR, rows * cellH * DPR);
  grass.geo.instanceCount = Math.floor(grass.N * (small ? .55 : 1) * quality);
  if (!asciiOn) {
    const rs = Math.min(1, 1.6 / DPR);
    rawRT = makeRT(Math.round(cols * cellW * DPR * rs), Math.round(rows * cellH * DPR * rs), { depthBuffer: true, samples: 4, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType });
  }
  finalMat.uniforms.uRaw.value = asciiOn ? 0 : 1;
}
addEventListener('resize', resize);

function render() {
  if (asciiOn) {
    renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
    cellMat.uniforms.tScene.value = sceneRT.texture; pass(cellMat, cellRT);
    brightMat.uniforms.tScene.value = sceneRT.texture; pass(brightMat, bA);
  } else {
    renderer.setRenderTarget(rawRT); renderer.render(scene, camera);
    brightMat.uniforms.tScene.value = rawRT.texture; pass(brightMat, bA);
    finalMat.uniforms.tRaw.value = rawRT.texture;
  }
  const bw = bA.width, bh = bA.height;
  for (let i = 0; i < 2; i++) {
    blurMat.uniforms.tSrc.value = bA.texture; blurMat.uniforms.uDir.value.set((1 + i) / bw, 0); pass(blurMat, bB);
    blurMat.uniforms.tSrc.value = bB.texture; blurMat.uniforms.uDir.value.set(0, (1 + i) / bh); pass(blurMat, bA);
  }
  finalMat.uniforms.tCell.value = cellRT.texture; finalMat.uniforms.tBloom.value = bA.texture; pass(finalMat, null);
  // tags
  placeTag(P.tag, P.x, 2.75, P.z, P.sayT, P.say);
  if (zone === 'forest') for (const n of NPCS) placeTag(n.tag, n.x, 2.75, n.z, n.sayT, n.say);
}

/* ---------- loop with simple adaptive quality ---------- */
let last = performance.now(), perfT = 0, perfN = 0, perfSum = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, .05); last = now;
  update(dt); render();
  if (quality === 1 && T > 2) {
    perfT += dt; perfN++; perfSum += dt;
    if (perfT > 3) { if (perfSum / perfN > .034) { quality = .55; resize(); } perfT = perfN = perfSum = 0; if (T > 12) perfT = -1e9; }
  }
  requestAnimationFrame(frame);
}
resize(); hud(); viewBtns(); toast('Шепчущий лес');
say('Система', 'добро пожаловать в Шепчущий лес. Руины — по тропе вправо.', '#9ab');
window.__game = { P, setWx, enter: z => enterZone(z), cast: () => cast(null), get zone() { return zone; } };
requestAnimationFrame(frame);
