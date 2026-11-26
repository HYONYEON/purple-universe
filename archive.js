/* 레퍼런스 아카이브 (멤버 전용) — 잘 만든 계정을 보고, 왜 잘되는지와 내 콘텐츠에 써 볼 점을 읽는 자리
   · 자료는 archive-data.js (window.PU_ARCHIVE). '홈페이지 자료/레퍼런스 아카이브/_아카이브_가져오기.py' 가 만듭니다.
   · 영상 파일은 홈페이지에 두지 않습니다. 썸네일 · 장면 캡처만 두고, 영상은 '원본 영상 보기'로 원래 글에서 봅니다.
   · 분석 글은 자료에 있는 그대로. 비어 있으면 '정리 중'이라고만 보여 줍니다. */
(function(){
  const root = document.getElementById('archiveApp');
  const DATA = window.PU_ARCHIVE;
  if(!root) return;

  const ACC = (DATA && DATA.accounts) || [];
  const GROUPS = ['업종', '형식', '편집', '활용'];
  const FIRST = 10;                           // 처음에 보여 줄 카드 수 (두 줄)
  let q = '', kind = '전체', group = '', picked = [], showAll = false;
  let cur = null, vi = 0;                     // 열어 둔 계정, 보고 있는 영상 순서

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function safeUrl(u){ return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#'; }
  function done(a){ return !!(a.one_line || a.usp || (a.points && a.points.length)); }
  function tagsOf(a, g){ return (a.tags && a.tags[g]) || []; }
  function hay(a){
    return [a.account, a.platform_name, a.one_line, a.usp].concat(a.content_usp || [],
      (a.points || []).map(function(p){ return p.point + ' ' + p.apply; }),
      GROUPS.map(function(g){ return tagsOf(a, g).join(' '); }),
      (a.videos || []).map(function(v){ return v.caption + ' ' + v.see; }),
      (a.links || []).map(function(l){ return l.title; })).join(' ').toLowerCase();
  }
  ACC.forEach(function(a){ a._hay = hay(a); });

  function filtered(){
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return ACC.filter(function(a){
      if(kind === '영상' && !(a.videos && a.videos.length)) return false;
      if(kind === '스레드 링크' && !(a.links && a.links.length)) return false;
      if(!words.every(function(w){ return a._hay.indexOf(w) >= 0; })) return false;
      return picked.every(function(p){ return tagsOf(a, p.g).indexOf(p.t) >= 0; });
    });
  }
  function tagCounts(g){
    const m = {};
    ACC.forEach(function(a){ tagsOf(a, g).forEach(function(t){ m[t] = (m[t] || 0) + 1; }); });
    return Object.keys(m).sort(function(x, y){ return m[y] - m[x] || x.localeCompare(y); }).map(function(t){ return { t:t, n:m[t] }; });
  }
  function isPicked(g, t){ return picked.some(function(p){ return p.g === g && p.t === t; }); }

  /* ---------- 목록 ---------- */
  function barHTML(){
    return '<div class="ar-bar">' +
        '<input type="text" id="arQ" placeholder="찾고 싶은 말을 적어 보세요 (예: 자영업 후킹)" autocomplete="off">' +
        ['전체', '영상', '스레드 링크'].map(function(k2){ return '<button type="button" class="ar-chip' + (kind === k2 ? ' on' : '') + '" data-kind="' + k2 + '">' + k2 + '</button>'; }).join('') +
      '</div>' +
      '<div class="ar-groups"><span>좁혀 보기</span>' +
        GROUPS.map(function(g){
          const n = picked.filter(function(p){ return p.g === g; }).length;
          return '<button type="button" class="ar-chip' + (group === g || n ? ' on' : '') + '" data-group="' + g + '">' + g + (n ? '<small>' + n + '</small>' : '') + '</button>';
        }).join('') +
      '</div>' +
      '<div class="ar-tags' + (group ? ' show' : '') + '">' +
        (group ? tagCounts(group).map(function(x){ return '<button type="button" class="ar-chip' + (isPicked(group, x.t) ? ' on' : '') + '" data-tag="' + esc(x.t) + '">' + esc(x.t) + '<small>' + x.n + '</small></button>'; }).join('') : '') +
      '</div>';
  }
  function cardHTML(a){
    const v = (a.videos || [])[0], use = tagsOf(a, '활용').slice(0, 2);
    return '<button type="button" class="ar-card" data-open="' + esc(a.key) + '">' +
      '<div class="ar-thumb">' +
        (v && v.thumb ? '<img src="' + esc(v.thumb) + '" alt="" loading="lazy">' : '<div class="none">' + (a.links && a.links.length ? '글 링크' : '그림 준비 중') + '</div>') +
        '<span class="ar-plat">' + esc(a.platform_name) + '</span>' +
      '</div>' +
      '<div class="ar-body"><b>@' + esc(a.account) + '</b>' +
        (a.one_line ? '<p>' + esc(a.one_line) + '</p>' : '<p class="wait">정리 중</p>') +
        (use.length ? '<div class="ar-mini">' + use.map(function(t){ return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      '</div></button>';
  }
  function listHTML(){
    const list = filtered(), on = q || kind !== '전체' || picked.length;
    if(!ACC.length) return '<p class="ar-empty">자료를 준비하고 있어요. 곧 이 자리에 채워져요.</p>';
    if(!list.length) return '<p class="ar-count">맞는 계정이 없어요.<button type="button" data-reset="1">조건 지우기</button></p>';
    const show = showAll || on ? list : list.slice(0, FIRST);
    return '<p class="ar-count">' + (on ? '맞는 계정 ' + list.length + '곳' : '모두 ' + ACC.length + '곳') + (on ? '<button type="button" data-reset="1">조건 지우기</button>' : '') + '</p>' +
      '<div class="ar-grid">' + show.map(cardHTML).join('') + '</div>' +
      (show.length < list.length ? '<button type="button" class="ar-more" data-more="1">' + (list.length - show.length) + '곳 더 보기</button>' : '');
  }
  function drawList(){ document.getElementById('arList').innerHTML = listHTML(); }
  function drawBar(keepFocus){
    const el = document.getElementById('arBar'); el.innerHTML = barHTML();
    const inp = document.getElementById('arQ'); inp.value = q;
    if(keepFocus){ inp.focus(); inp.setSelectionRange(q.length, q.length); }
  }

  /* ---------- 계정 화면 ---------- */
  function viewHTML(a){
    const vs = a.videos || [], v = vs[vi];
    if(!v) return '';
    return '<a class="ar-shot" href="' + esc(safeUrl(v.url)) + '" target="_blank" rel="noopener noreferrer">' +
        (v.thumb ? '<img src="' + esc(v.thumb) + '" alt="">' : '') + '<span class="go">▶ 원본 영상 보기 ↗</span></a>' +
      (vs.length > 1 ? '<div class="ar-nav"><button type="button" data-step="-1" aria-label="이전 영상">‹</button>' + (vi + 1) + ' / ' + vs.length + '<button type="button" data-step="1" aria-label="다음 영상">›</button></div>' : '') +
      (v.see ? '<div class="ar-see"><b>이 영상에서 볼 것</b>' + esc(v.see) + '</div>' : '') +
      '<p class="ar-src">출처 · <a href="' + esc(safeUrl(a.profile)) + '" target="_blank" rel="noopener noreferrer">@' + esc(a.account) + '</a> · ' + esc(a.platform_name) + (v.date ? ' · ' + esc(v.date) : '') + '</p>' +
      (v.caption ? '<p class="ar-cap" id="arCap">' + esc(v.caption) + '</p>' + (v.caption.length > 120 ? '<button type="button" class="ar-capbtn" data-cap="1">원본 글 더 보기</button>' : '') : '');
  }
  function pointHTML(p){
    const mark = p.img && p.x != null && p.y != null ? '<i style="left:' + (p.x * 100) + '%; top:' + (p.y * 100) + '%;"></i>' : '';
    return '<div class="ar-pt' + (p.img ? ' has' : '') + '">' +
      (p.img ? '<div class="cap"><img src="' + esc(p.img) + '" alt="" loading="lazy">' + mark + (p.t != null ? '<small>' + Math.round(p.t) + '초쯤</small>' : '') + '</div>' : '') +
      '<div><b>' + esc(p.point) + '</b>' + (p.apply ? '<span><em>이렇게 써 보기</em>' + esc(p.apply) + '</span>' : '') + '</div></div>';
  }
  function textHTML(a){
    let h = '<h3>@' + esc(a.account) + '</h3><p class="who">' + esc(a.platform_name) + (a.updated ? ' · ' + esc(a.updated) + ' 정리' : '') + '</p>';
    if(!done(a)){
      h += '<div class="ar-wait">정리 중이에요. 영상은 먼저 보실 수 있어요.</div>';
    } else {
      if(a.one_line) h += '<p class="one">' + esc(a.one_line) + '</p>';
      if(a.usp) h += '<h4>이 계정이 다른 점</h4><p>' + esc(a.usp) + '</p>';
      if(a.content_usp && a.content_usp.length) h += '<h4>콘텐츠 특징</h4><ul>' + a.content_usp.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if(a.points && a.points.length) h += '<h4>벤치마킹 포인트</h4>' + a.points.map(pointHTML).join('');
    }
    if(a.links && a.links.length){
      h += '<h4>글 링크</h4><div class="ar-links">' + a.links.map(function(l){
        return '<a href="' + esc(safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(l.title || l.url) + (l.date ? '<small>' + esc(l.date) + '</small>' : '') + '</a>';
      }).join('') + '</div>';
    }
    return h;
  }
  function openAcc(key){
    cur = ACC.find(function(a){ return a.key === key; }); if(!cur) return;
    vi = 0;
    const has = cur.videos && cur.videos.length;
    document.getElementById('arSheet').innerHTML = '<button type="button" class="ar-close" data-close="1" aria-label="닫기">✕</button>' +
      '<div class="ar-detail"' + (has ? '' : ' style="grid-template-columns:1fr;"') + '>' + (has ? '<div class="ar-view" id="arView">' + viewHTML(cur) + '</div>' : '') +
      '<div class="ar-text">' + textHTML(cur) + '</div></div>';
    const m = document.getElementById('arModal'); m.classList.add('show'); m.scrollTop = 0;
    document.getElementById('arSheet').scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }
  function closeAcc(){ document.getElementById('arModal').classList.remove('show'); document.body.style.overflow = ''; cur = null; }

  /* ---------- 누르고 적는 일 ---------- */
  root.addEventListener('input', function(e){
    if(e.target.id === 'arQ'){ q = e.target.value.trim(); drawList(); }
  });
  root.addEventListener('click', function(e){
    const t = e.target.closest('button');
    if(e.target.id === 'arModal'){ closeAcc(); return; }
    if(!t) return;
    if(t.dataset.kind){ kind = t.dataset.kind; drawBar(); drawList(); }
    else if(t.dataset.group){ group = group === t.dataset.group ? '' : t.dataset.group; drawBar(); }
    else if(t.dataset.tag){
      const g = group, tag = t.dataset.tag;
      if(isPicked(g, tag)) picked = picked.filter(function(p){ return !(p.g === g && p.t === tag); });
      else picked.push({ g:g, t:tag });
      drawBar(); drawList();
    }
    else if(t.dataset.reset){ q = ''; kind = '전체'; picked = []; group = ''; drawBar(); drawList(); }
    else if(t.dataset.more){ showAll = true; drawList(); }
    else if(t.dataset.open){ openAcc(t.dataset.open); }
    else if(t.dataset.close){ closeAcc(); }
    else if(t.dataset.step && cur){
      const n = cur.videos.length; vi = (vi + Number(t.dataset.step) + n) % n;
      document.getElementById('arView').innerHTML = viewHTML(cur);
    }
    else if(t.dataset.cap){ document.getElementById('arCap').classList.add('open'); t.remove(); }
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && cur) closeAcc(); });

  /* ---------- 시작 ---------- */
  function lockView(){
    root.innerHTML = '<div class="br-lock"><b>멤버 전용 자료입니다</b><p>잘 만든 계정을 함께 뜯어보는 자리예요. 멤버가 되면 언제든 열려 있어요.</p><a href="/">멤버쉽 살펴보기</a></div>';
  }
  function start(){
    if(!window.PU_MEMBER){ lockView(); return; }
    root.innerHTML = '<div id="arBar"></div><div id="arList"></div>' +
      '<div class="ar-modal" id="arModal"><div class="ar-sheet" id="arSheet"></div></div>';
    drawBar(); drawList();
  }
  window.addEventListener('pu-member', start);
  start();
})();
