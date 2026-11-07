"""
Собирает плейлисты tv.m3u, music.m3u и muzyka.m3u из открытого списка iptv-org.
Запускается каждый день на GitHub (.github/workflows/playlists.yml).
Каналы, которые сейчас не отвечают или отвечают дольше 5 секунд, в плейлист не попадают.
"""
import csv, glob, re, sys, collections, time, urllib.request, urllib.parse, concurrent.futures as cf

ST, DB = sys.argv[1], sys.argv[2]   # папки iptv/streams и database/data
OUT = sys.argv[3] if len(sys.argv) > 3 else '.'

ch = {r['id']: r for r in csv.DictReader(open(f'{DB}/channels.csv', encoding='utf-8'))}
feeds = collections.defaultdict(list)
for r in csv.DictReader(open(f'{DB}/feeds.csv', encoding='utf-8')):
    feeds[r['channel']].append(r)
logos = {}
for r in csv.DictReader(open(f'{DB}/logos.csv', encoding='utf-8')):
    if r['channel'] not in logos and r.get('in_use') == 'TRUE':
        logos[r['channel']] = r['url']
blocked = {r.get('channel') for r in csv.DictReader(open(f'{DB}/blocklist.csv', encoding='utf-8'))}
cname = {r['code']: r['name'] for r in csv.DictReader(open(f'{DB}/countries.csv', encoding='utf-8'))}
regions = {r['code']: set(r['countries'].split(';')) for r in csv.DictReader(open(f'{DB}/regions.csv', encoding='utf-8'))}
# Азия, которая нам не нужна: Дальний Восток, Юго-Восточная и Южная Азия, Океания
ASIA_FAR = regions.get('EAS', set()) | regions.get('SEA', set()) | regions.get('SAS', set()) | regions.get('APAC', set())
# Марк попросил убрать: Казахстан, Узбекистан и другие страны Средней Азии, Азербайджан, Турцию
ASIA_FAR |= regions.get('CAS', set()) | {'KZ', 'UZ', 'KG', 'TJ', 'TM', 'AZ', 'TR'}

streams = []
for f in sorted(glob.glob(f'{ST}/*.m3u')):
    lines = open(f, encoding='utf-8').read().splitlines()
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith('#EXTINF'):
            opts = []; j = i + 1
            while j < len(lines) and lines[j].startswith('#'):
                opts.append(lines[j]); j += 1
            url = lines[j].strip() if j < len(lines) else ''
            m = re.search(r'tvg-id="([^"]*)"', l); tid = m.group(1) if m else ''
            # Особые настройки (#EXTVLCOPT) пишем в адрес после «|» — плеер Lupo понимает их с версии 2.12
            hdr = {}
            for o in opts:
                kv = o.split(':', 1)[1] if ':' in o else ''
                k, _, v = kv.partition('=')
                k = k.strip().lower(); v = v.strip()
                if v and k == 'http-user-agent': hdr['User-Agent'] = v
                elif v and k in ('http-referrer', 'http-referer'): hdr['Referer'] = v
                elif v and k == 'http-origin': hdr['Origin'] = v
            bad = any(o.split(':', 1)[0].upper() not in ('#EXTVLCOPT',) for o in opts)
            if hdr:
                url = url + '|' + '&'.join(k + '=' + urllib.parse.quote(v, safe='') for k, v in hdr.items())
            streams.append(dict(tid=tid, cid=tid.split('@')[0], feed=tid.split('@')[1] if '@' in tid else '',
                                name=l.rsplit(',', 1)[1].strip(), url=url, opts=opts if bad else [], file=f))
            i = j + 1
        else:
            i += 1

def langs(s):
    fs = feeds.get(s['cid'], [])
    f = [x for x in fs if x['id'] == s['feed']] or [x for x in fs if x['is_main'] == 'TRUE'] or fs
    return set(sum([x['languages'].split(';') for x in f], []))

def res(n):
    m = re.search(r'\((\d+)p\)', n); return int(m.group(1)) if m else 0

