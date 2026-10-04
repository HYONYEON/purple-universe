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

  /* svg 하나에 맵 하나를 그립니다. onPick(index) 은 정거장을 눌렀을 때 */
  function render(svg, map, opt){
    opt = opt || {};
    const S = (map && map.stations) || [];
    const n = S.length, sel = opt.selected;
    const GAP = 270, PADX = 150, MID = 300, AMP = 78, H = 600;
    const W = Math.max(PADX * 2 + GAP * Math.max(n - 1, 0), 760);
    const base = (map && map.color) || '#A98BFF';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W); svg.setAttribute('height', H);

    if(!n){
      svg.innerHTML = '<text x="' + W/2 + '" y="' + H/2 + '" text-anchor="middle" fill="#756A94" font-size="16">정거장을 추가하면 여기에 길이 그려져요</text>';
      return;
    }

    const pts = S.map((s, i) => ({ x: PADX + i * GAP, y: MID + (i % 2 ? AMP : -AMP) }));
    let d = 'M 24 ' + MID, prev = { x: 24, y: MID };
    pts.concat([{ x: W - 24, y: MID }]).forEach(p => {
      const cx = (prev.x + p.x) / 2;
      d += ' C ' + cx + ' ' + prev.y + ' ' + cx + ' ' + p.y + ' ' + p.x + ' ' + p.y;
      prev = p;
    });

    let h = '<defs>' +
      '<linearGradient id="jRoad" x1="0" x2="1" y1="0" y2="0">' +
        S.map((s, i) => '<stop offset="' + (n > 1 ? i / (n - 1) : 0) + '" stop-color="' + esc(s.color || base) + '"/>').join('') +
      '</linearGradient>' +
      '<filter id="jGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '</defs>';

    // 길
    h += '<path d="' + d + '" fill="none" stroke="url(#jRoad)" stroke-width="40" stroke-linecap="round" opacity=".22"/>' +
         '<path d="' + d + '" fill="none" stroke="url(#jRoad)" stroke-width="3" stroke-linecap="round" opacity=".9"/>' +
         '<path id="jPath" d="' + d + '" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5" stroke-dasharray="2 12"/>';
    // 길 위를 걷는 빛
    for(let k = 0; k < 3; k++){
      h += '<circle r="5" fill="#fff" opacity=".85"><animateMotion dur="' + (9 + n) + 's" begin="' + (k * (9 + n) / 3) + 's" repeatCount="indefinite"><mpath href="#jPath"/></animateMotion></circle>';
    }

    // 정거장
    S.forEach((s, i) => {
      const p = pts[i], up = i % 2 === 0, c = s.color || base;
      const on = sel === i, dim = sel != null && !on;
      const items = (s.todo || []).filter(Boolean).map(t => ({ t, k:'todo' }))
              .concat((s.revenue || []).filter(Boolean).map(t => ({ t, k:'rev' }))).slice(0, 7);
      let g = '';
      // 가지
      const m = items.length, span = m > 1 ? Math.min(150, 34 * (m - 1)) : 0;
      items.forEach((it, j) => {
        const deg = (up ? -90 : 90) + (m > 1 ? -span / 2 + span * j / (m - 1) : 0);
        const r = (j % 2 ? 190 : 128), a = deg * Math.PI / 180;
        const bx = p.x + Math.cos(a) * r, by = p.y + Math.sin(a) * r;
        const label = (it.k === 'rev' ? '₩ ' : '') + cut(it.t, 11);
        const w = textW(label, 13) + 24, col = it.k === 'rev' ? GOLD : c;
        g += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + bx + '" y2="' + by + '" stroke="' + esc(col) + '" stroke-width="1.4" opacity=".55"/>' +
             '<g><title>' + esc(it.t) + '</title>' +
             '<rect x="' + (bx - w/2) + '" y="' + (by - 15) + '" width="' + w + '" height="30" rx="15" fill="' + (it.k === 'rev' ? 'rgba(232,184,94,.16)' : '#140D26') + '" stroke="' + esc(col) + '" stroke-width="1.4"/>' +
             '<text x="' + bx + '" y="' + (by + 4.5) + '" text-anchor="middle" font-size="13" font-weight="' + (it.k === 'rev' ? 700 : 500) + '" fill="' + (it.k === 'rev' ? '#F3D89A' : '#E9E3FA') + '">' + esc(label) + '</text></g>';
      });
      // 원
      g += '<circle cx="' + p.x + '" cy="' + p.y + '" r="58" fill="' + esc(c) + '" opacity="' + (on ? .45 : .18) + '" filter="url(#jGlow)"/>' +
           '<circle cx="' + p.x + '" cy="' + p.y + '" r="46" fill="#120B22" stroke="' + esc(c) + '" stroke-width="' + (on ? 4 : 3) + '"/>' +
           '<text x="' + p.x + '" y="' + (p.y + 11) + '" text-anchor="middle" font-size="30">' + esc(s.icon || '✦') + '</text>' +
           '<circle cx="' + (p.x - 34) + '" cy="' + (p.y - 34) + '" r="14" fill="' + esc(c) + '"/>' +
           '<text x="' + (p.x - 34) + '" y="' + (p.y - 29) + '" text-anchor="middle" font-size="13" font-weight="800" fill="#120B22">' + (i + 1) + '</text>';
      // 제목 · 멤버 (가지 반대편)
      const ty = up ? p.y + 76 : p.y - 92;
      g += '<text x="' + p.x + '" y="' + ty + '" text-anchor="middle" font-size="17" font-weight="800" fill="#F4F1FC">' + esc(cut(s.title, 14)) + '</text>';
      if(s.sub) g += '<text x="' + p.x + '" y="' + (ty + 21) + '" text-anchor="middle" font-size="12.5" fill="#B7ACD1">' + esc(cut(s.sub, 20)) + '</text>';
      const mem = (s.members || []).filter(Boolean);
      if(mem.length){
        const ml = mem.slice(0, 3).join(' · ') + (mem.length > 3 ? ' +' + (mem.length - 3) : '');
        const mw = textW(ml, 12) + 22, my = ty + (s.sub ? 32 : 12);
        g += '<rect x="' + (p.x - mw/2) + '" y="' + my + '" width="' + mw + '" height="24" rx="12" fill="rgba(255,255,255,.06)" stroke="rgba(184,155,255,.25)"/>' +
             '<text x="' + p.x + '" y="' + (my + 16.5) + '" text-anchor="middle" font-size="12" fill="#C9B6FF">' + esc(ml) + '</text>';
      }
      h += '<g class="j-st" data-i="' + i + '" style="cursor:pointer; transition:opacity .2s;" opacity="' + (dim ? .32 : 1) + '">' + g + '</g>';
    });

    // 끝 표시
    h += '<text x="' + (W - 30) + '" y="' + (MID - 30) + '" text-anchor="end" font-size="12" font-weight="700" letter-spacing="2" fill="#756A94">NEXT →</text>';
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
