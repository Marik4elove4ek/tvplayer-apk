"""
Собирает плейлисты tv.m3u, music.m3u и muzyka.m3u из открытого списка iptv-org.
Запускается каждый день на GitHub (.github/workflows/playlists.yml).
Каналы, которые сейчас не отвечают или отвечают дольше 5 секунд, в плейлист не попадают.
"""
import csv, glob, re, sys, collections, time, urllib.request, concurrent.futures as cf

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
            streams.append(dict(tid=tid, cid=tid.split('@')[0], feed=tid.split('@')[1] if '@' in tid else '',
                                name=l.rsplit(',', 1)[1].strip(), url=url, opts=opts, file=f))
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

tv, music, mine = [], [], []
for s in streams:
    c = ch.get(s['cid'], {})
    if not usable(s, c): continue
    country = c.get('country', ''); cats = c.get('categories', '').split(';'); L = langs(s)
    # Отдельно попросил Марк: VIVA Russia и City TV (Болгария)
    if s['cid'] in ('VIVARussia.ru', 'CityTV.bg'):
        mine.append(('Музыка', s))
    if 'music' in cats and country not in ASIA_FAR:
        g = RU.get(country) or ('Латинская Америка' if country in LAT else 'Арабские' if country in ARAB else 'Другие страны')
        music.append(('🎵 ' + g, s))
    if country == 'IL' or s['file'].endswith('/il.m3u'):
        if 'ara' in L or re.search(r'arab|makan|hala', s['name'], re.I): continue
        tv.append(('Израиль', s)); continue
    if country in ('RU', 'UA') and 'music' in cats:
        tv.append(('Музыка · ' + ('Россия' if country == 'RU' else 'Украина'), s)); continue
    if s['cid'] == 'CityTV.bg':
        tv.append(('Музыка · Болгария', s)); continue
    if 'rus' in L and country and country != 'RU' and country not in ASIA_FAR:
        tv.append(('На русском · ' + COUNTRY_RU.get(country, cname.get(country, country)), s))

tv, music, mine = best(tv), best(music), best(mine)

# Проверка: канал отвечает за 5 секунд и отдаёт поток (а не ошибку или страницу)
UA = 'VLC/3.0.20 LibVLC/3.0.20'
def alive(url):
    try:
        t = time.time()
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=5) as r:
            head = r.read(2048)
            if r.status >= 400: return False
        if time.time() - t > 5: return False
        if '.m3u8' in url or b'#EXTM3U' in head[:20]:
            return b'#EXT' in head
        return len(head) > 0
    except Exception:
        return False

urls = {s['url'] for s in tv + music + mine}
with cf.ThreadPoolExecutor(64) as ex:
    ok = dict(zip(urls, ex.map(alive, urls)))
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
        for s in sorted(groups.get(g, []), key=lambda x: x['name'].lower()):
            # Каналы, которые попросил сам Марк, остаются, даже если сейчас молчат (City TV не круглосуточный)
            if not ok.get(s['url']) and not keep_always: continue
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
