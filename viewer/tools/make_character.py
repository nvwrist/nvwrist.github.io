"""
Генератор персонажа «Neon Runner» (low-poly, PS1-стиль) в Blender (bpy как python-модуль).

    pip install bpy numpy pillow
    python3 viewer/tools/make_character.py            # -> viewer/models/neon-runner.glb

Что делает: строит меши из труб/эллипсоидов/боксов (numpy), красит вершины, рисует маленький
текстурный атлас (майка с эмблемой), создаёт скелет и веса, ключи анимации (Idle/Walk/HandsUp/Lean/Aim)
и экспортирует всё в .glb. Координаты Blender: Z вверх, персонаж смотрит в -Y, левая сторона = +X.
"""
import math, sys, os
import numpy as np
import bpy, bmesh
from mathutils import Euler, Quaternion, Vector
from PIL import Image, ImageDraw

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(os.path.dirname(__file__), '..', 'models', 'neon-runner.glb')
OUT = os.path.abspath(OUT)
rng = np.random.default_rng(7)

# ───────────────────────── цвет ─────────────────────────
def lin(hexs):
    h = hexs.lstrip('#'); c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def hsh(*a):  # детерминированный шум 0..1 от координат
    v = np.sin(sum(x * k for x, k in zip(a, (12.9898, 78.233, 37.719, 4.581)))) * 43758.5453
    return v - np.floor(v)
SKIN, SKIN_D = lin('#c98f6b'), lin('#a8694c')

# ───────────────────────── части ─────────────────────────
class Part:  # одна часть меша
    def __init__(s, V, F, C, uv=None, mat=0, bone=None, smooth=True, name=''):
        s.V, s.F, s.C, s.mat, s.bone, s.smooth, s.name = np.asarray(V, float), F, np.asarray(C, float), mat, bone, smooth, name
        s.uv = uv  # функция(face_center, vertex)->(u,v) или None
parts = []
WHITE_UV = (0.03, 0.97)

def tube(P, R, n=8, sub=2, cap=(True, True), spline=True, ref=(0, -1, 0), rot=0.0):
    """Труба вдоль ломаной P с эллиптическим сечением R=[(rx,ry)]. Возвращает (V, F, ring_id)."""
    P = np.array(P, float); R = np.array(R, float)
    if spline and len(P) > 2:
        ts = np.linspace(0, len(P) - 1, (len(P) - 1) * sub + 1)
        def cr(arr):
            out = []
            for t in ts:
                i = min(int(t), len(arr) - 2); f = t - i
                p0, p1, p2, p3 = arr[max(i - 1, 0)], arr[i], arr[i + 1], arr[min(i + 2, len(arr) - 1)]
                out.append(0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3))
            return np.array(out)
        P, R = cr(P), cr(R)
    elif sub > 1:
        ts = np.linspace(0, len(P) - 1, (len(P) - 1) * sub + 1)
        P = np.array([P[min(int(t), len(P) - 2)] * (1 - (t - min(int(t), len(P) - 2))) + P[min(int(t), len(P) - 2) + 1] * (t - min(int(t), len(P) - 2)) for t in ts])
        R = np.array([R[min(int(t), len(R) - 2)] * (1 - (t - min(int(t), len(R) - 2))) + R[min(int(t), len(R) - 2) + 1] * (t - min(int(t), len(R) - 2)) for t in ts])
    T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1)[:, None]
    ref = np.array(ref, float)
    rings = []
    for i, (p, t, r) in enumerate(zip(P, T, R)):
        d = ref - t * ref.dot(t)
        if np.linalg.norm(d) < 1e-3: d = np.array([0, 0, 1.0]) - t * t[2]
        d /= np.linalg.norm(d); s_ = np.cross(d, t); s_ /= np.linalg.norm(s_)
        ring = [p + s_ * r[0] * math.cos(a + rot) + d * r[1] * math.sin(a + rot) for a in np.linspace(0, 2 * math.pi, n, endpoint=False)]
        rings.append((np.array(ring), p, t, r))
    V = [v for rg in rings for v in rg[0]]; F = []; rid = [i for i, rg in enumerate(rings) for _ in range(n)]
    for i in range(len(rings) - 1):
        for k in range(n):
            a, b, c, d_ = i * n + k, i * n + (k + 1) % n, (i + 1) * n + (k + 1) % n, (i + 1) * n + k
            F.append((a, d_, c, b))
    def endcap(idx, sign):
        _, p, t, r = rings[idx]; rm = float(np.mean(r))
        base = idx * n
        ring2 = [p + sign * t * rm * 0.45 + (np.array(V[base + k]) - p) * 0.62 for k in range(n)]
        apex = p + sign * t * rm * 0.75
        o = len(V)
        V.extend(ring2); rid.extend([idx] * n); V.append(apex); rid.append(idx)
        for k in range(n):
            a, b = base + k, base + (k + 1) % n
            F.append((a, b, o + (k + 1) % n, o + k) if sign < 0 else (a, o + k, o + (k + 1) % n, b))
            F.append((o + k, o + (k + 1) % n, o + n) if sign < 0 else (o + k, o + n, o + (k + 1) % n))
    if cap[0]: endcap(0, -1)
    if cap[1]: endcap(len(rings) - 1, 1)
    return np.array(V), F, np.array(rid)

