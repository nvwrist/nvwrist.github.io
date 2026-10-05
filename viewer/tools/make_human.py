"""
Персонаж «Странник» для PS1-вьюера из готовой CC0-модели Quaternius «Animated Human».

    pip install bpy numpy pillow
    python3 viewer/tools/make_human.py         # -> viewer/models/human.glb

Источник: https://opengameart.org/content/animated-human-low-poly (CC0, автор Quaternius).
Скрипт скачивает архив (если его нет в кэше), перекрашивает модель в «обычного человека»
(льняная рубаха, штаны, сапоги), запекает в Cycles грязную PS1-текстуру 128×128 (цвет × шум × AO)
на новую UV-развёртку и экспортирует .glb со скелетом и анимациями.
"""
import os, sys, io, json, zipfile, urllib.request, tempfile
import numpy as np
import bpy
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', 'models', 'human.glb'))
MAPS = os.path.abspath(os.path.join(HERE, '..', 'models', 'human'))  # карты для редактора персонажа
URL = 'https://opengameart.org/sites/default/files/Animated%20Human%20by%20%40Quaternius_0.zip'
CACHE = os.path.join(tempfile.gettempdir(), 'quaternius_human')
TEX = 128

def fetch():
    blend = os.path.join(CACHE, 'Animated Human by @Quaternius', 'Blend', 'Animated Human.blend')
    if not os.path.exists(blend):
        os.makedirs(CACHE, exist_ok=True)
        print('download', URL)
        zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(URL).read())).extractall(CACHE)
    return blend

# исходная палитра (ClothedLightSkin2) → новая: обычный человек, приглушённые «тёмное фэнтези» тона
RECOLOR = [  # (исходный цвет, новый цвет)
    ((255, 205, 155), (190, 142, 110)),  # кожа
    ((41, 41, 41), (38, 30, 24)),        # глаза/брови/волосы
    ((100, 215, 105), (150, 138, 112)),  # рубаха → небелёный лён
    ((200, 148, 89), (78, 62, 46)),      # штаны → бурая шерсть
]

def recolored_source(path):
    im = np.array(Image.open(path).convert('RGB')).astype(int)
    out = im.copy()
    for src, dst in RECOLOR:
        d = np.abs(im - np.array(src)).sum(-1)
        out[d < 60] = dst
    return Image.fromarray(out.astype(np.uint8))

# цвета-идентификаторы регионов исходной текстуры (для карты регионов редактора)
ID_SRC = [((255, 209, 159), 1), ((41, 41, 41), 2), ((100, 215, 105), 3), ((200, 148, 89), 4)]
# id кодируются «углами» RGB-куба: смешение соседних цветов на краях не даёт ложный третий регион
ID_RGB = {1: (255, 0, 0), 2: (0, 255, 0), 3: (0, 0, 255), 4: (255, 255, 255)}
# итоговые id: 0 фон, 1 кожа, 2 глаза/брови, 3 волосы, 4 рубаха, 5 штаны, 6 обувь

def id_source(path):
    im = np.array(Image.open(path).convert('RGB')).astype(int)
    out = np.zeros_like(im)
    for src, i in ID_SRC:
        out[np.abs(im - np.array(src)).sum(-1) < 60] = ID_RGB[i]
    return Image.fromarray(out.astype(np.uint8))