def usable(s, c):
    # Особые настройки (плеер их не понимает), запрет для других стран, пересылки платных каналов, 18+
    if s['opts'] or '[Geo-blocked]' in s['name'] or not s['url'].startswith('http'): return False
    if re.search(r'//(89\.33\.29\.115|stream\.mcquack\.net)', s['url']): return False
    if c.get('is_nsfw') == 'TRUE' or c.get('closed') or s['cid'] in blocked: return False
    return True

RU = {'RU': 'Россия', 'UA': 'Украина', 'BY': 'Беларусь', 'KZ': 'Казахстан', 'IL': 'Израиль', 'BG': 'Болгария', 'GR': 'Греция',
      'TR': 'Турция', 'DE': 'Германия', 'AT': 'Германия', 'FR': 'Франция', 'BE': 'Франция', 'IT': 'Италия', 'ES': 'Испания',
      'PT': 'Португалия', 'UK': 'Великобритания', 'US': 'США', 'CA': 'Канада', 'NL': 'Нидерланды', 'PL': 'Польша', 'CZ': 'Чехия',
      'RO': 'Румыния', 'RS': 'Сербия', 'MK': 'Македония', 'EE': 'Эстония', 'LT': 'Литва', 'AM': 'Армения', 'GE': 'Грузия',
      'AZ': 'Азербайджан', 'LV': 'Латвия', 'MD': 'Молдова', 'HU': 'Венгрия', 'HR': 'Хорватия', 'SK': 'Словакия', 'SI': 'Словения',
      'AL': 'Албания', 'CY': 'Кипр', 'FI': 'Финляндия', 'SE': 'Швеция', 'NO': 'Норвегия', 'DK': 'Дания', 'IE': 'Ирландия', 'CH': 'Швейцария'}
LAT = regions.get('AMER', set()) - {'US', 'CA'}
ARAB = {'SA', 'LB', 'AE', 'EG', 'IQ', 'JO', 'KW', 'QA', 'MA', 'DZ', 'TN', 'SY', 'OM', 'BH', 'YE', 'LY', 'PS', 'SD'}
# Марк попросил убрать: Сербию, Словению, Македонию и арабские страны
ASIA_FAR |= ARAB | {'RS', 'SI', 'MK'}
# «Другие страны» (Африка, Иран и прочие) Марку не нужны — в плейлистах только страны, у которых есть своя папка
ASIA_FAR |= regions.get('AFR', set()) | {'IR'}
RU['LU'] = 'Люксембург'
COUNTRY_RU = {'AZ': 'Азербайджан', 'BY': 'Беларусь', 'CA': 'Канада', 'CN': 'Китай', 'CZ': 'Чехия', 'EE': 'Эстония', 'FR': 'Франция',
              'GE': 'Грузия', 'DE': 'Германия', 'IN': 'Индия', 'KZ': 'Казахстан', 'KG': 'Кыргызстан', 'LU': 'Люксембург', 'MD': 'Молдова',
              'NL': 'Нидерланды', 'PL': 'Польша', 'PT': 'Португалия', 'RO': 'Румыния', 'TM': 'Туркменистан', 'UA': 'Украина',
              'UK': 'Великобритания', 'US': 'США', 'UZ': 'Узбекистан', 'LV': 'Латвия', 'LT': 'Литва', 'IL': 'Израиль', 'AM': 'Армения'}

def best(pairs):
    out = collections.OrderedDict()
    for g, s in pairs:
        key = (g, s['cid'] or s['name'])
        if key in out and res(out[key]['name']) >= res(s['name']): continue
        out[key] = dict(s, group=g)
    return list(out.values())