def ellipsoid(center, radii, seg=16, rows=10):
    V, F = [], []
    for j in range(rows + 1):
        th = math.pi * j / rows
        for i in range(seg):
            ph = 2 * math.pi * i / seg
            V.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
    V = np.array(V)
    for j in range(rows):
        for i in range(seg):
            a, b = j * seg + i, j * seg + (i + 1) % seg
            c, d = (j + 1) * seg + (i + 1) % seg, (j + 1) * seg + i
            if j == 0: F.append((a, d, c))
            elif j == rows - 1: F.append((a, d, b))
            else: F.append((a, d, c, b))
    return V, F  # единичные направления + грани

def box(c, s, rot=None):
    h = np.array(s) / 2
    V = np.array([(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]) * h
    if rot is not None: V = V @ np.array(Euler(rot).to_matrix()).T
    V = V + np.array(c)
    F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return V, F

def add(V, F, colorfn=None, color=None, **kw):
    V = np.asarray(V, float)
    C = np.array([colorfn(v) for v in V]) if colorfn else np.tile(color if color is not None else [1, 1, 1], (len(V), 1))
    parts.append(Part(V, F, C, **kw))
    return parts[-1]

def noisy(base, amt=0.08, k=1.0):
    return lambda v: np.clip(base * (1 + (hsh(v[0] * 91 * k, v[1] * 57 * k, v[2] * 133 * k) - 0.5) * amt * 2), 0, 1)

# ───────────────────────── геометрия персонажа ─────────────────────────
PANTS, PANTS_D = lin('#3a3c52'), lin('#25263a')
BOOT, BOOT_D = lin('#4a362c'), lin('#16110f')
METAL, METAL_D, CYAN = lin('#e4e8f2'), lin('#3a3d4a'), lin('#27e6ff')
LEATHER, GOLD = lin('#1c1a22'), lin('#d4aa4a')
HAIR_C, HAIR_P = lin('#17131f'), lin('#5a3590')
H = np.array([0, 0.005, 1.645]); HR = np.array([0.077, 0.098, 0.117])

# ── голова (сфера с деформацией: нос, брови, скулы, подбородок, губы) ──
def head_part():
    seg, rows = 24, 16
    U, F = ellipsoid(H, HR, seg, rows)
    V, C = [], []
    sm = lambda a, b, x: float(np.clip((x - a) / (b - a), 0, 1))
    for u in U:
        ux, uy, uz = u
        f = max(-uy, 0) ** 1.4
        p = np.array([HR[0] * ux, HR[1] * uy, HR[2] * uz])
        if uz < 0:  # челюсть
            t = sm(0, 0.95, -uz); p[0] *= 1 - 0.30 * t ** 1.3; p[1] -= 0.012 * t * f
            if uz < -0.8: p[2] += 0.006
        g_nose = f * math.exp(-((ux / 0.11) ** 2 + ((uz + 0.10) / 0.30) ** 2))
        g_tip = f * math.exp(-((ux / 0.10) ** 2 + ((uz + 0.24) / 0.10) ** 2))
        p[1] -= 0.022 * g_nose + 0.012 * g_tip
        g_brow = f * math.exp(-((uz - 0.22) / 0.10) ** 2) * (1 - min(abs(ux), 1) ** 2)
        p[1] -= 0.011 * g_brow
        p[1] += 0.008 * f * math.exp(-((abs(ux) - 0.42) / 0.18) ** 2 - ((uz - 0.06) / 0.14) ** 2)
        g_ck = f * math.exp(-((abs(ux) - 0.55) / 0.2) ** 2 - ((uz + 0.14) / 0.2) ** 2)
        p[1] -= 0.008 * g_ck
        g_lip = f * math.exp(-((ux / 0.34) ** 2 + ((uz + 0.50) / 0.07) ** 2))
        p[1] -= 0.008 * g_lip
        p[1] += 0.005 * f * math.exp(-((ux / 0.3) ** 2 + ((uz + 0.66) / 0.06) ** 2))
        # цвет
        col = SKIN * (0.94 + 0.12 * hsh(*(u * 40)))
        if uz > 0.85: col = col * 0.8
        if g_lip > 0.35: col = lin('#a85a58')
        if f > 0.3 and abs(uz - 0.27) < 0.05 and abs(ux) > 0.18: col = lin('#2a1e20')
        if f > 0.2 and -0.82 < uz < -0.3 and hsh(*(u * 90)) > 0.62: col = col * 0.8 + lin('#3a2a28') * 0.2  # щетина
        if g_nose > 0.3: col = col * 0.92
        V.append(p + H); C.append(col)
    parts.append(Part(V, F, C, bone='head', name='head'))
    # уши
    for s_ in (-1, 1):
        ev, ef = ellipsoid(H, (1, 1, 1), 8, 6)
        ev = ev * np.array([0.012, 0.022, 0.032]) + H + np.array([s_ * 0.079, 0.012, -0.012])
        parts.append(Part(ev, ef, np.tile(SKIN * 0.9, (len(ev), 1)), bone='head', name='ear'))
head_part()
nv, nf, _ = tube([(0, 0.012, 1.40), (0, 0.012, 1.53)], [(0.052, 0.052), (0.044, 0.044)], n=10, sub=1, cap=(False, False))
parts.append(Part(nv, nf, np.tile(SKIN * 0.95, (len(nv), 1)), bone='neck', name='neck'))

# ── волосы ──
def hair():
    seg, rows = 22, 14
    U, F = ellipsoid(H, HR, seg, rows)
    Hc = H + np.array([0, 0.012, 0.012]); Hr = HR * np.array([1.10, 1.09, 1.07])
    keep = []
    for u in U:
        ux, uy, uz = u
        keep.append(uz > 0.5 or (uy > -0.18 and uz > -0.92) or (abs(ux) > 0.78 and uz > -0.25))
    F2 = [f for f in F if all(keep[i] for i in f)]
    V = [Hc + Hr * u for u in U]
    # чёлка: низкая линия волос над одним глазом
    C = []
    for v in V:
        n = hsh(round(v[0] * 120), round(v[2] * 18))
        C.append(HAIR_P if n > 0.9 else HAIR_C * (0.7 + 0.6 * hsh(round(v[0] * 120), 1)))
    parts.append(Part(V, F2, C, bone='head', name='hair_cap'))
    # длинные пряди
    def strand(P, R, bone=None, name='strand'):
        v, f, rid = tube(P, R, n=10, sub=3, cap=(False, True))
        col = []
        for p in v:
            k = hsh(round(p[0] * 70), round(p[1] * 70))
            c = HAIR_C * (0.6 + 0.8 * hsh(round(p[0] * 90), 3))
            if k > 0.86: c = HAIR_P * (0.7 + 0.5 * (1.7 - p[2]))
            col.append(c)
        parts.append(Part(v, f, col, bone=bone, name=name))
    strand([(0, 0.07, 1.74), (0, 0.115, 1.60), (0, 0.128, 1.44), (0, 0.112, 1.28), (0, 0.09, 1.16)],
           [(0.075, 0.04), (0.092, 0.045), (0.088, 0.045), (0.070, 0.04), (0.040, 0.03)], name='hair_back')
    for s_ in (-1, 1):
        strand([(s_ * 0.080, -0.02, 1.70), (s_ * 0.098, -0.005, 1.56), (s_ * 0.108, -0.03, 1.43), (s_ * 0.104, -0.05, 1.31)],
               [(0.032, 0.036), (0.036, 0.04), (0.032, 0.036), (0.018, 0.02)], name='hair_side')
hair()

# ── очки ──
for s_ in (-1, 1):
    ev, ef = ellipsoid(H, (1, 1, 1), 12, 6)
    ev = ev * np.array([0.034, 0.010, 0.024]) + np.array([s_ * 0.039, -0.104, 1.655])
    parts.append(Part(ev, ef, [lin('#08060e')] * len(ev), bone='head', name='lens'))
    # переливающийся блик
    parts.append(Part(*box((s_ * 0.050, -0.1135, 1.662), (0.016, 0.002, 0.004), rot=(0, -0.6, 0)), C=[lin('#ff4fd8') if s_ > 0 else lin('#7d6bff')] * 8, bone='head', name='glint', smooth=False))
    parts.append(Part(*box((s_ * 0.082, -0.05, 1.655), (0.004, 0.105, 0.008)), C=[lin('#08060e')] * 8, bone='head', name='temple', smooth=False))
parts.append(Part(*box((0, -0.104, 1.665), (0.014, 0.008, 0.006)), C=[lin('#08060e')] * 8, bone='head', name='bridge', smooth=False))
parts.append(Part(*box((0.083, -0.02, 1.64), (0.008, 0.04, 0.012)), C=[CYAN] * 8, bone='head', name='implant', mat=1, smooth=False))

# ── торс (с UV под текстуру майки) ──
def torso():
    P = [(0, 0, 0.93), (0, 0, 1.06), (0, 0, 1.20), (0, 0, 1.33), (0, 0, 1.43)]
    R = [(0.140, 0.095), (0.140, 0.095), (0.168, 0.102), (0.196, 0.108), (0.166, 0.095)]
    v, f, _ = tube(P, R, n=20, sub=3, cap=(False, True), rot=math.pi / 2 * 0)
    col = [np.array([1, 1, 1.0]) * (0.88 + 0.12 * np.clip((p[2] - 0.95) / 0.5, 0, 1)) for p in v]
    def uvf(fc, vtx):  # планарная проекция спереди/сзади в области атласа
        front = fc[1] < 0
        u = (vtx[0] + 0.21) / 0.42 * 0.5; vv = (vtx[2] - 0.93) / 0.54 * 0.5
        u = min(max(u, 0.004), 0.496); vv = min(max(vv, 0.004), 0.496)
        return (u if front else 0.5 + u, vv)
    parts.append(Part(v, f, col, uv=uvf, bone=None, name='torso'))
torso()
# таз
pv, pf, _ = tube([(0, 0, 0.88), (0, 0, 1.0)], [(0.156, 0.104), (0.150, 0.098)], n=18, sub=1, cap=(True, False))
parts.append(Part(pv, pf, [PANTS] * len(pv), bone=None, name='pelvis'))
# ремень + пряжка + подсумки
bv, bf, _ = tube([(0, 0, 0.985), (0, 0, 1.03)], [(0.158, 0.106), (0.158, 0.106)], n=18, sub=1, cap=(False, False))
parts.append(Part(bv, bf, [LEATHER] * len(bv), bone='spine', smooth=False, name='belt'))
parts.append(Part(*box((0, -0.112, 1.007), (0.045, 0.012, 0.038)), C=[GOLD] * 8, bone='spine', smooth=False, name='buckle'))
parts.append(Part(*box((0.185, -0.01, 0.93), (0.05, 0.085, 0.085)), C=[LEATHER * 1.4] * 8, bone='hips', smooth=False, name='pouch'))
# кобура + пистолет на правом бедре
parts.append(Part(*box((-0.17, -0.02, 0.80), (0.05, 0.095, 0.15)), C=[LEATHER * 1.3] * 8, bone='thigh.R', smooth=False, name='holster'))
parts.append(Part(*box((-0.17, -0.02, 0.85), (0.03, 0.12, 0.04)), C=[lin('#555a66')] * 8, bone='thigh.R', smooth=False, name='pistol'))
parts.append(Part(*box((-0.17, 0.03, 0.80), (0.03, 0.04, 0.09), rot=(0.25, 0, 0)), C=[lin('#2a2c34')] * 8, bone='thigh.R', smooth=False, name='grip'))

# ── ноги ──
def pants_leg(s_):
    P = [(s_ * 0.092, 0.0, 0.94), (s_ * 0.100, -0.01, 0.72), (s_ * 0.098, -0.012, 0.50), (s_ * 0.096, 0.0, 0.30), (s_ * 0.096, 0.005, 0.17)]
    R = [(0.100, 0.100), (0.082, 0.086), (0.068, 0.070), (0.066, 0.066), (0.064, 0.064)]
    v, f, _ = tube(P, R, n=12, sub=3, cap=(False, False))
    col = []
    for p in v:
        c = PANTS * (0.85 + 0.3 * hsh(round(p[0] * 60), round(p[2] * 60)))
        if abs(abs(p[0]) - 0.098) > 0.062 and p[2] < 0.9 and False: c = PANTS_D
        col.append(c)
    parts.append(Part(v, f, col, name='leg'))
    # наколенник
    if s_ > 0: parts.append(Part(*box((s_ * 0.097, -0.07, 0.50), (0.085, 0.03, 0.095)), C=[METAL_D] * 8, bone='shin.L' if s_ > 0 else 'shin.R', smooth=False, name='kneepad'))
    # ботинок
    bt = [(s_ * 0.097, 0.012, 0.30), (s_ * 0.097, 0.01, 0.14), (s_ * 0.099, -0.07, 0.075), (s_ * 0.099, -0.15, 0.055)]
    br = [(0.082, 0.082), (0.080, 0.080), (0.068, 0.062), (0.056, 0.044)]
    v, f, _ = tube(bt, br, n=10, sub=3, cap=(False, True), ref=(0, 0, 1))
    col = [BOOT * (0.8 + 0.4 * hsh(round(p[0] * 80), round(p[1] * 80))) if p[2] > 0.1 or True else BOOT for p in v]
    col = [(c * 0.9 if p[2] > 0.2 else c) for c, p in zip(col, v)]
    parts.append(Part(v, f, col, bone='shin.L' if s_ > 0 else 'shin.R', name='boot'))
    parts.append(Part(*box((s_ * 0.099, -0.07, 0.016), (0.128, 0.27, 0.032)), C=[BOOT_D] * 8, bone='foot.L' if s_ > 0 else 'foot.R', smooth=False, name='sole'))
for s_ in (1, -1): pants_leg(s_)

# ── правая рука (живая) ──
def organic_arm():
    s_ = -1
    P = [(s_ * 0.215, 0.0, 1.385), (s_ * 0.24, 0.0, 1.12), (s_ * 0.256, -0.025, 0.90)]
    R = [(0.052, 0.052), (0.042, 0.042), (0.034, 0.034)]
    v, f, _ = tube(P, R, n=10, sub=3, cap=(True, False))
    col = [SKIN * (0.9 + 0.2 * hsh(*(p * 70))) for p in v]
    parts.append(Part(v, f, col, name='arm.R'))
    hv, hf, _ = tube([(s_ * 0.256, -0.025, 0.90), (s_ * 0.256, -0.035, 0.80), (s_ * 0.258, -0.04, 0.72)], [(0.034, 0.020), (0.042, 0.022), (0.038, 0.018)], n=8, sub=2, cap=(False, True))
    parts.append(Part(hv, hf, [SKIN] * len(hv), bone='hand.R', name='hand.R'))
    tv, tf, _ = tube([(s_ * 0.226, -0.04, 0.84), (s_ * 0.226, -0.06, 0.78)], [(0.011, 0.011), (0.009, 0.009)], n=6, sub=1)
    parts.append(Part(tv, tf, [SKIN] * len(tv), bone='hand.R', name='thumb.R'))
organic_arm()

# ── левая рука: киберпротез ──
def cyber_arm():
    s_ = 1
    P = [(s_ * 0.215, 0.0, 1.385), (s_ * 0.24, 0.0, 1.12), (s_ * 0.256, -0.025, 0.90)]
    def seg(p0, p1, r0, r1, bone, band=True, n=8):
        v, f, rid = tube([p0, p1], [(r0, r0), (r1, r1)], n=n, sub=4, cap=(True, True), spline=False)
        col = []
        for p in v:
            t = (p[2] - p1[2]) / (p0[2] - p1[2])
            c = METAL * (0.82 + 0.18 * hsh(round(p[2] * 200)))
            if 0.45 < t < 0.5 or 0.80 < t < 0.84: c = METAL_D
            col.append(c)
        parts.append(Part(v, f, col, bone=bone, smooth=False, name='cyber_' + bone))
    seg(P[0] + np.array([0, 0, -0.05]), P[1], 0.054, 0.045, 'upper_arm.L')
    seg(P[1], P[2], 0.046, 0.036, 'forearm.L')
    pu, pf = ellipsoid(0, 1, 10, 6)
    pu = pu * np.array([0.07, 0.066, 0.05]) + np.array([s_ * 0.222, 0.0, 1.40])
    parts.append(Part(pu, pf, [METAL_D * (0.8 + 0.4 * hsh(*(p * 30))) for p in pu], bone='chest', smooth=False, name='pauldron'))
    parts.append(Part(*box((s_ * 0.222, -0.067, 1.41), (0.07, 0.006, 0.01)), C=[CYAN] * 8, bone='chest', mat=1, smooth=False, name='pauldron_glow'))
    for z, b, rad in [(1.12, 'upper_arm.L', 0.054), (0.90, 'forearm.L', 0.044)]:
        jv, jf, _ = tube([(s_ * (0.24 if z > 1 else 0.256), 0.0, z + 0.022), (s_ * (0.24 if z > 1 else 0.256), 0.0, z - 0.022)], [(rad, rad)] * 2, n=8, sub=1, cap=(True, True))
        parts.append(Part(jv, jf, [METAL_D] * len(jv), bone=b, smooth=False, name='joint'))
    # светящиеся линии
    for (x, y, z, h_, b) in [(0.228, -0.046, 1.20, 0.17, 'upper_arm.L'), (0.243, -0.040, 1.02, 0.15, 'forearm.L')]:
        parts.append(Part(*box((x, y, z), (0.008, 0.004, h_)), C=[CYAN] * 8, bone=b, mat=1, smooth=False, name='glow'))
    # перчатка
    hv, hf, _ = tube([(s_ * 0.256, -0.025, 0.875), (s_ * 0.256, -0.035, 0.79), (s_ * 0.258, -0.04, 0.72)], [(0.037, 0.025), (0.044, 0.026), (0.040, 0.020)], n=8, sub=2, cap=(False, True))
    parts.append(Part(hv, hf, [lin('#f0f2fa')] * len(hv), bone='hand.L', name='glove'))
    parts.append(Part(*box((s_ * 0.2565, -0.043, 0.755), (0.07, 0.006, 0.012)), C=[METAL_D] * 8, bone='hand.L', smooth=False, name='knuckle'))
    tv, tf, _ = tube([(s_ * 0.226, -0.04, 0.84), (s_ * 0.226, -0.06, 0.78)], [(0.012, 0.012), (0.010, 0.010)], n=6, sub=1)
    parts.append(Part(tv, tf, [lin('#f0f2fa')] * len(tv), bone='hand.L', name='thumb.L'))
cyber_arm()
# ключицы/плечо справа (закрывают стык торса и руки)
sv, sf = ellipsoid(0, 1, 10, 7)
parts.append(Part(sv * np.array([0.055, 0.052, 0.058]) + np.array([-0.215, 0.0, 1.385]), sf, [SKIN] * len(sv), bone='upper_arm.R', name='shoulder.R'))
# цепочка/ошейник
cv, cf, _ = tube([(0, 0.01, 1.455), (0, 0.01, 1.48)], [(0.056, 0.056)] * 2, n=12, sub=1, cap=(False, False))
parts.append(Part(cv, cf, [LEATHER] * len(cv), bone='neck', smooth=False, name='choker'))
parts.append(Part(*box((0, -0.047, 1.46), (0.014, 0.006, 0.014)), C=[CYAN] * 8, bone='neck', mat=1, smooth=False, name='choker_gem'))

# ───────────────────────── скелет ─────────────────────────
J = {  # имя: (родитель, head, tail)
    'hips': (None, (0, 0, 0.93), (0, 0, 1.05)),
    'spine': ('hips', (0, 0, 1.05), (0, 0, 1.24)),
    'chest': ('spine', (0, 0, 1.24), (0, 0, 1.42)),
    'neck': ('chest', (0, 0.012, 1.42), (0, 0.012, 1.53)),
    'head': ('neck', (0, 0.012, 1.53), (0, 0.005, 1.76)),
}
for n_, s_ in (('L', 1), ('R', -1)):
    J['upper_arm.' + n_] = ('chest', (s_ * 0.215, 0, 1.385), (s_ * 0.24, 0, 1.12))
    J['forearm.' + n_] = ('upper_arm.' + n_, (s_ * 0.24, 0, 1.12), (s_ * 0.256, -0.025, 0.90))
    J['hand.' + n_] = ('forearm.' + n_, (s_ * 0.256, -0.025, 0.90), (s_ * 0.258, -0.04, 0.72))
    J['thigh.' + n_] = ('hips', (s_ * 0.092, 0, 0.94), (s_ * 0.098, -0.012, 0.50))
    J['shin.' + n_] = ('thigh.' + n_, (s_ * 0.098, -0.012, 0.50), (s_ * 0.097, 0.0, 0.14))
    J['foot.' + n_] = ('shin.' + n_, (s_ * 0.097, 0.0, 0.14), (s_ * 0.099, -0.17, 0.05))
BONES = list(J)

def seg_dist(p, a, b):
    a, b = np.array(a), np.array(b); ab = b - a
    t = np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1)
    return np.linalg.norm(p - (a + ab * t))