def main():
    blend = fetch()
    bpy.ops.wm.open_mainfile(filepath=blend)
    texdir = os.path.join(os.path.dirname(blend), 'Textures')
    rig = bpy.data.objects['Human Armature']
    obj = bpy.data.objects['Human_Mesh']
    me = obj.data
    for a in list(bpy.data.actions):
        if a.name.startswith('ArmatureAction'): bpy.data.actions.remove(a)
    for a in bpy.data.actions: a.use_fake_user = True

    # 1) перекрашенная полосатая текстура-источник
    src = recolored_source(os.path.join(texdir, 'ClothedLightSkin2.png'))
    tmp = os.path.join(tempfile.gettempdir(), 'human_src.png'); src.save(tmp)
    src_img = bpy.data.images.load(tmp)
    tmp_id = os.path.join(tempfile.gettempdir(), 'human_id.png')
    id_source(os.path.join(texdir, 'ClothedLightSkin2.png')).save(tmp_id)
    id_img = bpy.data.images.load(tmp_id); id_img.colorspace_settings.name = 'Non-Color'

    # 2) новая UV-развёртка под запекание
    old_uv = me.uv_layers.active.name
    new_uv = me.uv_layers.new(name='PS1')
    me.uv_layers.active = new_uv
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects: o.select_set(o == obj)
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj]):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.03)
        bpy.ops.object.mode_set(mode='OBJECT')

    # 3) материал для запекания: цвет по старым UV × шум ткани (по координатам объекта)
    mat = bpy.data.materials.new('Bake'); mat.use_nodes = True
    nt = mat.node_tree; N = nt.nodes; L = nt.links
    bsdf = N['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 1
    uvo = N.new('ShaderNodeUVMap'); uvo.uv_map = old_uv
    t = N.new('ShaderNodeTexImage'); t.image = src_img; t.interpolation = 'Closest'
    L.new(uvo.outputs['UV'], t.inputs['Vector'])
    tc = N.new('ShaderNodeTexCoord')
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 9.0; nz.inputs['Detail'].default_value = 6.0
    nz2 = N.new('ShaderNodeTexNoise'); nz2.inputs['Scale'].default_value = 60.0; nz2.inputs['Detail'].default_value = 2.0
    L.new(tc.outputs['Object'], nz.inputs['Vector']); L.new(tc.outputs['Object'], nz2.inputs['Vector'])
    m1 = N.new('ShaderNodeMath'); m1.operation = 'MULTIPLY_ADD'; m1.inputs[1].default_value = 0.55; m1.inputs[2].default_value = 0.72
    L.new(nz.outputs['Fac'], m1.inputs[0])
    m2 = N.new('ShaderNodeMath'); m2.operation = 'MULTIPLY_ADD'; m2.inputs[1].default_value = 0.3; m2.inputs[2].default_value = 0.85
    L.new(nz2.outputs['Fac'], m2.inputs[0])
    m3 = N.new('ShaderNodeMath'); m3.operation = 'MULTIPLY'
    L.new(m1.outputs[0], m3.inputs[0]); L.new(m2.outputs[0], m3.inputs[1])
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1.0
    L.new(m3.outputs[0], mix.inputs[7])
    # сапоги: всё ниже щиколотки — тёмная кожа (у исходника босые ноги)
    ys = [v.co.y for v in me.vertices]; y0, h = min(ys), max(ys) - min(ys)
    sep = N.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Object'], sep.inputs[0])
    lt = N.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = y0 + h * 0.085
    L.new(sep.outputs['Y'], lt.inputs[0])
    boot = N.new('ShaderNodeMix'); boot.data_type = 'RGBA'
    boot.inputs[7].default_value = (0.035, 0.022, 0.015, 1)
    L.new(lt.outputs[0], boot.inputs[0]); L.new(t.outputs['Color'], boot.inputs[6])
    L.new(boot.outputs[2], mix.inputs[6])
    L.new(mix.outputs[2], bsdf.inputs['Base Color'])
    me.materials.clear(); me.materials.append(mat)

    # 4) запекание (Cycles, CPU): альбедо + AO
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 32
    sc.render.bake.margin = 4
    sc.cycles.filter_width = 0.01  # без сглаживания: карты id/позиций должны быть «чистыми»
    def bake(kind, name):
        img = bpy.data.images.new(name, TEX * 2, TEX * 2, alpha=False)
        tn = N.new('ShaderNodeTexImage'); tn.image = img
        uvn = N.new('ShaderNodeUVMap'); uvn.uv_map = 'PS1'; L.new(uvn.outputs['UV'], tn.inputs['Vector'])
        N.active = tn; tn.select = True
        if kind == 'DIFFUSE':
            sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
        bpy.ops.object.bake(type=kind)
        a = np.array(img.pixels[:]).reshape(TEX * 2, TEX * 2, 4)[::-1, :, :3]
        N.remove(tn); N.remove(uvn)
        return a
    rig.data.pose_position = 'REST'  # запекаем в T-позе: карты позиций не должны зависеть от кадра анимации
    V = np.array([v.co[:] for v in me.vertices]); vmin, vmax = V.min(0), V.max(0)
    out_node = N['Material Output']
    def bake_emit(sock, name, size):
        em = N.new('ShaderNodeEmission'); old = out_node.inputs['Surface'].links[0].from_socket
        L.new(sock, em.inputs['Color']); L.new(em.outputs[0], out_node.inputs['Surface'])
        img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
        tn = N.new('ShaderNodeTexImage'); tn.image = img
        uvn = N.new('ShaderNodeUVMap'); uvn.uv_map = 'PS1'; L.new(uvn.outputs['UV'], tn.inputs['Vector'])
        N.active = tn; tn.select = True
        bpy.ops.object.bake(type='EMIT')
        a = np.array(img.pixels[:]).reshape(size, size, 4)[::-1, :, :3]
        N.remove(tn); N.remove(uvn); L.new(old, out_node.inputs['Surface']); N.remove(em)
        return a
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj]):
        col = bake('DIFFUSE', 'col')
        ao = bake('AO', 'ao')
        noise = bake_emit(m3.outputs[0], 'noise', TEX * 2)
        # карта регионов (по старым UV, без фильтрации)
        uvo2 = N.new('ShaderNodeUVMap'); uvo2.uv_map = old_uv
        ti = N.new('ShaderNodeTexImage'); ti.image = id_img; ti.interpolation = 'Closest'
        L.new(uvo2.outputs['UV'], ti.inputs['Vector'])
        sc.render.bake.margin = 2
        ids = bake_emit(ti.outputs['Color'], 'ids', TEX)
        # позиция в координатах объекта, нормированная в 0..1
        sub = N.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = tuple(vmin)
        mul = N.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = tuple(1 / (vmax - vmin))
        L.new(tc.outputs['Object'], sub.inputs[0]); L.new(sub.outputs[0], mul.inputs[0])
        pos = bake_emit(mul.outputs[0], 'pos', TEX)
        sc.render.bake.margin = 4
    sc.cycles.filter_width = 0.01  # без сглаживания: карты id/позиций должны быть «чистыми»
    # байтовые картинки Blender уже в sRGB; умножаем на AO и уменьшаем до PS1-размера
    final = np.clip(col * (0.45 + 0.55 * ao.mean(-1, keepdims=True)), 0, 1)
    im = Image.fromarray((final * 255).astype(np.uint8)).resize((TEX, TEX), Image.BOX)
    im = im.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=0))
    png = os.path.join(tempfile.gettempdir(), 'human_ps1.png'); im.save(png)
    save_maps(noise, ao, ids, pos, vmin, vmax, me)

    # 5) итоговый материал: только запечённая текстура на UV «PS1»
    baked = bpy.data.images.load(png); baked.pack()
    fm = bpy.data.materials.new('Human'); fm.use_nodes = True
    fb = fm.node_tree.nodes['Principled BSDF']; fb.inputs['Roughness'].default_value = 1
    ft = fm.node_tree.nodes.new('ShaderNodeTexImage'); ft.image = baked; ft.interpolation = 'Closest'
    fm.node_tree.links.new(ft.outputs['Color'], fb.inputs['Base Color'])
    me.materials.clear(); me.materials.append(fm)
    me.uv_layers.remove(me.uv_layers[old_uv])

    rig.data.pose_position = 'POSE'
    rig.animation_data.action = bpy.data.actions['Idle']
    for o in bpy.context.view_layer.objects: o.select_set(o in (obj, rig))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_skins=True, export_yup=True, export_materials='EXPORT')
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB; tris', sum(len(p.vertices) - 2 for p in me.polygons),
          'clips', [a.name for a in bpy.data.actions])
    Image.open(png).resize((512, 512), Image.NEAREST).save(os.path.join(tempfile.gettempdir(), 'human_ps1_preview.png'))

