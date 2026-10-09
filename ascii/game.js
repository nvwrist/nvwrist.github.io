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
addEventListener('error', e => { const t = document.getElementById('toast'); if (t) { t.style.fontSize = '14px'; t.style.whiteSpace = 'normal'; t.textContent = 'Ошибка: ' + (e.message || e.error); t.style.opacity = 1; } });

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

const SX = 3, SY = 6;                         // scene texels per glyph cell (3×3 sub-zones of 1×2 texels)
let W, H, DPR, cellW, cellH, cols, rows, quality = 1, asciiOn = true, detail = 1, rawRT = null;
const DETAIL = { big: [11, 9, 7, 5], small: [10, 8.5, 7, 5], names: ['крупно', 'средне', 'мелко', 'ультра'] };
try { const v = JSON.parse(localStorage.getItem('ascii-view2') || '{}'); if (typeof v.ascii === 'boolean') asciiOn = v.ascii; if (v.detail >= 0 && v.detail <= 3) detail = v.detail; } catch (_) { }
let sceneRT, cellRT, auxRT, bA, bB;

/* ---------- glyph atlas ---------- */
// Shape glyphs = all printable ASCII. Each glyph gets a 3×3 coverage descriptor;
// the cell pass picks the glyph whose shape best matches the 3×3 luminance of the
// scene under the cell, so edges follow contours instead of only density.
const SHAPES = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const DIRG = "-/|\\";
const RUNE = "[]dbQUo(){}<>cpq";
const GLYPHS = SHAPES + DIRG;
const RUNE_IDX = [...RUNE].map(c => SHAPES.indexOf(c));
const RAMP = " .,:;~-=+ioxcvzuwdbpqQO0&%$#8@";            // flat areas: density
const EDGE = "_-/\\|()'`,.^";        // contours: matched by 3×3 shape
const RAMP_IDX = [...RAMP].map(c => SHAPES.indexOf(c)), EDGE_IDX = [...EDGE].map(c => SHAPES.indexOf(c));
// glyph font: JetBrains Mono (OFL), vendored; falls back to system monospace if it fails to load
const MONO = '"AsciiMono","DejaVu Sans Mono",Menlo,Consolas,"Liberation Mono",monospace';
try {
  const ff = new FontFace('AsciiMono', 'url(./vendor/jetbrains-mono-latin-500-normal.woff2)');
  await Promise.race([ff.load().then(f => document.fonts.add(f)), new Promise(r => setTimeout(r, 2500))]);
} catch (_) { }
const { atlas, desc } = (() => {
  const gw = 40, gh = 70, c = document.createElement('canvas');
  c.width = GLYPHS.length * gw; c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  g.font = `${Math.round(gh * .74)}px ${MONO}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < GLYPHS.length; i++) {
    const ch = GLYPHS[i], x0 = i * gw;
    if (i >= SHAPES.length) {
      // directional strokes: long thin lines, like blades of grass / rain
      g.lineWidth = 3.6; g.lineCap = 'round'; g.beginPath();
      const k = i - SHAPES.length, m = 6;
      if (k === 0) { g.moveTo(x0 + m, gh / 2); g.lineTo(x0 + gw - m, gh / 2); }
      if (k === 1) { g.moveTo(x0 + m, gh - m); g.lineTo(x0 + gw - m, m); }
      if (k === 2) { g.moveTo(x0 + gw / 2, m); g.lineTo(x0 + gw / 2, gh - m); }
      if (k === 3) { g.moveTo(x0 + m, m); g.lineTo(x0 + gw - m, gh - m); }
      g.stroke();
    } else g.fillText(ch, x0 + gw / 2, gh * .54);
  }
  // 3×3 coverage per shape glyph (row 0 = top)
  const px = g.getImageData(0, 0, c.width, gh).data, N = SHAPES.length, d = new Float32Array(N * 3 * 4);
  let mx = 1e-6;
  for (let i = 0; i < N; i++) for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) {
    const xa = i * gw + Math.round(q * gw / 3), xb = i * gw + Math.round((q + 1) * gw / 3), ya = Math.round(r * gh / 3), yb = Math.round((r + 1) * gh / 3);
    let sum = 0; for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) sum += px[(y * c.width + x) * 4];
    const v = sum / ((xb - xa) * (yb - ya) * 255); d[(r * N + i) * 4 + q] = v; if (v > mx) mx = v;
  }
  for (let k = 0; k < d.length; k++) if (k % 4 !== 3) d[k] /= mx;
  const desc = new THREE.DataTexture(d, N, 3, THREE.RGBAFormat, THREE.FloatType);
  desc.minFilter = desc.magFilter = THREE.NearestFilter; desc.needsUpdate = true;
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  return { atlas: t, desc };
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
  uWet: { value: 0 },
  uPN: { value: new THREE.Vector3(0, 0, 1e9) },
};
const COMMON = /* glsl */`
uniform float uTime; uniform vec3 uAmb; uniform vec3 uMoonDir; uniform vec3 uMoonCol;
uniform vec3 uLP[${MAXL}]; uniform vec3 uLC[${MAXL}]; uniform float uLR[${MAXL}]; uniform int uNL;
uniform vec3 uFogCol; uniform float uFogD; uniform vec2 uWind; uniform float uWindS;
uniform vec3 uPlayer; uniform vec3 uFocus; uniform vec2 uRes; uniform float uWet; uniform vec3 uPN;
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
    float mort = step(b.x,.14)+step(b.y,.14);
    base *= mort>0. ? .0 : (.85+.5*noise(vP.xz*2.1));
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
    vec3 stone = vec3(.24,.23,.21)*(.45+.7*hash(cid))*(.1+.9*st)*(.8+.4*noise(vP.xz*6.));
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

/* =========== props: the editable layer of the map (trees, rocks, walls, torches…) ===========
   The map is plain data ({props, items}) so the editor, saves and — later — the server can share it. */
const PROP = {
  tree:  { name: 'Дерево', icon: '🌲', r: .45, snap: 0 },
  bush:  { name: 'Куст',   icon: '🌿', r: .45, snap: 0 },
  rock:  { name: 'Камень', icon: '🪨', r: .55, snap: 0 },
  wall:  { name: 'Стена',  icon: '🧱', box: .5, snap: 1 },
  crate: { name: 'Ящик',   icon: '📦', box: .4, snap: .5 },
  torch: { name: 'Факел',  icon: '🔥', r: .2, snap: 0 },
};
const propG = new THREE.Group(); forest.add(propG);
const propBoxes = [];
const PGEO = {
  trunk: new THREE.CylinderGeometry(.16, .26, 1, 6).translate(0, .5, 0),
  ico: new THREE.IcosahedronGeometry(1, 0),
  rock: new THREE.DodecahedronGeometry(1, 0),
  wall: new THREE.BoxGeometry(1, 1.7, 1).translate(0, .85, 0),
  crate: new THREE.BoxGeometry(.8, .8, .8).translate(0, .4, 0),
  post: new THREE.CylinderGeometry(.07, .09, 1.5, 5).translate(0, .75, 0),
  bowl: new THREE.CylinderGeometry(.22, .12, .2, 6).translate(0, 1.55, 0),
};
const PMAT = {
  trunk: stdMat({ color: [.5, .42, .34], pat: 3 }), leaf: stdMat({ color: [.8, .88, .82], pat: 3, sway: 1, rim: .6 }),
  bush: stdMat({ color: [.42, .62, .45], pat: 3, sway: 1 }), rock: stdMat({ color: [.42, .42, .4], pat: 3 }),
  wall: stdMat({ color: [.5, .5, .47], pat: 1 }), crate: stdMat({ color: [.55, .4, .25], pat: 3 }),
  post: stdMat({ color: [.3, .22, .15] }), bowl: stdMat({ color: [.25, .2, .16], emis: [.5, .2, .05] }),
};
// each type → list of [geometry, material, (prop, m4) => fill matrix]
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const PPARTS = {
  tree: [[PGEO.trunk, PMAT.trunk, (p, m) => m.compose(_v.set(p.x, 0, p.z), _q.identity(), _s.set(p.s, 2.2 * p.s, p.s))],
         [PGEO.ico, PMAT.leaf, (p, m) => m.compose(_v.set(p.x, 3.3 * p.s, p.z), _q.setFromEuler(_e.set(0, p.r, 0)), _s.set(1.7 * p.s, 1.35 * p.s, 1.7 * p.s))],
         [PGEO.ico, PMAT.leaf, (p, m) => m.compose(_v.set(p.x + .3 * p.s, 4.6 * p.s, p.z - .2 * p.s), _q.setFromEuler(_e.set(0, p.r, 0)), _s.set(1.1 * p.s, p.s, 1.1 * p.s))]],
  bush: [[PGEO.ico, PMAT.bush, (p, m) => m.compose(_v.set(p.x, .4 * p.s, p.z), _q.setFromEuler(_e.set(0, p.r, 0)), _s.set(.75 * p.s, .55 * p.s, .75 * p.s))]],
  rock: [[PGEO.rock, PMAT.rock, (p, m) => m.compose(_v.set(p.x, p.s * .35, p.z), _q.setFromEuler(_e.set(p.r * .7, p.r * 3, p.r * .4)), _s.set(p.s, p.s * .7, p.s))]],
  wall: [[PGEO.wall, PMAT.wall, (p, m) => m.compose(_v.set(p.x, 0, p.z), _q.identity(), _s.set(1, 1, 1))]],
  crate: [[PGEO.crate, PMAT.crate, (p, m) => m.compose(_v.set(p.x, 0, p.z), _q.setFromEuler(_e.set(0, p.r, 0)), _s.set(1, 1, 1))]],
  torch: [[PGEO.post, PMAT.post, (p, m) => m.makeTranslation(p.x, 0, p.z)], [PGEO.bowl, PMAT.bowl, (p, m) => m.makeTranslation(p.x, 0, p.z)]],
};
function defaultMap() {
  const props = [], items = [], R = mulberry(77);
  let id = 1;
  for (let gx = -120; gx <= 120; gx += 2.3) for (let gz = -120; gz <= 120; gz += 2.3) {
    const x = gx + (h2(gx * 10, gz * 10) - .5) * 2, z = gz + (h2(gz * 10 + 3, gx * 10) - .5) * 2;
    const d = fbm(x * .045 + 51, z * .045 + 12);
    if (h2(gx * 7 + 1, gz * 7) > (d - .47) * 3.4 + .06) continue;
    if (Math.abs(z - pathZ(x)) < 3.2 || Math.hypot(x - 1, z - 1) < 6.5) continue;
    if (x > BLD.x0 - 6 && x < BLD.x1 + 6 && z > BLD.z0 - 5 && z < BLD.z1 + 6) continue;
    props.push({ id: id++, t: 'tree', x: +x.toFixed(2), z: +z.toFixed(2), s: +(.75 + h2(gx, gz * 3) * .75).toFixed(2), r: +(h2(gz, gx) * TAU).toFixed(2) });
  }
  for (let i = 0; i < 260; i++) {
    const x = (R() - .5) * 220, z = (R() - .5) * 220, sc = .25 + R() * .55;
    if (Math.abs(z - pathZ(x)) < 2.4 || Math.hypot(x, z) < 6) continue;
    if (x > BLD.x0 - 2 && x < BLD.x1 + 2 && z > BLD.z0 - 2 && z < BLD.z1 + 3) continue;
    props.push({ id: id++, t: R() < .35 ? 'bush' : 'rock', x: +x.toFixed(2), z: +z.toFixed(2), s: +sc.toFixed(2) * 1.4, r: +(R() * TAU).toFixed(2) });
  }
  // loot around the clearing and along the path
  const loot = [['apple', 3, 4], ['stick', 2, 2], ['stone', 3, 2], ['mushroom', 3, 1], ['coin', 3, 7], ['herb', 2, 2], ['potion', 1, 1], ['crystal', 1, 1], ['apple', 4, 1], ['scroll', 1, 1]];
  loot.forEach(([d, k, n], j) => { for (let q = 0; q < k; q++) {
    const x = -4 + j * 3.6 + (R() - .5) * 3, z = pathZ(x) + (R() < .5 ? -1 : 1) * (2 + R() * 2.5);
    items.push({ uid: 'm' + j + '_' + q, d, n, x: +x.toFixed(2), z: +z.toFixed(2), zone: 'forest' });
  } });
  return { v: 1, nextId: id, props, items };
}
let MAP;
try { MAP = JSON.parse(localStorage.getItem('ascii-map-v1') || 'null'); } catch (_) { MAP = null; }
if (!MAP || MAP.v !== 1) MAP = defaultMap();
let staticCircles = null;
function rebuildProps() {
  if (!staticCircles) staticCircles = [...circles.values()].flat();
  for (const c of [...propG.children]) { propG.remove(c); c.dispose(); }
  circles.clear(); for (const c of staticCircles) addCircle(c.x, c.z, c.r);
  propBoxes.length = 0;
  const byT = {};
  for (const p of MAP.props) {
    (byT[p.t] ||= []).push(p);
    const def = PROP[p.t]; if (!def) continue;
    if (def.box) propBoxes.push({ x0: p.x - def.box, x1: p.x + def.box, z0: p.z - def.box, z1: p.z + def.box });
    else if (p.t !== 'bush' && !(p.t === 'rock' && p.s < .55)) addCircle(p.x, p.z, def.r * (p.t === 'torch' ? 1 : p.s * .8));
  }
  const m4 = new THREE.Matrix4();
  for (const t in byT) for (const [geo, mat, fill] of PPARTS[t] || []) {
    const list = byT[t], im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => { fill(p, m4); im.setMatrixAt(i, m4); });
    im.frustumCulled = false; propG.add(im);
  }
}
let mapSaveT = 0;
function saveMap() { clearTimeout(mapSaveT); mapSaveT = setTimeout(() => { try { localStorage.setItem('ascii-map-v1', JSON.stringify(MAP)); } catch (_) { toast('карта слишком большая для сохранения'); } }, 300); }

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
rebuildProps();


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
    uniforms: { ...U, uFlash: { value: 0 }, uRainH: { value: 1 } },
    vertexShader: COMMON + /* glsl */`
    attribute vec4 aO; uniform float uFlash; uniform float uRainH;
    varying float vAng; varying float vB; varying vec3 vP;
    void main(){
      vec2 c = uFocus.xz;
      float fall = 15. + aO.w*7.;
      float y = mod(aO.y - uTime*fall, 16.) * uRainH;
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
    fragmentShader: `varying vec2 vQ; void main(){ if(dot(vQ,vQ)>1.) discard; gl_FragColor = vec4(vec3(.85,.9,1.),.02); }`,
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
  for (const b of propBoxes) if (x > b.x0 - rad && x < b.x1 + rad && z > b.z0 - rad && z < b.z1 + rad) return true;
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
const hero = makeCharacter({ fill: [.16, .14, .12], rimK: 2.2 });
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
  zoneEl.lastChild.textContent = (zone === 'dungeon' ? 'тьма' : WX[wxIdx].n) + ' · ' + SP[P.spell].n;
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
  if (e.code === 'Space') { if (!ED.on) cast(null); e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'KeyF') pickUp();
  if (e.code === 'KeyI' || e.code === 'Tab') { toggleInv(); e.preventDefault(); }
  if (e.code === 'KeyB') setEditor(!ED.on);
  if (e.code === 'Escape') { toggleInv(false); if (ED.on) setEditor(false); }
  if (ED.on && (e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { $('edUndo').click(); e.preventDefault(); return; }
  if (e.code === 'KeyQ') { P.spell = (P.spell + 1) % SP.length; hud(); }
  if (e.code === 'KeyV') setView(!asciiOn, detail);
  if (e.code === 'KeyZ') setView(asciiOn, (detail + 1) % 4);
  if (/^Digit[1-5]$/.test(e.code)) setWx(+e.code[5] - 1);
});
function closeChat() { chatOpen = false; chatEl.style.display = 'none'; chatEl.blur(); }
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let stick = null; const stickEl = $('stick');
canvas.addEventListener('pointerdown', e => {
  if (ED.on) { edDown(e); try { canvas.setPointerCapture(e.pointerId); } catch (_) { } return; }
  if (e.pointerType === 'mouse') { cast({ x: e.clientX, y: e.clientY }); return; }
  if (!stick) { stick = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; stickEl.style.display = 'block'; stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px'; }
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
});
canvas.addEventListener('pointermove', e => {
  if (ED.on) { edMove(e); return; }
  if (stick && e.pointerId === stick.id) {
    let dx = e.clientX - stick.x, dy = e.clientY - stick.y; const d = Math.hypot(dx, dy), m = 55;
    if (d > m) { dx *= m / d; dy *= m / d; }
    joy.x = dx / m; joy.y = dy / m; stickEl.firstChild.style.transform = `translate(${dx}px,${dy}px)`;
    stick.moved = stick.moved || d > 10;
  }
});
const endStick = e => {
  if (ED.on) { edUp(e); return; }
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
$('bDet').onclick = () => setView(asciiOn, (detail + 1) % 4);
function setView(a, d) {
  asciiOn = a; detail = d; resize(); viewBtns();
  toast(asciiOn ? 'ASCII · ' + DETAIL.names[detail] : 'без ASCII');
  try { localStorage.setItem('ascii-view2', JSON.stringify({ ascii: asciiOn, detail })); } catch (_) { }
}
function viewBtns() { $('bAscii').textContent = asciiOn ? '▦ ASCII: вкл' : '▦ ASCII: выкл'; $('bDet').textContent = '◫ ' + DETAIL.names[detail]; $('bDet').style.display = asciiOn ? '' : 'none'; }
canvas.addEventListener('contextmenu', e => e.preventDefault());
function setWx(i) { wxIdx = i; if (zone !== 'dungeon') toast(WX[i].n); hud(); }

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
  if (P.cd > 0 || fadeDir || ED.on) return;
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


/* =========== items & inventory ===========
   Every change goes through act(cmd). In the MMO the same commands become network messages
   and the server replies with the authoritative result; here they are applied locally. */
const ITEMS = {
  apple:    { name: 'Яблоко', g: '%', c: '#e8725f', col: [.9, .25, .18], stack: 20, use: { hp: 1 }, desc: 'Восстанавливает 1 ♥' },
  potion:   { name: 'Зелье лечения', g: '!', c: '#ff7aa2', col: [.9, .2, .4], glow: 1, stack: 5, use: { hp: 5 }, desc: 'Полностью восстанавливает здоровье' },
  mushroom: { name: 'Гриб', g: 'T', c: '#d7a6ff', col: [.75, .45, .9], stack: 20, use: { hp: 1 }, desc: 'Съедобный… наверное. +1 ♥' },
  stick:    { name: 'Палка', g: '/', c: '#b48c5c', col: [.55, .4, .25], stack: 30, desc: 'Пригодится для крафта' },
  stone:    { name: 'Камень', g: '*', c: '#a9abb0', col: [.55, .55, .57], stack: 30, desc: 'Обычный камень' },
  herb:     { name: 'Целебная трава', g: '&', c: '#86df7f', col: [.35, .85, .35], stack: 30, desc: 'Ингредиент для зелий' },
  coin:     { name: 'Монета', g: '$', c: '#f3c552', col: [1, .75, .2], glow: 1, stack: 999, desc: 'Местная валюта' },
  crystal:  { name: 'Кристалл', g: '#', c: '#72e8ff', col: [.3, .9, 1], glow: 1, stack: 10, desc: 'Пульсирует магией' },
  scroll:   { name: 'Свиток', g: '?', c: '#eadfb8', col: [.9, .85, .7], stack: 5, desc: 'Древние руны. Пока не прочитать' },
};
const IGEO = {
  ball: new THREE.IcosahedronGeometry(.16, 1), bottle: new THREE.CylinderGeometry(.09, .13, .3, 7), cap: new THREE.ConeGeometry(.2, .16, 8),
  stem: new THREE.CylinderGeometry(.05, .06, .16, 6), stick: new THREE.CylinderGeometry(.035, .04, .8, 5), stone: new THREE.DodecahedronGeometry(.16, 0),
  coin: new THREE.CylinderGeometry(.14, .14, .04, 10), gem: new THREE.OctahedronGeometry(.17, 0), leaf: new THREE.ConeGeometry(.06, .34, 4),
  scroll: new THREE.CylinderGeometry(.07, .07, .42, 8),
};
const imatCache = {};
function imat(d) {
  if (imatCache[d]) return imatCache[d];
  const D = ITEMS[d];
  return imatCache[d] = stdMat({ color: D.col, rim: 1, emis: D.col.map(v => v * (D.glow ? 1.1 : .22)) });
}
function itemMesh(d) {
  const g = new THREE.Group(), m = imat(d), add = (geo, x = 0, y = 0, z = 0, rx = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); g.add(o); return o; };
  switch (d) {
    case 'apple': add(IGEO.ball); add(IGEO.stem, 0, .16, 0); break;
    case 'potion': add(IGEO.bottle); add(IGEO.stem, 0, .2, 0); break;
    case 'mushroom': add(IGEO.stem, 0, -.05, 0); add(IGEO.cap, 0, .08, 0); break;
    case 'stick': add(IGEO.stick, 0, -.05, 0, 0, Math.PI / 2 - .2); break;
    case 'stone': add(IGEO.stone); break;
    case 'herb': for (let k = 0; k < 3; k++) add(IGEO.leaf, Math.cos(k * 2.1) * .07, 0, Math.sin(k * 2.1) * .07, Math.cos(k * 2.1) * .35, Math.sin(k * 2.1) * .35); break;
    case 'coin': add(IGEO.coin, 0, 0, 0, Math.PI / 2); add(IGEO.coin, .12, -.08, .05); break;
    case 'crystal': add(IGEO.gem).scale.y = 1.6; break;
    case 'scroll': add(IGEO.scroll, 0, -.05, 0, 0, Math.PI / 2); break;
  }
  return g;
}
const itemsG = new THREE.Group(); scene.add(itemsG);
const INV_N = 20;
let inv = new Array(INV_N).fill(null), worldItems = [];
const SAVE_KEY = 'ascii-save-v1';
function spawnWorld(it) {
  const w = { ...it, g: itemMesh(it.d), ph: rnd() * 10, y: it.y ?? .25, vy: it.vy ?? 0, vx: it.vx ?? 0, vz: it.vz ?? 0 };
  delete w.vx0; w.g.position.set(w.x, w.y, w.z); w.g.visible = w.zone === zone; itemsG.add(w.g); worldItems.push(w); return w;
}
function removeWorld(w) { itemsG.remove(w.g); worldItems.splice(worldItems.indexOf(w), 1); }
function plainItem(w) { return { uid: w.uid, d: w.d, n: w.n, x: +w.x.toFixed(2), z: +w.z.toFixed(2), zone: w.zone }; }
let saveT = 0;
function saveGame() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, inv, items: worldItems.map(plainItem), hp: P.hp })); } catch (_) { } }, 250);
}
function loadGame() {
  let sv = null; try { sv = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (_) { }
  if (sv && sv.v === 1) { inv = (sv.inv || []).concat(new Array(INV_N).fill(null)).slice(0, INV_N).map(x => x && ITEMS[x.d] ? x : null); (sv.items || []).filter(x => ITEMS[x.d]).forEach(spawnWorld); if (sv.hp) P.hp = sv.hp; }
  else MAP.items.forEach(spawnWorld);
}
const uidGen = () => 'u' + Date.now().toString(36) + Math.floor(rnd() * 1e6).toString(36);
function invAdd(d, n) {
  const st = ITEMS[d].stack;
  for (let i = 0; i < INV_N && n > 0; i++) { const s = inv[i]; if (s && s.d === d && s.n < st) { const k = Math.min(n, st - s.n); s.n += k; n -= k; } }
  for (let i = 0; i < INV_N && n > 0; i++) if (!inv[i]) { const k = Math.min(n, st); inv[i] = { d, n: k }; n -= k; }
  return n;                                               // what did not fit
}
function act(cmd) {
  switch (cmd.type) {
    case 'pickup': {
      const w = worldItems.find(x => x.uid === cmd.uid);
      if (!w || w.zone !== zone || Math.hypot(w.x - P.x, w.z - P.z) > 2.4) return false;
      const left = invAdd(w.d, w.n), got = w.n - left;
      if (!got) { toast('сумка полна'); return false; }
      const c = ITEMS[w.d].col;
      for (let k = 0; k < 14; k++) emit({ x: w.x, y: w.y + .1, z: w.z, vx: (rnd() - .5) * 2, vy: 1 + rnd() * 2, vz: (rnd() - .5) * 2, r: c[0] * 2, g: c[1] * 2, b: c[2] * 2, size: .06, life: .5, drag: 2, mode: RUNEM });
      say('Сумка', '+' + got + ' ' + ITEMS[w.d].name, ITEMS[w.d].c);
      if (left) w.n = left; else removeWorld(w);
      break;
    }
    case 'drop': {
      const s = inv[cmd.slot]; if (!s) return false;
      const n = Math.min(cmd.n || s.n, s.n);
      s.n -= n; if (s.n <= 0) inv[cmd.slot] = null;
      const a = P.yaw + (rnd() - .5) * .8, sx = Math.sin(a), sz = Math.cos(a);
      let x = P.x + sx * .9, z = P.z + sz * .9;
      if (solid(x, z, .1)) { x = P.x; z = P.z; }
      spawnWorld({ uid: uidGen(), d: s.d, n, x, z, zone, y: 1.1, vy: 2.2, vx: sx * 1.6, vz: sz * 1.6 });
      break;
    }
    case 'move': {
      const { from, to } = cmd; if (from === to || !inv[from]) return false;
      const a = inv[from], b = inv[to];
      if (b && b.d === a.d && b.n < ITEMS[a.d].stack) { const k = Math.min(a.n, ITEMS[a.d].stack - b.n); b.n += k; a.n -= k; if (!a.n) inv[from] = null; }
      else { inv[to] = a; inv[from] = b; }
      break;
    }
    case 'use': {
      const s = inv[cmd.slot]; if (!s) return false;
      const u = ITEMS[s.d].use; if (!u) { toast('нельзя использовать'); return false; }
      if (u.hp) { if (P.hp >= 5) { toast('здоровье полное'); return false; } P.hp = Math.min(5, P.hp + u.hp); hud(); }
      for (let k = 0; k < 18; k++) emit({ x: P.x, y: .3, z: P.z, orbit: { c: { x: P.x, z: P.z }, a: k / 18 * TAU, w: 3, r: .6, dr: .4 }, vy: 1.5, r: 1.6, g: .5, b: .6, size: .07, life: .7, mode: RUNEM });
      if (--s.n <= 0) inv[cmd.slot] = null;
      break;
    }
    default: return false;
  }
  saveGame(); renderInv(); return true;
}
function nearestItem(maxD) {
  let best = null, bd = maxD;
  for (const w of worldItems) { if (w.zone !== zone) continue; const d = Math.hypot(w.x - P.x, w.z - P.z); if (d < bd) { bd = d; best = w; } }
  return best;
}
function updateItems(dt) {
  for (const w of worldItems) {
    w.g.visible = w.zone === zone && !w.hidden;
    if (!w.g.visible || Math.abs(w.x - focus.x) > 30 || Math.abs(w.z - focus.z) > 30) continue;
    if (w.vy || w.y > .26) {                               // tossed: fall and settle
      w.vy -= 9 * dt; w.y += w.vy * dt;
      const nx = w.x + w.vx * dt, nz = w.z + w.vz * dt; if (!solid(nx, nz, .1)) { w.x = nx; w.z = nz; }
      if (w.y <= .25) { w.y = .25; w.vy = Math.abs(w.vy) > 1.2 ? -w.vy * .35 : 0; w.vx *= .5; w.vz *= .5; if (!w.vy) w.vx = w.vz = 0; }
    }
    const D = ITEMS[w.d];
    w.g.position.set(w.x, w.y + Math.sin(T * 2.2 + w.ph) * .05, w.z); w.g.rotation.y += dt * 1.3;
    if (D.glow) L(w.x, w.y + .4, w.z, 2.2, D.col[0] * .5, D.col[1] * .5, D.col[2] * .5);
    if (rnd() < dt * .9) emit({ x: w.x + (rnd() - .5) * .3, y: w.y, z: w.z + (rnd() - .5) * .3, vy: .6, r: D.col[0] * 1.6, g: D.col[1] * 1.6, b: D.col[2] * 1.6, size: .05, life: .8, mode: RUNEM });
  }
  // pickup prompt
  const n = ED.on || fadeDir ? null : nearestItem(1.7);
  if (n !== pickEl._w) {
    pickEl._w = n;
    pickEl.style.display = n ? 'block' : 'none';
    if (n) { pickEl.innerHTML = '✋ <b></b>'; pickEl.lastChild.textContent = ITEMS[n.d].name + (n.n > 1 ? ' ×' + n.n : ''); pickEl.lastChild.style.color = ITEMS[n.d].c; }
  }
}
function pickUp() { const w = nearestItem(1.9); if (w) act({ type: 'pickup', uid: w.uid }); }

/* inventory panel */
const invEl = $('inv'), slotsEl = $('slots'), infoEl = $('invInfo'), pickEl = $('pick');
let invSel = -1;
for (let i = 0; i < INV_N; i++) {
  const b = document.createElement('button'); b.className = 'slot';
  b.onclick = () => {
    if (invSel >= 0 && invSel !== i) { act({ type: 'move', from: invSel, to: i }); invSel = inv[i] ? i : -1; }
    else invSel = invSel === i || !inv[i] ? -1 : i;
    renderInv();
  };
  slotsEl.appendChild(b);
}
function renderInv() {
  if (invSel >= 0 && !inv[invSel]) invSel = -1;
  [...slotsEl.children].forEach((b, i) => {
    const s = inv[i]; b.classList.toggle('sel', i === invSel);
    b.innerHTML = s ? `<i style="color:${ITEMS[s.d].c}">${ITEMS[s.d].g}</i>${s.n > 1 ? `<em>${s.n}</em>` : ''}` : '';
  });
  const s = inv[invSel];
  if (!s) { infoEl.innerHTML = '<p class="muted">Нажми на предмет. Чтобы переложить — нажми на него, потом на другую ячейку.</p>'; return; }
  const D = ITEMS[s.d];
  infoEl.innerHTML = `<h4 style="color:${D.c}"></h4><p></p><div class="acts">${D.use ? '<button data-a="use">Использовать</button>' : ''}<button data-a="drop1">Выбросить 1</button>${s.n > 1 ? '<button data-a="dropAll">Выбросить все</button>' : ''}</div>`;
  infoEl.querySelector('h4').textContent = D.name + (s.n > 1 ? ' ×' + s.n : '');
  infoEl.querySelector('p').textContent = D.desc;
  infoEl.querySelectorAll('button').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'use') act({ type: 'use', slot: invSel });
    if (a === 'drop1') act({ type: 'drop', slot: invSel, n: 1 });
    if (a === 'dropAll') act({ type: 'drop', slot: invSel, n: s.n });
  });
}
function toggleInv(on = invEl.style.display !== 'flex') { if (on && ED.on) return; invEl.style.display = on ? 'flex' : 'none'; if (on) renderInv(); }
$('bInv').onclick = () => toggleInv();
$('invClose').onclick = () => toggleInv(false);
pickEl.onclick = e => { e.stopPropagation(); pickUp(); };

/* =========== map editor =========== */
const ED = { on: false, tool: 'tree', item: 'apple', fx: 0, fz: 0, undo: [] };
const edEl = $('editor'), toolsEl = $('edTools');
const TOOLS = [...Object.keys(PROP).map(k => [k, PROP[k].icon + ' ' + PROP[k].name]), ['item', '🎁 предмет'], ['erase', '⌫ ластик']];
TOOLS.forEach(([k, label]) => {
  const b = document.createElement('button'); b.textContent = label; b.dataset.t = k;
  b.onclick = () => {
    if (k === 'item' && ED.tool === 'item') { const ks = Object.keys(ITEMS); ED.item = ks[(ks.indexOf(ED.item) + 1) % ks.length]; }
    ED.tool = k; edTools();
  };
  toolsEl.appendChild(b);
});
function edTools() {
  [...toolsEl.children].forEach(b => {
    b.classList.toggle('on', b.dataset.t === ED.tool);
    if (b.dataset.t === 'item') b.textContent = '🎁 ' + ITEMS[ED.item].name + (ED.tool === 'item' ? ' ↻' : '');
  });
}
const cursor = new THREE.Mesh(new THREE.RingGeometry(.45, .6, 24).rotateX(-Math.PI / 2), stdMat({ color: [0, 0, 0], emis: [.4, 1.4, 1.2] }));
cursor.visible = false; scene.add(cursor);
function setEditor(on) {
  if (on && zone !== 'forest') { toast('редактор работает в лесу'); return; }
  ED.on = on; document.body.classList.toggle('editing', on);
  edEl.style.display = on ? 'flex' : 'none'; cursor.visible = false;
  if (on) { toggleInv(false); ED.fx = P.x; ED.fz = P.z; edTools(); toast('Редактор карты'); }
  else toast('Игра');
}
$('bEdit').onclick = () => setEditor(!ED.on);
$('edExit').onclick = () => setEditor(false);
function snapPos(t, x, z) { const sn = PROP[t]?.snap; return sn ? [Math.round(x / sn) * sn, Math.round(z / sn) * sn] : [x, z]; }
function edApply(x, z) {
  if (ED.tool === 'erase') {
    let bi = null, bd = 1.1;
    for (const w of worldItems) { const d = Math.hypot(w.x - x, w.z - z); if (w.zone === 'forest' && d < bd) { bd = d; bi = w; } }
    if (bi) { removeWorld(bi); MAP.items = MAP.items.filter(i => i.uid !== bi.uid); ED.undo.push({ t: 'item+', it: plainItem(bi) }); saveGame(); saveMap(); return; }
    let bp = null; bd = 1.6;
    for (const p of MAP.props) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; bp = p; } }
    if (bp) { MAP.props.splice(MAP.props.indexOf(bp), 1); ED.undo.push({ t: 'prop+', p: bp }); rebuildProps(); saveMap(); }
    return;
  }
  if (ED.tool === 'item') {
    const it = { uid: uidGen(), d: ED.item, n: ED.item === 'coin' ? 5 : 1, x: +x.toFixed(2), z: +z.toFixed(2), zone: 'forest' };
    MAP.items.push(it); spawnWorld(it); ED.undo.push({ t: 'item-', uid: it.uid }); saveGame(); saveMap(); return;
  }
  const t = ED.tool, [sx, sz] = snapPos(t, x, z);
  if (MAP.props.some(p => p.t === t && Math.hypot(p.x - sx, p.z - sz) < (PROP[t].snap || .5) * .9)) return;
  const sc = { tree: .8 + rnd() * .6, rock: .5 + rnd() * .6, bush: .7 + rnd() * .5 }[t] || 1;
  const pr = { id: MAP.nextId++, t, x: +sx.toFixed(2), z: +sz.toFixed(2), s: +sc.toFixed(2), r: +(t === 'wall' ? 0 : rnd() * TAU).toFixed(2) };
  MAP.props.push(pr); ED.undo.push({ t: 'prop-', id: pr.id }); rebuildProps(); saveMap();
  for (let k = 0; k < 10; k++) emit({ x: sx, y: .2, z: sz, vx: (rnd() - .5) * 3, vy: 1 + rnd() * 2, vz: (rnd() - .5) * 3, r: .4, g: 1.4, b: 1.2, size: .06, life: .5, drag: 2, mode: RUNEM });
}
$('edUndo').onclick = () => {
  const u = ED.undo.pop(); if (!u) return;
  if (u.t === 'prop-') MAP.props = MAP.props.filter(p => p.id !== u.id);
  if (u.t === 'prop+') MAP.props.push(u.p);
  if (u.t === 'item-') { const w = worldItems.find(w => w.uid === u.uid); if (w) removeWorld(w); MAP.items = MAP.items.filter(i => i.uid !== u.uid); }
  if (u.t === 'item+') { MAP.items.push(u.it); spawnWorld(u.it); }
  rebuildProps(); saveMap(); saveGame();
};
$('edExport').onclick = () => {
  const blob = new Blob([JSON.stringify(MAP)], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'ascii-map.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('edImport').onclick = () => $('mapFile').click();
$('mapFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const m = JSON.parse(await f.text()); if (m.v !== 1 || !Array.isArray(m.props)) throw 0; loadMap(m); toast('карта загружена'); }
  catch (_) { toast('не похоже на карту'); }
  e.target.value = '';
};
$('edReset').onclick = () => { if (confirm('Сбросить карту к исходной? Твои правки пропадут.')) { localStorage.removeItem('ascii-map-v1'); loadMap(defaultMap()); toast('карта сброшена'); } };
function loadMap(m) {
  MAP = m; MAP.items ||= []; MAP.nextId ||= MAP.props.reduce((a, p) => Math.max(a, p.id || 0), 0) + 1;
  for (const w of [...worldItems]) if (w.zone === 'forest') removeWorld(w);
  MAP.items.forEach(spawnWorld); ED.undo.length = 0; rebuildProps(); saveMap(); saveGame();
}
/* editor pointer: tap = apply tool, drag = pan */
let edPtr = null;
function edDown(e) { edPtr = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, fx: ED.fx, fz: ED.fz }; screenToWorld(e.clientX, e.clientY, tmpV); edPtr.wx = tmpV.x; edPtr.wz = tmpV.z; }
function edMove(e) {
  if (e.pointerType === 'mouse' && screenToWorld(e.clientX, e.clientY, tmpV)) {
    const [sx, sz] = ED.tool === 'erase' || ED.tool === 'item' ? [tmpV.x, tmpV.z] : snapPos(ED.tool, tmpV.x, tmpV.z);
    cursor.position.set(sx, .05, sz); cursor.visible = true;
  }
  if (!edPtr || e.pointerId !== edPtr.id) return;
  if (Math.hypot(e.clientX - edPtr.x, e.clientY - edPtr.y) > 9) edPtr.moved = true;
  if (edPtr.moved && screenToWorld(e.clientX, e.clientY, tmpV)) { ED.fx += edPtr.wx - tmpV.x; ED.fz += edPtr.wz - tmpV.z; focus.x = ED.fx; focus.z = ED.fz; }
}
function edUp(e) { if (edPtr && e.pointerId === edPtr.id && !edPtr.moved) edApply(edPtr.wx, edPtr.wz); edPtr = null; }

/* ---------- zone switching ---------- */
function startTransition(to) { if (!fadeDir) { fadeDir = 1; fadeTo = to; } }
function enterZone(z) {
  const fromZone = zone; zone = z; parts.length = 0;
  for (const p of projs) scene.remove(p.m); projs.length = 0;
  forest.visible = z === 'forest'; dungeon.visible = z === 'dungeon';
  NPCS.forEach(n => { n.tag.style.display = z === 'forest' ? '' : 'none'; });
  if (z === 'dungeon') {
    P.x = D.start.x; P.z = D.start.z; P.yaw = Math.PI; toast('Глубины руин');
    Object.assign(Wc, { rain: 0, snow: 0, storm: 0, wind: 0 });
    D.monsters.forEach(m => { m.alive = true; m.g.visible = true; m.g.position.set(m.hx, 0, m.hz); });
  } else if (fromZone === 'dungeon') { P.x = DOOR.x; P.z = DOOR.z + 2.2; P.yaw = 0; toast('Шепчущий лес'); }
  else { P.x = 0; P.z = 3; P.yaw = 0; toast('Шепчущий лес'); }
  focus.set(P.x, 0, P.z); hud();
  if (ED && ED.on && z !== 'forest') setEditor(false);
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
const emitAcc = { v: 0 }; let edZoom = 1;
function update(dt, rdt = dt) {
  T += dt; U.uTime.value = T;
  P.cd -= dt; P.sayT -= dt; P.inv -= dt; P.hurt -= dt;
  const fdt = Math.min(rdt, .12);
  if (fadeDir === 1) { fadeV += fdt * 2.5; if (fadeV >= 1) { fadeV = 1; enterZone(fadeTo); fadeDir = -1; } }
  else if (fadeDir === -1) { fadeV -= fdt * 1.8; if (fadeV <= 0) { fadeV = 0; fadeDir = 0; } }
  fadeEl.style.opacity = fadeV;

  /* movement (camera-relative: up = away from camera) */
  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x,
    mz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + joy.y;
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  const run = keys.ShiftLeft || keys.ShiftRight || ml > .95 && (joy.x || joy.y);
  const spd = (run ? 6.2 : 3.6) * (fadeDir ? 0 : 1);
  if (ED.on && ml > .12) { ED.fx += mx * 14 * dt; ED.fz += mz * 14 * dt; }
  const moving = ml > .12 && !chatOpen && !fadeDir && !ED.on;
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
  focus.x = lerp(focus.x, ED.on ? ED.fx : P.x, fk); focus.z = lerp(focus.z, ED.on ? ED.fz : P.z, fk);
  U.uFocus.value.copy(focus);
  const aspect = (cols * cellW) / (rows * cellH);
  edZoom = lerp(edZoom, ED.on ? 1.6 : 1, fk);
  const dist = (aspect < 1 ? 11 + (1 - aspect) * 4.5 : 10.5) * edZoom, pitch = .9 + (edZoom - 1) * .45;
  camera.position.set(focus.x, Math.sin(pitch) * dist + .8, focus.z + Math.cos(pitch) * dist);
  camera.lookAt(focus.x, 1.1, focus.z);
  ground.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  camera.updateMatrixWorld(); tmpV.set(P.x, 1, P.z).project(camera);
  { const vz = tmpV2.set(P.x, 1, P.z).applyMatrix4(camera.matrixWorldInverse).z; U.uPN.value.set(tmpV.x, tmpV.y, -vz); }

  /* weather */
  const tg = zone === 'forest' ? WX[wxIdx] : DUN_WX, wk = zone === 'dungeon' ? 1 : 1 - Math.exp(-dt * 1.2);
  for (const k of ['rain', 'snow', 'fog', 'wind', 'storm']) Wc[k] = lerp(Wc[k], tg[k], wk);
  for (const k of ['amb', 'moon', 'fogc']) for (let i = 0; i < 3; i++) Wc[k][i] = lerp(Wc[k][i], tg[k][i], wk);
  if (zone !== 'dungeon' && Wc.storm > .5) { flashT -= dt; if (flashT <= 0) { flash = 1; flash2 = .16; flashT = 2.5 + rnd() * 7; } }
  if (flash2 > 0) { flash2 -= dt; if (flash2 <= 0) flash = Math.max(flash, .7); }
  flash = Math.max(0, flash - dt * 2.6);
  const fl = flash * flash;
  U.uAmb.value.setRGB(Wc.amb[0] + fl * .25, Wc.amb[1] + fl * .28, Wc.amb[2] + fl * .4);
  U.uMoonCol.value.setRGB(Wc.moon[0] + fl * .7, Wc.moon[1] + fl * .75, Wc.moon[2] + fl * .9);
  U.uFogCol.value.setRGB(...Wc.fogc); U.uFogD.value = Wc.fog;
  U.uWindS.value = Wc.wind;
  const wa = -2.6 + Math.sin(T * .05) * .3; U.uWind.value.set(Math.cos(wa), Math.sin(wa) * .5).normalize();
  rain.geo.instanceCount = zone !== 'dungeon' ? Math.floor(RAIN_MAX * Wc.rain * quality) : 0;
  U.uWet.value = Wc.rain;
  rain.mat.uniforms.uFlash.value = fl; rain.mat.uniforms.uRainH.value = 1;
  snow.geo.instanceCount = zone !== 'dungeon' ? Math.floor(SNOW_MAX * Wc.snow) : 0;

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
    for (const p of MAP.props) if (p.t === 'torch' && Math.abs(p.x - focus.x) < 24 && Math.abs(p.z - focus.z) < 20) {
      const f = flick(p.id % 50 + 30, 9); L(p.x, 1.9, p.z, 6, 1.2 * f, .62 * f, .22 * f);
      if (rnd() < ne / 2) emit({ x: p.x + (rnd() - .5) * .2, y: 1.7, z: p.z + (rnd() - .5) * .2, vy: 1 + rnd(), vx: U.uWind.value.x * Wc.wind * .4, r: 2.4, g: 1.1, b: .3, size: .06 + rnd() * .05, life: .35 + rnd() * .3, shrink: 1 });
    }
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
      P.hp--; P.inv = 1.1; P.hurt = .3; hud(); saveGame();
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

  updateItems(dt);
  updateParts(dt);
  pushLights();
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
  defines: { SX, SY, NRAMP: RAMP.length, NEDGE: EDGE.length, NRUNE: RUNE.length },
  uniforms: { tScene: { value: null }, tDesc: { value: desc }, uDir: { value: SHAPES.length }, uRuneIdx: { value: RUNE_IDX }, uRampIdx: { value: RAMP_IDX }, uEdgeIdx: { value: EDGE_IDX }, uTime: U.uTime, uExpo: { value: 1 } },
  vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  fragmentShader: /* glsl */`
  uniform sampler2D tScene; uniform highp sampler2D tDesc; uniform float uDir, uTime; uniform float uRuneIdx[NRUNE]; uniform float uExpo; uniform float uRampIdx[NRAMP]; uniform float uEdgeIdx[NEDGE];
  void main(){
    ivec2 cell = ivec2(gl_FragCoord.xy);
    ivec2 b = cell*ivec2(SX,SY);
    vec3 sum = vec3(0.); float bl = -1.; vec4 best = vec4(0.);
    float sub[9];
    for(int k=0;k<9;k++) sub[k] = 0.;
    for(int j=0;j<SY;j++) for(int i=0;i<SX;i++){
      vec4 t = texelFetch(tScene, b+ivec2(i,j), 0); t.rgb *= uExpo;
      sum += t.rgb; float l = dot(t.rgb, vec3(.3,.59,.11));
      if(l>bl){ bl=l; best=t; }
      sub[(2-(j*3)/SY)*3 + (i*3)/SX] += l;
    }
    vec3 avg = sum/float(SX*SY);
    float g; vec3 col;
    if(best.a > .95){
      float w = 9./float(SX*SY);
      vec3 t0, t1, t2;
      for(int k=0;k<3;k++){
        vec3 v = vec3(sub[k*3], sub[k*3+1], sub[k*3+2])*w;
        v = pow(clamp(v*1.7, 0., 1.), vec3(1.1));
        if(k==0) t0=v; else if(k==1) t1=v; else t2=v;
      }
      float mean = (dot(t0,vec3(1.))+dot(t1,vec3(1.))+dot(t2,vec3(1.)))/9.;
      float hi = max(max(max(t0.x,t0.y),max(t0.z,t1.x)),max(max(t1.y,t1.z),max(t2.x,max(t2.y,t2.z))));
      float lo = min(min(min(t0.x,t0.y),min(t0.z,t1.x)),min(min(t1.y,t1.z),min(t2.x,min(t2.y,t2.z))));
      // flat: density ramp
      float ri = clamp(floor(mean*float(NRAMP-1)+.5), 0., float(NRAMP-1));
      g = 0.;
      for(int k=0;k<NRAMP;k++) if(float(k)==ri) g = uRampIdx[k];
      // strong contrast inside the cell: pick the contour glyph whose 3x3 shape fits best
      if(hi - lo > .34){
        int gi = int(g);
        vec3 a0 = texelFetch(tDesc, ivec2(gi,0), 0).rgb - t0, a1 = texelFetch(tDesc, ivec2(gi,1), 0).rgb - t1, a2 = texelFetch(tDesc, ivec2(gi,2), 0).rgb - t2;
        float bc = (dot(a0,a0)+dot(a1,a1)+dot(a2,a2))*.85;
        for(int k=0;k<NEDGE;k++){
          int s = int(uEdgeIdx[k]);
          vec3 d0 = texelFetch(tDesc, ivec2(s,0), 0).rgb - t0;
          vec3 d1 = texelFetch(tDesc, ivec2(s,1), 0).rgb - t1;
          vec3 d2 = texelFetch(tDesc, ivec2(s,2), 0).rgb - t2;
          float c = dot(d0,d0) + dot(d1,d1) + dot(d2,d2);
          if(c < bc){ bc = c; g = uEdgeIdx[k]; }
        }
      }
      col = mix(avg, best.rgb, .55);
    } else if(best.a < .035 && bl > .02){
      float hs = fract(sin(dot(vec2(cell), vec2(41.3,17.7)))*9137.1);
      g = hs < .45 ? 10. : hs < .75 ? 79. : hs < .9 ? 14. : 11.;   // * o . +
      col = best.rgb;
    } else if(best.a > .09){
      float a = (best.a-.1)/.8;
      g = uDir + mod(floor(a*4.+.5), 4.);
      col = best.rgb;
    } else {
      float h = fract(sin(dot(vec2(cell)+floor(uTime*9.), vec2(12.9898,78.233)))*43758.5453);
      int ri = int(floor(h*float(NRUNE)));
      float rg = 0.;
      for(int k=0;k<NRUNE;k++) if(k==ri) rg = uRuneIdx[k];
      g = rg; col = best.rgb;
    }
    if(bl < .014 || (best.a > .95 && bl < .05)) g = 0.;
    float m = max(max(col.r,col.g),col.b);
    vec3 cc = m > 0. ? col/m * min(1.15, .22 + m*1.5) : col;
    gl_FragColor = vec4(min(cc,vec3(1.)), g/255.);
  }`,
});
// per-cell orientation: strokes get their exact screen angle, other glyphs lean slightly along contours
const auxMat = new THREE.ShaderMaterial({
  defines: { SX, SY },
  uniforms: { tScene: { value: null }, uExpo: { value: 1 } },
  vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  fragmentShader: /* glsl */`
  uniform sampler2D tScene; uniform float uExpo;
  void main(){
    ivec2 cell = ivec2(gl_FragCoord.xy), b = cell*ivec2(SX,SY);
    float bl = -1.; vec4 best = vec4(0.); float gx = 0., gy = 0., tot = 0.;
    for(int j=0;j<SY;j++) for(int i=0;i<SX;i++){
      vec4 t = texelFetch(tScene, b+ivec2(i,j), 0);
      float l = dot(t.rgb, vec3(.3,.59,.11))*uExpo;
      if(l>bl){ bl=l; best=t; }
      gx += l*(float(i)-float(SX-1)*.5); gy += l*(float(j)-float(SY-1)*.5); tot += l;
    }
    float rot = 0., kind = 0., str = 0.;
    if(best.a > .09 && best.a <= .95){
      float ang = (best.a-.1)/.8*3.14159265;       // blade / rain direction, 0 = horizontal
      rot = ang - 1.5707963; kind = 1.;
    } else if(tot > 1e-4){
      float th = atan(gy*.5, gx);                  // luminance gradient direction (cells are ~2:1)
      str = clamp(length(vec2(gx, gy*.5))/(tot+.05)*1.4, 0., 1.);
      rot = .32*sin(2.*th)*str;
    }
    gl_FragColor = vec4(rot/3.14159265 + .5, kind, str, 1.);
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
  uniforms: { tCell: { value: null }, tAux: { value: null }, uDirV: { value: SHAPES.length + 2 }, uT: U.uTime, tRaw: { value: null }, uRaw: { value: 0 }, tAtlas: { value: atlas }, tBloom: { value: null }, uCellPx: { value: new THREE.Vector2() }, uGridPx: { value: new THREE.Vector2() }, uGlyphN: { value: GLYPHS.length }, uBloomK: { value: .95 } },
  vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  fragmentShader: /* glsl */`
  uniform sampler2D tCell, tAtlas, tBloom, tRaw, tAux; uniform vec2 uCellPx, uGridPx; uniform float uGlyphN, uBloomK, uRaw, uDirV, uT;
  void main(){
    vec2 fc = gl_FragCoord.xy, cf = fc/uCellPx;
    if(uRaw > .5){
      vec3 r = texture2D(tRaw, fc/uGridPx).rgb*2.2 + texture2D(tBloom, fc/uGridPx).rgb*uBloomK*.8;
      r = 1. - exp(-r*1.6);
      gl_FragColor = vec4(pow(r, vec3(.8)), 1.);
      return;
    }
    ivec2 cell = ivec2(floor(cf));
    ivec2 gmax = ivec2(uGridPx/uCellPx) - 1;
    vec3 acc = vec3(0.);
    for(int dy=-1; dy<=1; dy++) for(int dx=-1; dx<=1; dx++){
      ivec2 nc = cell + ivec2(dx,dy);
      if(nc.x<0 || nc.y<0 || nc.x>gmax.x || nc.y>gmax.y) continue;
      vec4 cv = texelFetch(tCell, nc, 0);
      float g = floor(cv.a*255.+.5);
      if(g < .5) continue;
      vec4 ax = texelFetch(tAux, nc, 0);
      bool stroke = ax.g > .5;
      // hand-placed look: tiny per-cell offset and lean
      float h1 = fract(sin(dot(vec2(nc), vec2(12.9898,78.233)))*43758.5453);
      float h2 = fract(h1*91.7 + .13);
      vec2 jit = (vec2(h1,h2)-.5)*vec2(.16,.1);
      float rot = (ax.r-.5)*3.14159265 + (stroke ? 0. : (h2-.5)*.12 + sin(uT*1.3 + h1*31.)*.035);
      jit += stroke ? vec2(0.) : vec2(sin(uT*.9 + h2*40.), cos(uT*1.1 + h1*27.))*.035;
      if(stroke) g = uDirV;
      vec2 sc = stroke ? vec2(1.1, 2.3) : vec2(1.0, 1.0);
      vec2 d = fc - (vec2(nc) + .5 + jit)*uCellPx;
      float cs = cos(rot), sn = sin(rot);
      mat2 R = mat2(cs, -sn, sn, cs);               // rotate into glyph space
      vec2 k = 1./(uCellPx*sc);
      vec2 lp = (R*d)*k + .5;
      if(lp.x < 0. || lp.y < 0. || lp.x > 1. || lp.y > 1.) continue;
      vec2 ddx = (R*vec2(1.,0.))*k, ddy = (R*vec2(0.,1.))*k;
      float m = textureGrad(tAtlas, vec2((g+lp.x)/uGlyphN, lp.y), vec2(ddx.x/uGlyphN, ddx.y), vec2(ddy.x/uGlyphN, ddy.y)).r;
      vec3 col = cv.rgb*(stroke ? .9 : 1.);
      acc = max(acc, col*m);
    }
    // calm palette: soften saturation and highlights
    float l = dot(acc, vec3(.3,.59,.11));
    acc = mix(vec3(l), acc, .66)*vec3(.95,1.,.96);
    acc = acc/(1. + acc*.35)*1.18;
    vec3 bloom = texture2D(tBloom, fc/uGridPx).rgb;
    vec2 q = fc/uGridPx - .5;
    vec3 bg = vec3(.022,.024,.036)*(1. - dot(q,q)*.9);
    vec3 c = bg + acc + bloom*uBloomK;
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
  cellW = (small ? DETAIL.small : DETAIL.big)[detail]; cellH = Math.round(cellW * 1.7);
  cols = Math.ceil(W / cellW); rows = Math.ceil(H / cellH);
  [sceneRT, cellRT, auxRT, bA, bB, rawRT].forEach(r => r && r.dispose()); rawRT = null;
  sceneRT = makeRT(cols * SX, rows * SY, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType });
  cellRT = makeRT(cols, rows, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  auxRT = makeRT(cols, rows, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
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
    // 8-bit + MSAA works everywhere (half-float MSAA is not supported on some iPhones)
    rawRT = makeRT(Math.round(cols * cellW * DPR * rs), Math.round(rows * cellH * DPR * rs), { depthBuffer: true, samples: 4, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }
  finalMat.uniforms.uRaw.value = asciiOn ? 0 : 1;
  brightMat.uniforms.uTh.value = asciiOn && canHalf ? 1.0 : .8;
}
addEventListener('resize', resize);

function render() {
  if (asciiOn) {
    renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
    cellMat.uniforms.tScene.value = sceneRT.texture; pass(cellMat, cellRT);
    auxMat.uniforms.tScene.value = sceneRT.texture; auxMat.uniforms.uExpo.value = cellMat.uniforms.uExpo.value; pass(auxMat, auxRT);
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
  finalMat.uniforms.tCell.value = cellRT.texture; finalMat.uniforms.tAux.value = auxRT.texture; finalMat.uniforms.tBloom.value = bA.texture; pass(finalMat, null);
  // tags
  placeTag(P.tag, P.x, 2.75, P.z, P.sayT, P.say);
  if (zone === 'forest') for (const n of NPCS) placeTag(n.tag, n.x, 2.75, n.z, n.sayT, n.say);
}

/* ---------- loop with simple adaptive quality ---------- */
let last0 = performance.now(), last = performance.now(), perfT = 0, perfN = 0, perfSum = 0;
function frame(now) {
  const dt = clamp((now - last) / 1000, 0, .05); last = now;
  update(dt, clamp((now - last0) / 1000, 0, .2)); last0 = now; render();
  if (quality === 1 && T > 2) {
    perfT += dt; perfN++; perfSum += dt;
    if (perfT > 3) { if (perfSum / perfN > .034) { quality = .55; resize(); } perfT = perfN = perfSum = 0; if (T > 12) perfT = -1e9; }
  }
  requestAnimationFrame(frame);
}
loadGame(); renderInv();
resize(); hud(); viewBtns(); toast('Шепчущий лес');
say('Система', 'добро пожаловать в Шепчущий лес. Руины — по тропе вправо.', '#9ab');
window.__game = { items: () => worldItems.map(plainItem), propsCount: () => MAP.props.length, P, setWx, enter: z => enterZone(z), cast: () => cast(null), get zone() { return zone; } };
requestAnimationFrame(frame);