# ───────────────────────── сборка меша ─────────────────────────
def allowed_bones(pt):
    """Какие кости могут влиять на часть (чтобы торс не тянулся за поднятой рукой и т.п.)."""
    side = 'L' if np.mean(pt.V[:, 0]) > 0 else 'R'
    if pt.name in ('torso', 'pelvis'): return {'hips', 'spine', 'chest', 'neck'}
    if pt.name == 'leg': return {'hips', 'thigh.' + side, 'shin.' + side}
    if pt.name.startswith('arm'): return {'chest', 'upper_arm.' + side, 'forearm.' + side, 'hand.' + side}
    if pt.name.startswith('hair'): return {'head', 'neck', 'chest'}
    return set(BONES)

atlas_rects = {}
def build_mesh():
    verts, colors, faces, fmats, fsmooth, fuv_fn, weights = [], [], [], [], [], [], []
    for pt in parts:
        o = len(verts)
        verts.extend(pt.V); colors.extend(pt.C)
        for v in pt.V:
            if pt.bone: weights.append({pt.bone: 1.0})
            else:
                allowed = allowed_bones(pt)
                d = np.array([seg_dist(v, J[b][1], J[b][2]) if b in allowed else 1e3 for b in BONES])
                w = 1.0 / (d + 0.012) ** 4
                idx = np.argsort(-w)[:3]; w = w[idx] / w[idx].sum()
                weights.append({BONES[i]: float(x) for i, x in zip(idx, w) if x > 0.02})
        for f in pt.F:
            faces.append(tuple(i + o for i in f)); fmats.append(pt.mat); fsmooth.append(pt.smooth); fuv_fn.append(pt.uv)
    return np.array(verts), np.array(colors), faces, fmats, fsmooth, fuv_fn, weights