def save_maps(noise, ao, ids, pos, vmin, vmax, me):
    """Карты для редактора: shade (шум×AO), region (id), pos (xyz объекта) + meta.json с ориентирами."""
    os.makedirs(MAPS, exist_ok=True)
    shade = np.clip(noise.mean(-1) * (0.45 + 0.55 * ao.mean(-1)), 0, 1)
    shade = np.array(Image.fromarray((shade * 255).astype(np.uint8)).resize((TEX, TEX), Image.BOX)).astype(float) / 255
    pal = np.array([(0, 0, 0)] + [ID_RGB[i] for i in (1, 2, 3, 4)]) / 255
    rid = np.argmin(((ids[..., None, :] - pal) ** 2).sum(-1), -1)  # 0..4: фон, кожа, тёмное, рубаха, штаны
    P = vmin + pos * (vmax - vmin)  # координаты объекта: Y вверх, вперёд +X, левая сторона −Z
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    out = np.zeros_like(rid)
    out[rid == 1] = 1
    head = y > 6.6
    out[(rid == 2) & head & (x > 0.25) & (y < 7.45)] = 2   # глаза/брови спереди
    out[(rid == 2) & (out != 2)] = 3                        # остальное тёмное — волосы
    out[rid == 3] = 4
    out[rid == 4] = 5
    out[((rid == 4) | (rid == 1)) & (y < 0.68)] = 6        # обувь (у исходника босые ноги)
    torso = (np.abs(z) < 0.6) & (rid == 4)
    meta = {
        'size': TEX, 'min': vmin.round(4).tolist(), 'max': vmax.round(4).tolist(),
        'axes': {'up': 'y', 'forward': '+x', 'left': '-z'},
        'waistY': float(np.percentile(y[torso], 98)) if torso.any() else 4.0,
        'shoulderZ': 0.75, 'wristZ': 3.3, 'kneeY': 2.06, 'ankleY': 0.68,
        'head': {'minY': 6.66, 'maxY': 7.98, 'mouthY': 6.98, 'frontX': 0.1},
        'regions': ['bg', 'skin', 'eyes', 'hair', 'shirt', 'pants', 'boots'],
    }
    Image.fromarray((shade * 255).astype(np.uint8)).save(os.path.join(MAPS, 'shade.png'))
    Image.fromarray((out * 40).astype(np.uint8)).save(os.path.join(MAPS, 'region.png'))
    Image.fromarray((np.clip(pos, 0, 1) * 255).round().astype(np.uint8)).save(os.path.join(MAPS, 'pos.png'))
    json.dump(meta, open(os.path.join(MAPS, 'meta.json'), 'w'), ensure_ascii=False, indent=1)
    prev = np.array([[0, 0, 0], [200, 150, 120], [40, 120, 255], [60, 40, 20], [220, 220, 200], [90, 70, 50], [20, 20, 20]], np.uint8)[out]
    Image.fromarray(prev).resize((512, 512), Image.NEAREST).save(os.path.join(tempfile.gettempdir(), 'human_regions_preview.png'))
    print('maps', MAPS, 'waistY', meta['waistY'])

if __name__ == '__main__':
    main()
