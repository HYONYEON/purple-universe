#!/usr/bin/env python3
"""데일리·위클리 클리핑 카드뉴스를 30X 퍼플 노트에 발행 (관리자 페이지 '발행하기'와 같은 결과)

관리자 페이지(manage-a13l742d7a.html)의 save() 흐름을 그대로 옮긴 것:
  ① images/<stamp>_<rand5>_<파일명>.png  — 본문 이미지(카드 1~4장, CTA 제외)
  ② images/<stamp>_<rand5>_og-<번호>.jpg — 카톡 미리보기용 1200×630 (제목 덩어리 자동 탐지)
  ③ n/<번호>.html                         — 카톡 공유용 페이지
  ④ notes-data.js 의 window.NOTES         — 항목 추가 (날짜 내림차순)

한 줄 요약(desc)은 카드 1번(커버)의 큰 제목(<h1>)을 한 줄로 이은 것 (11/27 대표님 결정).

사용 예 (저장소 루트에서):
  python3 _tools/publish_clipping.py --date 2026-11-27 --cards out/cards_B.html \
      out/1127_B_01_cover.png out/1127_B_02_news1.png out/1127_B_03_news2.png out/1127_B_04_news3.png

  --desc 로 요약을 직접 줄 수도 있음. --dry-run 은 파일만 만들고 notes-data.js 는 출력만.
  같은 날짜·같은 요약 글이 이미 있으면 아무것도 하지 않고 종료(중복 발행 방지).
  커밋·푸시는 하지 않음 — 호출한 쪽에서 git add/commit/push.
"""
import argparse, html, json, os, random, re, string, sys, time
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(ROOT, 'notes-data.js')
SITE = 'https://purpleuniverse.net'
CATS = {'webinar': '웨비나', 'live': 'LIVE', 'marketing': '마케팅 뉴스클리핑',
        'insight': '비즈니스 인사이트', 'sns': 'SNS 인사이트'}
OG_W, OG_H, OG_TOP, OG_VER = 1200, 630, 0.08, 2


# ---------- notes-data.js ----------
def load_notes():
    t = open(DATA_FILE, encoding='utf-8').read()
    m = re.search(r'window\.NOTES\s*=\s*([\s\S]*?);?\s*$', t)
    return t[:t.index('window.NOTES')], json.loads(m.group(1).strip().rstrip(';'))


def dump_notes(head, notes):
    return head + 'window.NOTES = ' + json.dumps(notes, ensure_ascii=False, indent=2) + ';\n'


# ---------- 커버 제목 ----------
def title_from_cards(path):
    src = open(path, encoding='utf-8').read()
    m = re.search(r'id="c1"[\s\S]*?<h1[^>]*>([\s\S]*?)</h1>', src)
    if not m:
        sys.exit('cards html 에서 커버 <h1> 을 찾지 못했습니다: ' + path)
    s = re.sub(r'<br\s*/?>', ' ', m.group(1))
    s = re.sub(r'<[^>]+>', '', s)
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


# ---------- 파일명 ----------
def stamp_name(name):
    rnd = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(5))
    time.sleep(0.003)  # 같은 ms 방지
    return f'{int(time.time() * 1000)}_{rnd}_' + re.sub(r'[^\w.\-]', '_', name)


# ---------- 카톡 띠 자르기 (detectTopFrac 이식) ----------
def detect_top_frac(img, band_frac):
    try:
        W = 200
        H = round(img.height / img.width * W)
        if not H:
            return OG_TOP
        g = img.convert('RGB').resize((W, H), Image.BILINEAR)
        px = g.load()
        lit = []
        for y in range(H):
            c = 0
            for x in range(W):
                r, gg, b = px[x, y]
                if r * 0.299 + gg * 0.587 + b * 0.114 > 150:
                    c += 1
            lit.append(c)
        th = W * 0.03
        rows, s = [], -1
        for y in range(H + 1):
            on = y < H and lit[y] > th
            if on:
                if s < 0:
                    s = y
            elif s >= 0:
                if y - s >= 2:
                    rows.append((s, y - 1))
                s = -1
        cand = [r for r in rows if r[0] / H > 0.10]
        if not cand:
            return OG_TOP
        gap = H * 0.06
        bot = cand[0][1]
        for r in cand[1:]:
            if r[0] - bot > gap:
                break
            bot = r[1]
        f0, f1, pad = cand[0][0] / H, bot / H, 0.02
        block = f1 - f0
        if block + pad * 2 >= band_frac:
            return max(0, f0 - pad)
        f = f0 - (band_frac - block) / 2
        return min(max(0, f), max(0, 1 - band_frac))
    except Exception:
        return OG_TOP


def make_og(cover_path):
    img = Image.open(cover_path).convert('RGB')
    W, H = img.size
    if W / H > 1.5:
        return None, None
    band_h = round(W / (OG_W / OG_H))
    frac = detect_top_frac(img, band_h / H)
    imgtop = round(frac * 10000) / 10000
    top = round(H * frac)
    if top + band_h > H:
        top = max(0, H - band_h)
    canvas = Image.new('RGB', (OG_W, OG_H), (8, 5, 15))
    canvas.paste(img.crop((0, top, W, top + band_h)).resize((OG_W, OG_H), Image.LANCZOS), (0, 0))
    return canvas, imgtop