def atlas():
    img = Image.new('RGBA', (128, 128), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    SK, TK = (201, 143, 107), (36, 36, 46)
    def tank(front):
        im = Image.new('RGBA', (64, 64), TK + (255,)); g = ImageDraw.Draw(im)
        r = np.random.default_rng(3 if front else 4)
        for _ in range(500): g.point((int(r.integers(0, 64)), int(r.integers(0, 64))), fill=tuple(int(c * f) for c, f in zip(TK, (1.5,) * 3)) + (255,) if r.random() > .5 else (22, 22, 30, 255))
        # px→ мир: x = -0.21 + px/64*0.42 ; z = 0.93 + (64-py)/64*0.54
        X = lambda px: -0.21 + px / 64 * 0.42; Z = lambda py: 0.93 + (64 - py) / 64 * 0.54
        for py in range(64):
            for px in range(64):
                x, z = abs(X(px)), Z(py)
                skin = (z > 1.30 + 1.5 * x and front) or (x > 0.152 and z > 1.16) or (not front and z > 1.385 and x < 0.1)
                if skin: g.point((px, py), fill=tuple(int(c * (0.92 + 0.14 * r.random())) for c in SK) + (255,))
        red, dr = (216, 34, 46, 255), (122, 15, 24, 255)
        if front:
            cx = 32
            g.polygon([(cx - 10, 26), (cx + 10, 26), (cx + 4, 32), (cx, 46), (cx - 4, 32)], fill=red)
            g.polygon([(cx - 18, 22), (cx - 8, 25), (cx - 14, 32)], fill=dr); g.polygon([(cx + 18, 22), (cx + 8, 25), (cx + 14, 32)], fill=dr)
            g.line([(cx - 14, 30), (cx - 6, 36)], fill=dr); g.line([(cx + 14, 30), (cx + 6, 36)], fill=dr)
        else:
            g.polygon([(20, 20), (44, 20), (32, 40)], outline=red); g.line([(26, 20), (32, 30), (38, 20)], fill=red)
        g.rectangle([0, 60, 63, 63], fill=(20, 20, 26, 255))
        return im
    img.paste(tank(True), (0, 64)); img.paste(tank(False), (64, 64))
    return img

def make():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    V, C, F, FM, FS, FUV, W = build_mesh()
    me = bpy.data.meshes.new('NeonRunner')
    # Blender: Z вверх
    me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F])
    me.update()
    for p, s in zip(me.polygons, FS): p.use_smooth = s
    # UV (по углам)
    uvl = me.uv_layers.new(name='UVMap')
    for pi, p in enumerate(me.polygons):
        fc = np.mean(V[list(p.vertices)], axis=0)
        for li, vi in zip(p.loop_indices, p.vertices):
            uvl.data[li].uv = FUV[pi](fc, V[vi]) if FUV[pi] else WHITE_UV
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(C): ca.data[i].color = (*c, 1.0)
    # материалы
    img = atlas()
    arr = np.array(img.transpose(Image.FLIP_TOP_BOTTOM)).astype(np.float32) / 255
    bimg = bpy.data.images.new('atlas', 128, 128, alpha=False); bimg.pixels = arr.flatten().tolist(); bimg.pack()
    def mk(name, glow=False):
        m = bpy.data.materials.new(name); m.use_nodes = True
        nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 1.0
        if glow:
            bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
            bsdf.inputs['Emission Color'].default_value = (0.15, 0.9, 1.0, 1); bsdf.inputs['Emission Strength'].default_value = 1.0
        else:
            vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
            tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = bimg; tx.interpolation = 'Closest'
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
            nt.links.new(vc.outputs['Color'], mx.inputs[6]); nt.links.new(tx.outputs['Color'], mx.inputs[7])
            nt.links.new(mx.outputs[2], bsdf.inputs['Base Color'])
        return m
    me.materials.append(mk('Main')); me.materials.append(mk('Glow', True))
    for p, m in zip(me.polygons, FM): p.material_index = m
    obj = bpy.data.objects.new('NeonRunner', me); bpy.context.scene.collection.objects.link(obj)
    # скелет
    arm = bpy.data.armatures.new('Rig'); ao = bpy.data.objects.new('Rig', arm); bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (par, h, t) in J.items():
        eb = arm.edit_bones.new(name); eb.head, eb.tail = h, t
        if par: eb.parent = arm.edit_bones[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    for name in BONES: obj.vertex_groups.new(name=name)
    for i, w in enumerate(W):
        for b, x in w.items(): obj.vertex_groups[b].add([i], x, 'REPLACE')
    obj.parent = ao
    mod = obj.modifiers.new('Armature', 'ARMATURE'); mod.object = ao
    # анимации
    animate(ao)
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); ao.select_set(True)
    bpy.context.view_layer.objects.active = ao
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_skins=True, export_yup=True, export_image_format='AUTO',
                              export_vertex_color='ACTIVE',
                              export_apply=False, export_materials='EXPORT', export_force_sampling=True)
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB; verts', len(V), 'tris', sum(len(f) - 2 for f in F))

