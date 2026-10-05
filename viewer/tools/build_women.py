"""
Ultimate Modular Women (Quaternius, CC0) → viewer/models/q/women.glb: все части 10 нарядов на одном скелете + 24 анимации.

    pip install bpy gdown
    gdown --folder https://drive.google.com/drive/folders/1720N9IGyQHXYvtvZJzazhxtTTlz-y2Vf -O /tmp/quaternius/women
    python3 viewer/tools/build_women.py
"""
import os, bpy
SRC = os.environ.get('WOMEN_BLEND', '/tmp/quaternius/women/All together/Blends/All together.blend')
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'models', 'q', 'women.glb'))

bpy.ops.wm.open_mainfile(filepath=SRC)
arm = bpy.data.objects['CharacterArmature']
objs = [arm] + [o for o in bpy.data.objects if o.type == 'MESH']
for o in objs:
    o.hide_set(False); o.hide_viewport = False; o.hide_render = False
for o in bpy.context.view_layer.objects: o.select_set(o in objs)
bpy.context.view_layer.objects.active = arm
for m in bpy.data.materials:  # матовые материалы, без металла
    if m.node_tree and 'Principled BSDF' in m.node_tree.nodes:
        b = m.node_tree.nodes['Principled BSDF']; b.inputs['Metallic'].default_value = 0; b.inputs['Roughness'].default_value = 1
for a in bpy.data.actions: a.use_fake_user = True
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_yup=True, export_materials='EXPORT')
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
# ужимаем: прореживание ключей анимации + квантование (gltf-transform, см. build_quaternius.mjs)
import json, subprocess, tempfile
jobs = os.path.join(tempfile.gettempdir(), 'women_jobs.json')
json.dump([[OUT, OUT, 'opt']], open(jobs, 'w'))
subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build_quaternius.mjs'), jobs], check=True, cwd='/tmp/gt')