tv, music, mine, kino, views = [], [], [], [], []
# В базе отмечены как русскоязычные, а на деле идут не на русском (Марк проверил) — в «На русском» не берём
NOT_RUSSIAN = {'TraceSportStars.fr'}
for s in streams:
    c = ch.get(s['cid'], {})
    if not usable(s, c): continue
    country = c.get('country', ''); cats = c.get('categories', '').split(';'); L = langs(s)
    # Отдельно попросил Марк: VIVA Russia и City TV (Болгария)
    if s['cid'] in ('VIVARussia.ru', 'CityTV.bg'):
        mine.append(('Музыка', s))
    # Кино и сериалы на русском (переведённые фильмы) — по стране канала
    if ('movies' in cats or 'series' in cats) and 'rus' in L and country not in ASIA_FAR:
        kino.append(('🎬 ' + ('Россия' if country == 'RU' else COUNTRY_RU.get(country, cname.get(country, country or 'Разное'))), s))
    # Релакс (камины, аквариумы, природа, космос) и виды/путешествия (веб-камеры, города, пляжи)
    if 'relax' in cats and country not in ASIA_FAR:
        views.append(('🌿 Релакс и природа', s))
    elif 'travel' in cats and country not in ASIA_FAR:
        views.append(('📷 Виды и путешествия', s))
    if 'music' in cats and country not in ASIA_FAR:
        g = RU.get(country) or ('Латинская Америка' if country in LAT else None)
        if g: music.append(('🎵 ' + g, s))
    if country == 'IL' or s['file'].endswith('/il.m3u'):
        if 'ara' in L or re.search(r'arab|makan|hala', s['name'], re.I): continue
        tv.append(('Израиль', s)); continue
    if country in ('RU', 'UA') and 'music' in cats:
        tv.append(('Музыка · ' + ('Россия' if country == 'RU' else 'Украина'), s)); continue
    if s['cid'] == 'CityTV.bg':
        tv.append(('Музыка · Болгария', s)); continue
    if 'rus' in L and country and country != 'RU' and country not in ASIA_FAR and s['cid'] not in NOT_RUSSIAN:
        tv.append(('На русском · ' + COUNTRY_RU.get(country, cname.get(country, country)), s))

tv, music, mine, kino, views = best(tv), best(music), best(mine), best(kino), best(views)

# Проверка: канал отвечает за 5 секунд и отдаёт поток (а не ошибку или страницу)
UA = 'VLC/3.0.20 LibVLC/3.0.20'
def alive(full):
    try:
        t = time.time()
        url, _, extra = full.partition('|')
        h = {'User-Agent': UA}
        for part in extra.split('&') if extra else []:
            k, _, v = part.partition('=')
            if v: h[k] = urllib.parse.unquote(v)
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=5) as r:
            head = r.read(2048)
            if r.status >= 400: return False
        if time.time() - t > 5: return False
        if '.m3u8' in url or b'#EXTM3U' in head[:20]:
            return b'#EXT' in head
        return len(head) > 0
    except Exception:
        return False

urls = {s['url'] for s in tv + music + mine + kino + views}
with cf.ThreadPoolExecutor(64) as ex:
    ok = dict(zip(urls, ex.map(alive, urls)))
# Израильские каналы часто закрыты для зрителей не из Израиля, а проверка идёт с серверов в США:
# там они «молчат», хотя у Марка работают. Поэтому их считаем рабочими всегда
for x in tv:
    if x['group'] == 'Израиль': ok[x['url']] = True
print('проверено', len(urls), 'работают', sum(ok.values()))
# Сеть у сервера сборки сбоила (работает меньше пятой части) — старые плейлисты не трогаем
if sum(ok.values()) < len(urls) // 5:
    print('слишком мало рабочих каналов — плейлисты не меняю')
    sys.exit(0)