# ───────────────────────── анимация ─────────────────────────
def animate(ao):
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode='POSE')
    pb = ao.pose.bones
    for b in pb: b.rotation_mode = 'QUATERNION'
    rest = {b.name: b.bone.matrix_local.to_quaternion() for b in pb}
    def q(bone, rx=0, ry=0, rz=0):
        r = rest[bone]
        return r.inverted() @ Euler((rx, ry, rz)).to_quaternion() @ r
    fps = 30
    bpy.context.scene.render.fps = fps
    def clip(name, frames, fn):
        act = bpy.data.actions.new(name); act.use_fake_user = True
        ao.animation_data_create(); ao.animation_data.action = act
        for f in frames:
            pose = fn(f)
            for b in pb:
                rot = pose.get(b.name, (0, 0, 0))
                b.rotation_quaternion = q(b.name, *rot)
                b.keyframe_insert('rotation_quaternion', frame=f)
            for b in pb:
                b.location = (0, 0, 0)
            hb = pose.get('_hipz', 0.0)
            pb['hips'].location = (0, 0, hb); pb['hips'].keyframe_insert('location', frame=pb and f)
            pb['hips'].location = (0, 0, 0)
    base = lambda: {'upper_arm.L': (0, -0.10, 0), 'upper_arm.R': (0, 0.10, 0), 'forearm.L': (-0.25, 0, 0), 'forearm.R': (-0.25, 0, 0),
                    'thigh.L': (0, -0.03, 0), 'thigh.R': (0, 0.03, 0)}
    def idle(f):
        t = (f - 1) / 60 * 2 * math.pi
        p = base(); p['chest'] = (0.02 * math.sin(t), 0, 0.02 * math.sin(t * 0.5)); p['head'] = (-0.015 * math.sin(t), 0.0, 0.05 * math.sin(t * 0.5)); p['spine'] = (0.01 * math.sin(t), 0, 0)
        p['upper_arm.L'] = (0.03 * math.sin(t), -0.10, 0); p['upper_arm.R'] = (-0.03 * math.sin(t), 0.10, 0)
        return p
    clip('Idle', [1, 15, 30, 45, 60], idle)
    def walk(f):
        t = (f - 1) / 32 * 2 * math.pi; s, c = math.sin(t), math.cos(t)
        p = base()
        p['thigh.L'] = (-0.7 * s, -0.03, 0); p['thigh.R'] = (0.7 * s, 0.03, 0)
        p['shin.L'] = (max(0, -c) * 0.95 + 0.05, 0, 0); p['shin.R'] = (max(0, c) * 0.95 + 0.05, 0, 0)
        p['foot.L'] = (-0.15 * max(0, s), 0, 0); p['foot.R'] = (-0.15 * max(0, -s), 0, 0)
        p['upper_arm.L'] = (0.55 * s, -0.08, 0); p['upper_arm.R'] = (-0.55 * s, 0.08, 0)
        p['forearm.L'] = (-0.45 - 0.3 * max(0, -s), 0, 0); p['forearm.R'] = (-0.45 - 0.3 * max(0, s), 0, 0)
        p['spine'] = (0.05, 0, 0.1 * s); p['chest'] = (0, 0, -0.12 * s); p['head'] = (-0.05, 0, 0.05 * s); p['hips'] = (0, 0, -0.08 * s)
        p['_hipz'] = -abs(c) * 0.03
        return p
    clip('Walk', list(range(1, 34, 4)) + [33], walk)
    def still(d):
        def fn(f):
            p = base(); p.update(d); p['_breath'] = 0
            t = (f - 1) / 60 * 2 * math.pi
            c = p.get('chest', (0, 0, 0)); p['chest'] = (c[0] + 0.015 * math.sin(t), c[1], c[2])
            return p
        return fn
    clip('HandsUp', [1, 30, 60], still({
        'upper_arm.L': (0.2, -2.7, 0), 'upper_arm.R': (-0.1, 2.75, 0), 'forearm.L': (-0.15, 0, 0), 'forearm.R': (-0.1, 0, 0),
        'thigh.L': (0, -0.3, 0), 'thigh.R': (0, 0.3, 0), 'shin.L': (0.12, 0, 0), 'shin.R': (0.12, 0, 0), 'head': (-0.1, 0, 0)}))
    clip('Lean', [1, 30, 60], still({
        'hips': (0, 0, 0.08), 'chest': (0, 0.1, 0), 'head': (0, 0, 0.35),
        'upper_arm.L': (0, -0.55, 0), 'forearm.L': (-1.9, 0, 0), 'upper_arm.R': (0.1, 0.1, 0), 'forearm.R': (-0.6, 0, 0),
        'thigh.L': (0, 0.12, 0), 'thigh.R': (-0.15, 0.2, 0.35), 'shin.R': (0.4, 0, 0)}))
    clip('Aim', [1, 30, 60], still({
        'chest': (0, 0, 0.3), 'head': (0, 0, -0.3),
        'upper_arm.L': (-1.45, -0.1, 0), 'forearm.L': (-0.1, 0, 0), 'upper_arm.R': (-1.35, 0.35, 0), 'forearm.R': (-0.9, 0, 0),
        'thigh.L': (-0.2, -0.12, 0), 'thigh.R': (0.25, 0.12, 0), 'shin.L': (0.2, 0, 0), 'shin.R': (0.3, 0, 0)}))
    bpy.ops.object.mode_set(mode='OBJECT')
    ao.animation_data.action = bpy.data.actions['Idle']

if __name__ == '__main__':
    make()