# ---------- 공유 페이지 (ogPageHTML 이식) ----------
def attr(v):
    return (str(v or '').replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def og_page(n):
    url = f"{SITE}/n/{n['no']}"
    hsh = f"/notes#{n['no']}"
    cat = CATS.get(n['cat'], '')
    title = (n.get('title') or n.get('desc') or cat or '30X 퍼플 노트 녹화본').split('\n')[0] \
        + (' — ' + cat if cat else '') + ' | 30X 퍼플 노트'
    desc = n.get('desc') or ((cat + ' · ' if cat else '') + '30X 퍼플 노트에서 전체 내용을 확인하세요.')
    img = SITE + '/' + n['ogimg'].lstrip('/')
    return ('<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="UTF-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
            f'<title>{attr(title)}</title>\n'
            f'<meta name="description" content="{attr(desc)}">\n'
            '<meta property="og:type" content="article">\n'
            '<meta property="og:site_name" content="퍼플 유니버스">\n'
            '<meta property="og:locale" content="ko_KR">\n'
            f'<meta property="og:title" content="{attr(title)}">\n'
            f'<meta property="og:description" content="{attr(desc)}">\n'
            f'<meta property="og:url" content="{attr(url)}">\n'
            f'<meta property="og:image" content="{attr(img)}">\n'
            f'<meta property="og:image:secure_url" content="{attr(img)}">\n'
            '<meta property="og:image:width" content="1200">\n'
            '<meta property="og:image:height" content="630">\n'
            f'<meta property="og:image:alt" content="{attr(n.get("title") or n.get("desc") or "30X 퍼플 노트")}">\n'
            '<meta name="twitter:card" content="summary_large_image">\n'
            f'<meta name="twitter:title" content="{attr(title)}">\n'
            f'<meta name="twitter:description" content="{attr(desc)}">\n'
            f'<meta name="twitter:image" content="{attr(img)}">\n'
            f'<link rel="canonical" href="{attr(SITE + hsh)}">\n'
            f'<script>location.replace({json.dumps(hsh)});</script>\n'
            '</head>\n'
            '<body style="background:#08050F;color:#B7ACD1;font-family:sans-serif;'
            'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">\n'
            f'<p>자료를 여는 중…<br><a href="{attr(hsh)}" style="color:#A98BFF;">바로 열기</a></p>\n'
            '</body>\n</html>\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', required=True, help='발행일 YYYY-MM-DD (한국시간)')
    ap.add_argument('--cards', help='카드 HTML — 커버 <h1> 을 한 줄 요약으로 씀')
    ap.add_argument('--desc', help='한 줄 요약 직접 지정')
    ap.add_argument('--cat', default='marketing')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('pngs', nargs='+', help='카드 PNG (커버부터 순서대로, CTA 제외)')
    a = ap.parse_args()

    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', a.date):
        sys.exit('날짜 형식은 YYYY-MM-DD')
    desc = a.desc or (title_from_cards(a.cards) if a.cards else None)
    if not desc:
        sys.exit('--cards 또는 --desc 가 필요합니다')
    for p in a.pngs:
        if not os.path.isfile(p):
            sys.exit('PNG 없음: ' + p)
        if os.path.getsize(p) > 4 * 1024 * 1024:
            print('경고: 4MB 초과 (관리자 페이지 제한) —', p, file=sys.stderr)

    head, notes = load_notes()
    for n in notes:
        if n.get('date') == a.date and n.get('desc') == desc:
            print(json.dumps({'skipped': True, 'reason': '이미 발행됨', 'no': n.get('no'),
                              'url': f"{SITE}/n/{n.get('no')}"}, ensure_ascii=False))
            return

    no = max((int(n.get('no') or 0) for n in notes), default=0) + 1
    body, written = [], []
    for p in a.pngs:
        rel = 'images/' + stamp_name(os.path.basename(p))
        if not a.dry_run:
            with open(p, 'rb') as fi, open(os.path.join(ROOT, rel), 'wb') as fo:
                fo.write(fi.read())
        written.append(rel)
        body.append({'t': 'img', 'v': rel})

    item = {'cat': a.cat, 'date': a.date, 'title': '', 'desc': desc, 'yt': '', 'img': '',
            'link': '', 'embed': '', 'body': body, 'no': no}

    og, imgtop = make_og(a.pngs[0])
    if og is not None:
        item['imgtop'] = imgtop
        rel = 'images/' + stamp_name(f'og-{no}.jpg')
        if not a.dry_run:
            og.save(os.path.join(ROOT, rel), 'JPEG', quality=92)
        else:
            og.save(f'/tmp/og-{no}-preview.jpg', 'JPEG', quality=92)
        written.append(rel)
        item['ogimg'] = rel
    else:
        item['ogimg'] = body[0]['v']
    item['ogv'] = OG_VER

    notes.insert(0, item)
    notes.sort(key=lambda n: n.get('date', ''), reverse=True)  # 안정 정렬 = 관리자 페이지와 동일

    page = og_page(item)
    if a.dry_run:
        print(json.dumps(item, ensure_ascii=False, indent=2))
    else:
        with open(os.path.join(ROOT, 'n', f'{no}.html'), 'w', encoding='utf-8') as f:
            f.write(page)
        written.append(f'n/{no}.html')
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            f.write(dump_notes(head, notes))
        written.append('notes-data.js')
    print(json.dumps({'no': no, 'desc': desc, 'url': f'{SITE}/n/{no}', 'imgtop': item.get('imgtop'),
                      'files': written}, ensure_ascii=False))


if __name__ == '__main__':
    main()
