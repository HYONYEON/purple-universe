/* ══════════════════════════════════════════════════════════════════
 *  journey-render.js — 가로 여정 맵(협업 로드맵) 그리기
 *  멤버쉽 페이지와 여정 맵 관리 페이지가 같이 씁니다.
 *
 *  데이터 모양 (journey-data.js 의 window.JOURNEY)
 *  { maps: [ { id, name, sub, color,
 *              stations: [ { title, sub, icon, color, members:[], todo:[], revenue:[], memo } ] } ] }
 * ══════════════════════════════════════════════════════════════════ */
(function(){
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const textW = (s, px) => [...String(s)].reduce((w, ch) => w + (/[\x00-\x7F]/.test(ch) ? px * 0.58 : px * 0.98), 0);
  const GOLD = '#E8B85E';
  /* 긴 문구는 가운데 근처 띄어쓰기에서 두 줄로 (줄마다 최대 22자) */
  function split2(t){
    t = String(t || '').trim();
    if([...t].length <= 18) return [t];
    const mid = Math.floor(t.length / 2);
    let at = -1;
    for(let d = 0; d < mid; d++){
      if(t[mid - d] === ' '){ at = mid - d; break; }
      if(t[mid + d] === ' '){ at = mid + d; break; }
    }
    const a = at > 0 ? t.slice(0, at) : t.slice(0, mid), b = at > 0 ? t.slice(at + 1) : t.slice(mid);
    return [cut(a, 22), cut(b, 22)];
  }

  /* svg 하나에 맵 하나를 그립니다. onPick(index) 은 정거장을 눌렀을 때 */
  function render(svg, map, opt){
    opt = opt || {};
    const S = (map && map.stations) || [];
    const n = S.length, sel = opt.selected;
    const GAP = 290, MID = 300, AMP = 78, ROWH = 42, PGAP = 10;
    const base = (map && map.color) || '#A98BFF';

    if(!n){
      svg.setAttribute('viewBox', '0 0 760 400'); svg.setAttribute('width', 760); svg.setAttribute('height', 400);
      svg.innerHTML = '<text x="380" y="200" text-anchor="middle" fill="#756A94" font-size="16">정거장을 추가하면 여기에 길이 그려져요</text>';
      return;
    }

    /* 1) 자리 계산 — 정거장 위치 + 말풍선을 줄 단위로 배치 (겹치지 않게) */
    const pts = S.map((s, i) => ({ x: i * GAP, y: MID + (i % 2 ? AMP : -AMP) }));
    const ROWW = Math.min(2 * GAP - 70, 500);              // 같은 쪽 이웃 정거장과 겹치지 않는 폭
    let minX = pts[0].x - 140, maxX = pts[n - 1].x + 140, minY = MID - AMP - 120, maxY = MID + AMP + 120;
    const lay = S.map((s, i) => {
      const p = pts[i], up = i % 2 === 0;
      const items = (s.todo || []).filter(Boolean).map(t => ({ t, k:'todo' }))
              .concat((s.revenue || []).filter(Boolean).map(t => ({ t, k:'rev' }))).slice(0, 9);
      const rows = [[]]; let rw = 0;
      items.forEach(it => {
        const full = (it.k === 'rev' ? '₩ ' : '') + String(it.t);
        it.lines = split2(full);                                   // 길면 두 줄로 (자르지 않음)
        it.w = Math.max.apply(null, it.lines.map(l => textW(l, 13))) + 28;
        it.h = it.lines.length > 1 ? 48 : 30;
        if(rows[rows.length - 1].length && rw + it.w > ROWW){ rows.push([]); rw = 0; }
        rows[rows.length - 1].push(it); rw += it.w + PGAP;
      });
      let off = 0;
      rows.forEach(row => {
        const total = row.reduce((a, b) => a + b.w, 0) + PGAP * (row.length - 1);
        const rh = Math.max.apply(null, row.map(b => b.h));
        let x = p.x - total / 2;
        const y = up ? p.y - 85 - off - rh / 2 : p.y + 85 + off + rh / 2;
        off += rh + 12;
        row.forEach(b => { b.cx = x + b.w / 2; b.cy = y; x += b.w + PGAP;
          minX = Math.min(minX, b.cx - b.w / 2); maxX = Math.max(maxX, b.cx + b.w / 2);
          minY = Math.min(minY, b.cy - b.h / 2 - 2); maxY = Math.max(maxY, b.cy + b.h / 2 + 2); });
      });
      // 제목 · 설명 · 멤버 자리 (말풍선 반대편)
      const ty = up ? p.y + 76 : p.y - 120;   // 아래쪽 정거장은 제목·멤버를 번호 배지보다 위로
      const tw = Math.max(textW(cut(s.title, 16), 17), textW(cut(s.sub, 22), 12.5)) / 2 + 10;
      minX = Math.min(minX, p.x - tw); maxX = Math.max(maxX, p.x + tw);
      minY = Math.min(minY, ty - 22); maxY = Math.max(maxY, ty + 64);
      return { p, up, items, ty };
    });
    const PAD = 28;
    minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
    const W = maxX - minX, H = maxY - minY;
    svg.setAttribute('viewBox', minX + ' ' + minY + ' ' + W + ' ' + H);
    svg.setAttribute('width', W); svg.setAttribute('height', H);

    /* 2) 길 */
    const x0 = pts[0].x - 130, x1 = pts[n - 1].x + 130;
    let d = 'M ' + x0 + ' ' + MID, prev = { x: x0, y: MID };
    pts.concat([{ x: x1, y: MID }]).forEach(p => {
      const cx = (prev.x + p.x) / 2;
      d += ' C ' + cx + ' ' + prev.y + ' ' + cx + ' ' + p.y + ' ' + p.x + ' ' + p.y;
      prev = p;
    });
    let h = '<defs>' +
      '<linearGradient id="jRoad" gradientUnits="userSpaceOnUse" x1="' + x0 + '" x2="' + x1 + '" y1="0" y2="0">' +
        S.map((s, i) => '<stop offset="' + ((pts[i].x - x0) / (x1 - x0)) + '" stop-color="' + esc(s.color || base) + '"/>').join('') +
      '</linearGradient>' +
      '<filter id="jGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '</defs>';
    h += '<path d="' + d + '" fill="none" stroke="url(#jRoad)" stroke-width="40" stroke-linecap="round" opacity=".22"/>' +
         '<path d="' + d + '" fill="none" stroke="url(#jRoad)" stroke-width="3" stroke-linecap="round" opacity=".9"/>' +
         '<path id="jPath" d="' + d + '" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5" stroke-dasharray="2 12"/>';
    for(let k = 0; k < 3; k++){
      h += '<circle r="5" fill="#fff" opacity=".85"><animateMotion dur="' + (9 + n) + 's" begin="' + (k * (9 + n) / 3) + 's" repeatCount="indefinite"><mpath href="#jPath"/></animateMotion></circle>';
    }

    /* 3) 정거장 */
    S.forEach((s, i) => {
      const L = lay[i], p = L.p, c = s.color || base;
      const on = sel === i, dim = sel != null && !on;
      let lines = '', pills = '';
      L.items.forEach(it => {
        const col = it.k === 'rev' ? GOLD : c, ey = it.cy + (L.up ? it.h / 2 : -it.h / 2);
        lines += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + it.cx + '" y2="' + ey + '" stroke="' + esc(col) + '" stroke-width="1.3" opacity=".45"/>';
        pills += '<g><title>' + esc(it.t) + '</title>' +
          '<rect x="' + (it.cx - it.w/2) + '" y="' + (it.cy - it.h/2) + '" width="' + it.w + '" height="' + it.h + '" rx="' + (it.h > 30 ? 18 : 15) + '" fill="' + (it.k === 'rev' ? '#2A2015' : '#140D26') + '" stroke="' + esc(col) + '" stroke-width="1.4"/>' +
          it.lines.map((ln, li) => '<text x="' + it.cx + '" y="' + (it.lines.length > 1 ? it.cy - 4 + li * 17 : it.cy + 4.5) + '" text-anchor="middle" font-size="13" font-weight="' + (it.k === 'rev' ? 700 : 500) + '" fill="' + (it.k === 'rev' ? '#F3D89A' : '#E9E3FA') + '">' + esc(ln) + '</text>').join('') + '</g>';
      });
      let g = lines +
           '<circle cx="' + p.x + '" cy="' + p.y + '" r="58" fill="' + esc(c) + '" opacity="' + (on ? .45 : .18) + '" filter="url(#jGlow)"/>' +
           '<circle cx="' + p.x + '" cy="' + p.y + '" r="46" fill="#120B22" stroke="' + esc(c) + '" stroke-width="' + (on ? 4 : 3) + '"/>' +
           '<text x="' + p.x + '" y="' + (p.y + 11) + '" text-anchor="middle" font-size="30">' + esc(s.icon || '✦') + '</text>' +
           '<circle cx="' + (p.x - 34) + '" cy="' + (p.y - 34) + '" r="14" fill="' + esc(c) + '"/>' +
           '<text x="' + (p.x - 34) + '" y="' + (p.y - 29) + '" text-anchor="middle" font-size="13" font-weight="800" fill="#120B22">' + (i + 1) + '</text>' +
           pills;
      const ty = L.ty;
      g += '<text x="' + p.x + '" y="' + ty + '" text-anchor="middle" font-size="17" font-weight="800" fill="#F4F1FC">' + esc(cut(s.title, 16)) + '</text>';
      if(s.sub) g += '<text x="' + p.x + '" y="' + (ty + 21) + '" text-anchor="middle" font-size="12.5" fill="#B7ACD1">' + esc(cut(s.sub, 22)) + '</text>';
      const mem = (s.members || []).filter(Boolean);
      if(mem.length){
        const ml = mem.slice(0, 3).join(' · ') + (mem.length > 3 ? ' +' + (mem.length - 3) : '');
        const mw = textW(ml, 12) + 22, my = ty + (s.sub ? 32 : 12);
        g += '<rect x="' + (p.x - mw/2) + '" y="' + my + '" width="' + mw + '" height="24" rx="12" fill="#1A1230" stroke="rgba(184,155,255,.3)"/>' +
             '<text x="' + p.x + '" y="' + (my + 16.5) + '" text-anchor="middle" font-size="12" fill="#C9B6FF">' + esc(ml) + '</text>';
      }
      h += '<g class="j-st" data-i="' + i + '" style="cursor:pointer; transition:opacity .2s;" opacity="' + (dim ? .32 : 1) + '">' + g + '</g>';
    });

    h += '<text x="' + (x1 + 6) + '" y="' + (MID - 26) + '" text-anchor="end" font-size="12" font-weight="700" letter-spacing="2" fill="#756A94">NEXT →</text>';
    svg.innerHTML = h;
    svg.querySelectorAll('.j-st').forEach(el => el.addEventListener('click', () => opt.onPick && opt.onPick(+el.dataset.i)));
  }

  /* 정거장 자세히 (오른쪽 칸) */
  function detail(map, i){
    const S = (map && map.stations) || [];
    if(i == null || !S[i]){
      const rev = S.reduce((a, s) => a.concat(s.revenue || []), []).filter(Boolean);
      return '<h4>' + esc(map ? map.name : '') + '</h4>' +
        (map && map.sub ? '<p class="j-sub">' + esc(map.sub) + '</p>' : '') +
        '<p class="j-hint">정거장을 누르면 할 일 · 함께하는 멤버 · 생기는 수익이 보여요.</p>' +
        (rev.length ? '<div class="j-lb">이 길에서 생기는 수익</div><ul>' + rev.map(r => '<li class="rev">₩ ' + esc(r) + '</li>').join('') + '</ul>' : '');
    }
    const s = S[i], c = s.color || (map.color || '#A98BFF');
    return '<div class="j-step" style="--c:' + esc(c) + '">STEP ' + (i + 1) + '</div>' +
      '<h4>' + esc((s.icon ? s.icon + ' ' : '') + s.title) + '</h4>' +
      (s.sub ? '<p class="j-sub">' + esc(s.sub) + '</p>' : '') +
      ((s.members || []).length ? '<div class="j-lb">함께하는 멤버</div><div class="j-mem">' + s.members.map(m => '<span>' + esc(m) + '</span>').join('') + '</div>' : '') +
      ((s.todo || []).length ? '<div class="j-lb">할 일</div><ul>' + s.todo.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '') +
      ((s.revenue || []).length ? '<div class="j-lb">생기는 수익</div><ul>' + s.revenue.map(t => '<li class="rev">₩ ' + esc(t) + '</li>').join('') + '</ul>' : '') +
      (s.memo ? '<p class="j-memo">✦ ' + esc(s.memo) + '</p>' : '');
  }

  window.JourneyMap = { render, detail };
})();
