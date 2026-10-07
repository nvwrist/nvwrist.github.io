"""
Скачивает бесплатные файлы CC0-паков с itch.io (Quaternius, KayKit/Kay Lousberg) в кэш /tmp/cc0/<автор>/<пак>/.

    python3 viewer/tools/fetch_itch.py --list quaternius/fantasy-props-megakit kaylousberg/kaykit-dungeon
    python3 viewer/tools/fetch_itch.py quaternius/fantasy-props-megakit:Standard kaylousberg/kaykit-adventurers:FREE

Сценарий как у человека: Download Now → «No thanks, just take me to the downloads» → файл.
После ':' — регулярка по имени файла (какие загрузки брать); без неё берутся все бесплатные .zip.
"""
import http.cookiejar, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request, zipfile

CACHE = os.environ.get('CC0_CACHE', '/tmp/cc0')

def opener():
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    op.addheaders = [('User-Agent', 'Mozilla/5.0'), ('Accept', '*/*')]
    return op

def uploads(op, author, game):
    base = f'https://{author}.itch.io/{game}'
    def get(url, data=None, h=None):
        for k in range(6):  # itch.io отвечает 429 при частых запросах — ждём и повторяем
            try:
                return op.open(urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None, headers=h or {}), timeout=300).read()
            except urllib.error.HTTPError as e:
                if e.code != 429 or k == 5: raise
                time.sleep(10 * (k + 1))
    html = get(base).decode()
    csrf = (re.search(r'name="csrf_token" value="([^"]+)"', html) or re.search(r'csrf_token["\']?\s*[:=]\s*["\']([^"\']+)', html)).group(1)
    page = json.loads(get(base + '/download_url', {'csrf_token': csrf}, {'X-Requested-With': 'XMLHttpRequest'}))['url']
    dl = get(page).decode()
    items = re.findall(r'data-upload_id="(\d+)".*?<strong title="([^"]+)" class="name".*?(?:<span class="file_size"><span>([^<]+)</span>)?', dl, re.S)
    return base, csrf, get, items

def fetch(spec, list_only=False):
    path, _, want = spec.partition(':')
    author, game = path.split('/')
    op = opener()
    base, csrf, get, items = uploads(op, author, game)
    out = []
    for upload_id, name, size in items:
        if list_only:
            print(f'  {name}  {size}')
            continue
        if want and not re.search(want, name, re.I):
            continue
        if not want and not re.search(r'\.zip$|^free', name, re.I):
            continue
        fname = name if name.lower().endswith('.zip') else re.sub(r'[^\w.\- ]', '_', name) + '.zip'  # у KayKit загрузки называются «Free 1.1»
        dest = os.path.join(CACHE, author, game, fname)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if not os.path.exists(dest):
            info = json.loads(get(f'{base}/file/{upload_id}?source=game_download&after_download_lightbox=true&as_props=1',
                                  {'csrf_token': csrf}, {'X-Requested-With': 'XMLHttpRequest'}))
            print('download', name, size, flush=True)
            data = get(info['url'])
            open(dest, 'wb').write(data)
        folder = dest[:-4]
        if dest.lower().endswith('.zip') and not os.path.isdir(folder):
            zipfile.ZipFile(dest).extractall(folder)
        out.append(folder)
    return out

if __name__ == '__main__':
    args = sys.argv[1:]
    lst = '--list' in args
    for a in [x for x in args if x != '--list']:
        print(a)
        try:
            r = fetch(a, lst)
            if not lst: print('  ->', r)
        except Exception as e:  # пак мог стать платным/переехать — не валим остальные
            print('  ! ошибка', e)
