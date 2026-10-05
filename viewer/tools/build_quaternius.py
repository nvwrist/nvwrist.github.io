"""
Готовит CC0-паки Quaternius для PS1-вьюера (без Blender для «универсальных» персонажей — чтобы кости
совпадали с библиотекой анимаций один-в-один).

    python3 viewer/tools/fetch_quaternius.py universal-animation-library universal-animation-library-2 \
        modular-character-outfits-fantasy universal-base-characters
    (cd /tmp/gt && npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4)
    python3 viewer/tools/build_quaternius.py           # -> viewer/models/q/...
    python3 viewer/tools/build_women.py                # Ultimate Modular Women (Blender)

Что делает: копирует нужные .gltf в /tmp/gt/src, уменьшает текстуры до PS1-размера (кожа обесцвечивается,
чтобы её тонировать цветом в браузере), убирает normal/ORM/roughness, пакует в .glb (gltf-transform),
из библиотек анимаций выкидывает манекен и оставляет только анимации.
"""
import glob, json, os, shutil, subprocess
from PIL import Image, ImageEnhance

Q = os.environ.get('QUATERNIUS_CACHE', '/tmp/quaternius')
GT = '/tmp/gt'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'models', 'q'))
SRC = os.path.join(GT, 'src')

def find(pattern):
    r = glob.glob(os.path.join(Q, '**', pattern), recursive=True)
    assert r, pattern
    return r[0]

def tex_size(name):
    n = name.lower()
    if 'eye' in n: return 64
    if 'hair' in n: return 128
    return 256

def prep(gltf_path, key):
    """Копия gltf + ресурсов в /tmp/gt/src/<key>/ с ужатыми текстурами."""
    dst_dir = os.path.join(SRC, key)
    os.makedirs(dst_dir, exist_ok=True)
    j = json.load(open(gltf_path))
    base = os.path.dirname(gltf_path)
    for b in j.get('buffers', []):
        shutil.copy(os.path.join(base, b['uri']), os.path.join(dst_dir, os.path.basename(b['uri'])))
        b['uri'] = os.path.basename(b['uri'])
    for im in j.get('images', []):
        src = os.path.join(base, im['uri'].replace('%20', ' '))
        name = os.path.basename(src)
        out = os.path.join(dst_dir, name)
        if any(k in name for k in ('Normal', 'ORM', 'Roughness')):
            Image.new('RGB', (4, 4), (128, 128, 255)).save(out)  # всё равно будет удалено
        else:
            if not os.path.exists(src):  # некоторые gltf ссылаются на текстуры в соседней папке
                src = find(name)
            img = Image.open(src).convert('RGB')
            s = tex_size(name)
            img = img.resize((s, s), Image.LANCZOS)
            if 'Superhero' in name or 'Regular' in name:  # кожа: обесцвечиваем и высветляем → тонируется в браузере
                img = ImageEnhance.Color(img).enhance(0.25)
                img = ImageEnhance.Brightness(img).enhance(1.35)
            img.save(out)
        im['uri'] = name
    p = os.path.join(dst_dir, key + '.gltf')
    json.dump(j, open(p, 'w'))
    return p

def main():
    shutil.rmtree(SRC, ignore_errors=True)
    jobs = []  # (src.gltf|glb, out.glb, mode)
    ubc = 'Universal Base Characters*'
    jobs.append((prep(find('Superhero_Male_FullBody.gltf'), 'male_base'), f'{OUT}/male/base.glb', 'part'))
    jobs.append((prep(find('Superhero_Female_FullBody.gltf'), 'female_base'), f'{OUT}/female/base.glb', 'part'))
    for g, G in (('male', 'Male'), ('female', 'Female')):
        for o in ('Peasant', 'Ranger'):
            jobs.append((prep(find(f'Outfits/{G}_{o}.gltf'), f'{g}_{o.lower()}'), f'{OUT}/{g}/{o.lower()}.glb', 'part'))
    rig_dir = os.path.dirname(find('Rigged to Head Bone/glTF*/Hair_Long.gltf'))
    for h in sorted(glob.glob(os.path.join(glob.escape(rig_dir), '*.gltf'))):
        n = os.path.basename(h)[:-5]
        jobs.append((prep(h, 'hair_' + n), f'{OUT}/hair/{n}.glb', 'part'))
    jobs.append((find('UAL1_Standard.glb'), f'{OUT}/anims_ual1.glb', 'anims'))
    jobs.append((find('UAL2_Standard.glb'), f'{OUT}/anims_ual2.glb', 'anims'))
    # альтернативные расцветки нарядов (подменяются в браузере)
    os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
    for name, out in (('T_Peasant_BaseColor.png', 'peasant_1'), ('T_Peasant_2_BaseColor.png', 'peasant_2'),
                      ('T_Ranger_BaseColor.png', 'ranger_1'), ('T_Ranger_3_BaseColor.png', 'ranger_2')):
        Image.open(find(name)).convert('RGB').resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, 'tex', out + '.png'))
    json.dump(jobs, open(os.path.join(GT, 'jobs.json'), 'w'), indent=1)
    subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'build_quaternius.mjs'), os.path.join(GT, 'jobs.json')], check=True, cwd=GT)

if __name__ == '__main__':
    main()
