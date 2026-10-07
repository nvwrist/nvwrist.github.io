"""
Старые паки Quaternius (2019–2020) лежат только в .blend/.fbx — переводим их в .glb для build_library.mjs.

    pip install bpy
    python3 viewer/tools/convert_blends.py          # все паки из BLEND_PACKS → /tmp/cc0_conv/<пак>/*.glb

Материалы этих файлов — из Blender 2.79 (Blender Internal + сконвертированные ноды), glTF-экспорт
понимает их плохо, поэтому без текстур пересобираем простой Principled с цветом diffuse_color.
Анимации экспортируются все (ACTIONS), по одной на действие.
"""
import glob, os, sys
import bpy

SRC = os.environ.get('CC0_CACHE', '/tmp/cc0')
OUT = os.environ.get('CC0_CONV', '/tmp/cc0_conv')
BLEND_PACKS = {
    'q-nature-low': 'quaternius/150-lowpoly-nature-models/*/Blends',
    'q-trees': 'quaternius/textured-lowpoly-trees/*/*/Blends',
    'q-dungeon-old': 'quaternius/lowpoly-modular-dungeon-pack/.Updated Modular Dungeon - May 2019/.Updated Modular Dungeon - May 2019/Blends',
    'q-farm': 'quaternius/lowpoly-farm-buildings/*/Blend',
    'q-monsters': 'quaternius/lowpoly-animated-monsters/*/Blend',
    'q-enemies': 'quaternius/animated-easy-enemies/*/*/Blends',
    'q-animals': 'quaternius/lowpoly-animated-animals/*/Blends',
    'q-knight': 'quaternius/lowpoly-animated-knight/*/Blends',
}

def fix_materials():
    for m in bpy.data.materials:
        nt = m.node_tree
        if nt and any(n.type == 'TEX_IMAGE' for n in nt.nodes):
            continue  # текстурные (деревья) — оставляем как есть
        col = tuple(m.diffuse_color)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1)
        bsdf.inputs['Roughness'].default_value = 1.0
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

def convert(pack, pattern):
    dirs = glob.glob(os.path.join(SRC, pattern))
    files = sorted(f for d in dirs for f in glob.glob(os.path.join(d, '*.blend')))
    os.makedirs(os.path.join(OUT, pack), exist_ok=True)
    n = 0
    for f in files:
        dest = os.path.join(OUT, pack, os.path.basename(f)[:-6] + '.glb')
        if os.path.exists(dest):
            continue
        bpy.ops.wm.open_mainfile(filepath=f)
        fix_materials()
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        objs = [o for o in bpy.context.view_layer.objects if o.type in ('MESH', 'ARMATURE')]
        if not objs:
            continue
        for o in objs:
            o.hide_set(False); o.hide_viewport = False; o.select_set(True)
        for a in bpy.data.actions:
            a.use_fake_user = True
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.export_scene.gltf(filepath=dest, export_format='GLB', use_selection=True, export_apply=True,
                                  export_animations=bool(bpy.data.actions), export_animation_mode='ACTIONS',
                                  export_skins=True, export_yup=True, export_materials='EXPORT')
        n += 1
    print(pack, len(files), 'файлов, сконвертировано', n, flush=True)

if __name__ == '__main__':
    only = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(BLEND_PACKS)
    for p in only:
        convert(p, BLEND_PACKS[p])