def write(name, items, order, keep_always=False):
    lines = ['#EXTM3U']; n = 0
    groups = collections.defaultdict(list)
    for s in items: groups[s['group']].append(s)
    for g in order + sorted(k for k in groups if k not in order):
        for s in sorted(groups.get(g, []), key=lambda x: (not x.get('pin'), x['name'].lower())):
            # Каналы, которые попросил сам Марк, остаются, даже если сейчас молчат (City TV не круглосуточный)
            if not ok.get(s['url']) and not keep_always and s['group'] != '⭐ Моя музыка' and not s.get('pin'): continue
            nm = re.sub(r'\s*\[(Not 24/7)\]', '', re.sub(r'\s*\(\d+p\)', '', s['name'])).strip()
            if s['cid'] == 'CityTV.bg': nm = 'City TV (Болгария)'
            logo = logos.get(s['cid'])
            lines.append(f'#EXTINF:-1 tvg-id="{s["tid"]}"' + (f' tvg-logo="{logo}"' if logo else '') + f' group-title="{g}",{nm}')
            lines.append(s['url']); n += 1
    open(f'{OUT}/{name}', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print(name, n)

write('tv.m3u', tv, ['Израиль', 'Музыка · Россия', 'Музыка · Украина', 'Музыка · Болгария'])
write('music.m3u', music, ['🎵 ' + x for x in ['Россия', 'Украина', 'Беларусь', 'Казахстан', 'Израиль', 'Болгария', 'Греция', 'Турция',
      'Армения', 'Грузия', 'Азербайджан', 'Великобритания', 'США', 'Канада', 'Германия', 'Франция', 'Италия', 'Испания']])
write('muzyka.m3u', mine, ['Музыка'], keep_always=True)
write('kino.m3u', kino, ['🎬 Россия', '🎬 Украина', '🎬 Беларусь', '🎬 Казахстан'])

# Всё в одном файле (all.m3u): моя музыка, Израиль, кино, каналы на русском, вся музыка.
# Музыкальные папки из tv.m3u не повторяем — эти каналы уже есть в «🎵 …»
everything = [dict(s, group='⭐ Моя музыка') for s in mine] + \
    [s for s in tv if not s['group'].startswith('Музыка · ')] + kino + music + views
# Марк отметил каналы на странице выбора (picks.json) — в общем файле только они (и «Моя музыка»)
import json, os
if os.path.exists(f'{OUT}/picks.json'):
    picked = set(json.load(open(f'{OUT}/picks.json', encoding='utf-8')).get('ids', []))
    if picked:
        def cid_of(s):
            return s['tid'] or re.sub(r'\s*\[(Not 24/7)\]', '', re.sub(r'\s*\(\d+p\)', '', s['name'])).strip()
        everything = [s for s in everything if s['group'] == '⭐ Моя музыка' or cid_of(s) in picked]
# Папки в общем файле — крупные: Израиль, На русском, Кино, Музыка (Марк попросил собрать всё вместе).
# «Моя музыка» (VIVA Russia, City TV) — первой в папке «Музыка»
def big(s):
    g = s['group']
    if g == 'Израиль': return 'Израиль'
    if g.startswith('На русском'): return 'На русском'
    if g.startswith('🎬'): return '🎬 Кино'
    if g in ('🌿 Релакс и природа', '📷 Виды и путешествия'): return g
    return '🎵 Музыка'
# Канал есть в нескольких папках (например, белорусская музыка — и «На русском», и «Музыка»):
# оставляем одну, по старшинству: Израиль, Музыка, Кино, На русском, остальное
rank = {'Израиль': 0, '🎵 Музыка': 1, '🎬 Кино': 2, 'На русском': 3}
chosen = {}
for s in everything:
    item = dict(s, group=big(s), pin=s['group'] == '⭐ Моя музыка')
    cur = chosen.get(s['url'])
    if cur is None or rank.get(item['group'], 9) < rank.get(cur['group'], 9) or (item['pin'] and not cur['pin']):
        chosen[s['url']] = item
merged = list(chosen.values())
write('all.m3u', merged, ['Израиль', 'На русском', '🎬 Кино', '🎵 Музыка', '🌿 Релакс и природа', '📷 Виды и путешествия'])

# Каталог для страницы выбора каналов: все проверенные каналы с папкой, логотипом и «работает ли сейчас»
import json
cat = []
seen = set()
for s in mine + tv + kino + music + views:
    key = (s['cid'] or s['name'], s['url'])
    if key in seen: continue
    seen.add(key)
    nm = re.sub(r'\s*\[(Not 24/7)\]', '', re.sub(r'\s*\(\d+p\)', '', s['name'])).strip()
    cat.append({'id': s['tid'] or nm, 'n': nm, 'g': s['group'], 'l': logos.get(s['cid'], ''), 'u': s['url'], 'ok': bool(ok.get(s['url']))})
json.dump(cat, open(f'{OUT}/catalog.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('catalog.json', len(cat))

