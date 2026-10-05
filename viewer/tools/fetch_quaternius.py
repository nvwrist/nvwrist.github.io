"""
Скачивает бесплатные (CC0, «Standard») паки Quaternius с itch.io в кэш (по умолчанию /tmp/quaternius).

    python3 viewer/tools/fetch_quaternius.py universal-animation-library universal-animation-library-2 modular-character-outfits-fantasy

Повторяет «бесплатный» сценарий itch.io: Download Now → «No thanks, just take me to the downloads» → файл.
Берутся только файлы, доступные бесплатно (min_price = 0), т.е. [Standard].
"""
import http.cookiejar, json, os, re, sys, urllib.parse, urllib.request, zipfile

CACHE = os.environ.get('QUATERNIUS_CACHE', '/tmp/quaternius')
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
op.addheaders = [('User-Agent', 'Mozilla/5.0'), ('Accept', '*/*')]

def get(url, data=None, headers=None):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None, headers=headers or {})
    with op.open(req, timeout=120) as r:
        return r.read()

def fetch(game, want=r'\[Standard\]'):
    base = f'https://quaternius.itch.io/{game}'
    html = get(base).decode()
    csrf = re.search(r'name="csrf_token" value="([^"]+)"', html) or re.search(r'csrf_token["\']?\s*[:=]\s*["\']([^"\']+)', html)
    csrf = csrf.group(1)
    page = json.loads(get(base + '/download_url', {'csrf_token': csrf}, {'X-Requested-With': 'XMLHttpRequest'}))['url']
    dl = get(page).decode()
    os.makedirs(os.path.join(CACHE, game), exist_ok=True)
    out = []
    for upload_id, name in re.findall(r'data-upload_id="(\d+)".*?<strong title="([^"]+)" class="name"', dl, re.S):
        if not re.search(want, name):
            continue
        dest = os.path.join(CACHE, game, name)
        if not os.path.exists(dest):
            info = json.loads(get(f'{base}/file/{upload_id}?source=game_download&after_download_lightbox=true&as_props=1',
                                  {'csrf_token': csrf}, {'X-Requested-With': 'XMLHttpRequest'}))
            print('download', name)
            data = get(info['url'])
            open(dest, 'wb').write(data)
        folder = dest[:-4]
        if dest.endswith('.zip') and not os.path.isdir(folder):
            zipfile.ZipFile(dest).extractall(folder)
        out.append(folder)
    return out

if __name__ == '__main__':
    for g in sys.argv[1:]:
        print(g, fetch(g))
