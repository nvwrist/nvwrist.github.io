"""
Оружие и щиты для библиотеки «Снаряжения» из CC0-пака Quaternius «Medieval Weapons».

    pip install bpy gdown numpy pillow
    gdown --folder https://drive.google.com/drive/folders/1Z6vYiQxY8W73FXuMWzaTQAg9rzbumnOr -O /tmp/quaternius/weapons
    python3 viewer/tools/build_weapons.py          # -> viewer/models/items/*.glb + items.json

Стандарт предмета (общий для всей библиотеки):
  * единицы — метры;
  * начало координат — точка хвата (центр кулака);
  * +Y — к острию/навершию (то, что торчит из кулака со стороны большого пальца);
  * +Z — «вперёд» (лезвие топора, лицевая сторона щита);
  * текстура — маленькая (64×64) PS1: цвет материалов × AO × шум, без фильтрации.
"""
import glob, json, os, math, tempfile
import numpy as np
import bpy
from mathutils import Matrix
from PIL import Image

SRC = os.environ.get('WEAPONS_SRC', '/tmp/quaternius/weapons/Blends')
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'models', 'items'))
TEX = 64

# id: (русское имя, категория, гнездо, длина в метрах, хват: 'guard' | доля от хвоста | 'center')
W = {
    'Sword': ('Меч', 'weapon', 'hand_r', 0.95, 'guard'), 'Sword_2': ('Меч с широкой гардой', 'weapon', 'hand_r', 0.95, 'guard'),
    'Sword_Big': ('Длинный меч', 'weapon', 'hand_r', 1.15, 'guard'), 'Sword_Golden': ('Золотой меч', 'weapon', 'hand_r', 1.0, 'guard'),
    'Claymore': ('Клеймор', 'weapon', 'hand_r', 1.35, 'guard'), 'Dagger': ('Кинжал', 'weapon', 'hand_r', 0.42, 'guard'),
    'Dagger_2': ('Кинжал с гардой', 'weapon', 'hand_r', 0.48, 'guard'), 'Axe': ('Топор', 'weapon', 'hand_r', 0.85, 0.16),
    'Axe_Small': ('Топорик', 'weapon', 'hand_r', 0.5, 0.2), 'Axe_Double': ('Двуручная секира', 'weapon', 'hand_r', 1.05, 0.2),
    'Hammer_Small': ('Молот', 'weapon', 'hand_r', 0.75, 0.16), 'Hammer_Double': ('Боевой молот', 'weapon', 'hand_r', 0.9, 0.18),
    'Spear': ('Копьё', 'weapon', 'hand_r', 2.0, 0.38), 'Scythe': ('Коса', 'weapon', 'hand_r', 1.75, 0.35),
    'Bow_Wooden': ('Лук', 'bow', 'hand_l', 1.35, 'center'), 'Bow_Wooden2': ('Лук простой', 'bow', 'hand_l', 1.35, 'center'),
    'Bow_Golden': ('Золотой лук', 'bow', 'hand_l', 1.35, 'center'), 'Bow_Evil': ('Тёмный лук', 'bow', 'hand_l', 1.4, 'center'),
    'Shield_Round': ('Круглый щит', 'shield', 'hand_l', 0.7, 'shield'), 'Shield_Round_2': ('Круглый щит с умбоном', 'shield', 'hand_l', 0.7, 'shield'),
    'Shield_Heater': ('Щит-капля', 'shield', 'hand_l', 0.85, 'shield'), 'Shield_Heater_2': ('Щит-капля простой', 'shield', 'hand_l', 0.85, 'shield'),
    'Shield_Celtic_Golden': ('Кельтский щит', 'shield', 'hand_l', 1.2, 'shield'), 'Arrow': ('Стрела', 'weapon', 'hand_r', 0.75, 0.15),
}

def frame(V, how):
    """Матрица 4×4 (numpy), переводящая вершины Blender в стандарт предмета (до масштаба)."""
    z = V[:, 2]; z0, z1 = z.min(), z.max(); L = z1 - z0
    nb = 40; bins = np.clip(((z - z0) / L * nb).astype(int), 0, nb - 1)
    cx, cy = np.median(V[:, 0]), np.median(V[:, 1])
    width = np.array([np.abs(V[bins == b, 0] - cx).max() if (bins == b).any() else 0 for b in range(nb)])
    if how == 'shield':
        # лицевая сторона — где вершин «шире» по площади; ручка сзади
        ys = V[:, 1]; front_neg = np.percentile(ys, 5) - np.median(ys) < -(np.percentile(ys, 95) - np.median(ys))
        fwd = np.array([0, 1.0, 0]) if front_neg else np.array([0, -1.0, 0])  # ручка сзади → лицо в противоположную сторону
        center = np.array([cx, np.percentile(ys, 97) if front_neg else np.percentile(ys, 3), (z0 + z1) / 2])
        up = np.array([0, 0, 1.0])
    else:
        if how == 'guard':  # у клинков самая широкая часть — гарда; острие — дальний от неё конец
            gb = int(np.argmax(width)); head_top = gb < nb / 2
        else:
            head_top = width[-nb // 3:].mean() > width[:nb // 3].mean()
        up = np.array([0, 0, 1.0 if head_top else -1.0])
        t = (z - z0) / L if head_top else (z1 - z) / L  # 0 — хвост, 1 — острие/навершие
        if how == 'center': g = 0.5
        elif how == 'guard':
            guard_t = (gb + 0.5) / nb if head_top else 1 - (gb + 0.5) / nb
            g = guard_t * 0.55  # середина рукояти между навершием и гардой
        else: g = float(how)
        zg = z0 + g * L if head_top else z1 - g * L
        center = np.array([cx, cy, zg])
        # «вперёд» — в сторону, куда выступает верхняя часть (лезвие топора, клинок косы); у симметричных — ось ширины
        top = V[t > 0.75]
        dx = top[:, 0].mean() - cx if len(top) else 0
        fwd = np.array([1.0 if dx >= 0 else -1.0, 0, 0])
        if how == 'center':  # лук: дуга выгибается от стрелка, «вперёд» — в сторону выгиба
            mid = V[np.abs(t - 0.5) < 0.1]
            fwd = np.array([1.0 if mid[:, 0].mean() - cx >= 0 else -1.0, 0, 0])
    y = up / np.linalg.norm(up); zf = fwd - y * fwd.dot(y); zf /= np.linalg.norm(zf); x = np.cross(y, zf)
    R = np.stack([x, y, zf])  # строки — новые оси в координатах Blender
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = -R @ center
    return M, L

def bake_texture(obj):
    """Цвет материалов × AO × шум → 64×64, один материал с NEAREST."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 24; sc.render.bake.margin = 2
    me = obj.data
    me.uv_layers.new(name='PS1'); me.uv_layers.active = me.uv_layers['PS1']
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj]):
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.2, island_margin=0.04)
        bpy.ops.object.mode_set(mode='OBJECT')
    def bake(kind, name):
        img = bpy.data.images.new(name, TEX * 2, TEX * 2, alpha=False)
        for m in me.materials:
            m.use_nodes = True
            n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img
            uv = m.node_tree.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'PS1'; m.node_tree.links.new(uv.outputs['UV'], n.inputs['Vector'])
            m.node_tree.nodes.active = n; n.select = True
        if kind == 'DIFFUSE':
            sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False; sc.render.bake.use_pass_color = True
        with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj]):
            bpy.ops.object.bake(type=kind)
        return np.array(img.pixels[:]).reshape(TEX * 2, TEX * 2, 4)[::-1, :, :3]
    col = bake('DIFFUSE', 'col'); ao = bake('AO', 'ao')
    rng = np.random.default_rng(abs(hash(obj.name)) % 2**32)
    noise = 0.82 + 0.3 * rng.random((TEX * 2, TEX * 2, 1))
    final = np.clip(col * (0.5 + 0.5 * ao.mean(-1, keepdims=True)) * noise, 0, 1)
    im = Image.fromarray((final * 255).astype(np.uint8)).resize((TEX, TEX), Image.BOX)
    path = os.path.join(tempfile.gettempdir(), obj.name + '_ps1.png'); im.save(path)
    baked = bpy.data.images.load(path); baked.pack()
    mat = bpy.data.materials.new(obj.name); mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 1; b.inputs['Metallic'].default_value = 0
    t = mat.node_tree.nodes.new('ShaderNodeTexImage'); t.image = baked; t.interpolation = 'Closest'
    mat.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    me.materials.clear(); me.materials.append(mat)
    me.uv_layers.remove(me.uv_layers[0]) if len(me.uv_layers) > 1 and me.uv_layers[0].name != 'PS1' else None

def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for wid, (name, cat, socket, length, how) in W.items():
        bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, wid + '.blend'))
        obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
        for o in bpy.data.objects:
            if o is not obj: bpy.data.objects.remove(o)
        me = obj.data
        me.transform(obj.matrix_world); obj.matrix_world = Matrix.Identity(4)
        V = np.array([v.co[:] for v in me.vertices])
        long_ax = int(np.argmax(np.ptp(V, axis=0)))
        if long_ax != 2 and how != 'shield':  # стрела смоделирована вдоль Y — кладём длинную ось на Z
            P = np.eye(4); P[[2, long_ax]] = P[[long_ax, 2]]
            me.transform(Matrix(P.tolist())); V = np.array([v.co[:] for v in me.vertices])
        M, L = frame(V, how)
        s = length / (np.ptp(V[:, 2]) if how != 'shield' else max(np.ptp(V[:, 0]), np.ptp(V[:, 2])))
        # оси стандарта предмета (X, Y=острие, Z=вперёд) → оси Blender для экспорта glTF (Y-up: glTF Y = Blender Z, glTF Z = −Blender Y)
        to_blender = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1.0]])
        T = to_blender @ np.diag([s, s, s, 1]) @ M
        me.transform(Matrix(T.tolist()))
        me.update()
        bake_texture(obj)
        out = os.path.join(OUT, wid.lower() + '.glb')
        for o in bpy.context.view_layer.objects: o.select_set(o is obj)
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_materials='EXPORT', export_yup=True)
        manifest.append({'id': 'q_' + wid.lower(), 'name': name, 'cat': cat, 'socket': socket, 'file': 'items/' + wid.lower() + '.glb',
                         'unit': 'm', 'tris': sum(len(p.vertices) - 2 for p in me.polygons), 'src': 'Quaternius Medieval Weapons (CC0)'})
        print(wid, round(length, 2), 'm', os.path.getsize(out) // 1024, 'KB')
    json.dump(manifest, open(os.path.join(OUT, 'items.json'), 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
