/* 콘텐츠 브레인 (멤버 전용) — 떠오른 단어 하나 → 4H 물결 → 콘텐츠 주제 문장
   · 단어와 문장 틀은 brain-data.js (window.PU_BRAIN) 에 있습니다. 여기서는 고치지 않아요.
   · AI를 부르지 않습니다. 틀에 단어를 끼워 넣을 뿐이에요.
   · 저장: 서버(Apps Script Member.gs 의 'brainGet' / 'brainSave') → 시트 '콘텐츠브레인' 탭, 멤버마다 자기 줄만.
           멤버는 로그인 토큰, 운영자는 관리 키로 확인합니다. 내 컴퓨터 미리보기(localhost)는 이 브라우저에만 저장합니다. */
(function(){
  const root = document.getElementById('brainApp');
  const DATA = window.PU_BRAIN;
  if(!root || !DATA) return;

  const LAYERS = DATA.layers;
  const STATUS = ['씨앗', '만드는 중', '올림'];
  let S = { basket: [], seeds: [] };          // 저장되는 것
  let k = '';                                 // 지금 적은 단어 (열 때마다 비어 있음)
  let sel = LAYERS[0].id;                     // 고른 물결
  let flipped = false;                        // 순서 뒤집기
  let loaded = false;

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function today(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function layerOf(id){ return LAYERS.find(function(l){ return l.id === id; }) || LAYERS[0]; }

  /* 조사 맞추기 — {k}을 · {k}은 을 받침에 따라 을/를, 은/는 으로 */
  function ripFill(frame, kw){
    const w = kw || '○○', c = w.charCodeAt(w.length - 1), bat = c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 > 0 : true;
    return String(frame || '').replace(/\{k\}(을|은)?/g, function(m, j){ return w + (j ? (j === '을' ? (bat ? '을' : '를') : (bat ? '은' : '는')) : ''); });
  }

  /* ---------- 저장 ---------- */
  function member(){ return window.PU_MEMBER || null; }
  function okey(){ try{ return typeof ownerKey === 'function' ? ownerKey() : ''; }catch(e){ return ''; } }
  /* 서버에 보낼 '나는 누구' — 멤버는 번호 + 로그인 토큰, 운영자는 관리 키 */
  function who(){ const m = member(); if(m && m.token) return { phone:m.phone, token:m.token }; const k2 = okey(); return k2 ? { key:k2 } : null; }
  function useLocal(){ return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || !who(); }
  function ask(action, extra){ return memberPost(Object.assign({ action:action }, who(), extra || {})); }
  const WHY = { login:'로그인이 풀렸어요. 다시 로그인해 주세요.', too_big:'씨앗이 너무 많아요. 올린 씨앗을 몇 개 지워 주세요.' };
  const LOCAL_KEY = 'pu_brain_local';
  function msg(text, ok){ const el = document.getElementById('brMsg'); if(el){ el.textContent = text || ''; el.className = 'br-msg' + (ok ? ' ok' : ''); } }
  function clean(d){
    d = d && typeof d === 'object' ? d : {};
    return { basket: Array.isArray(d.basket) ? d.basket : [], seeds: Array.isArray(d.seeds) ? d.seeds : [] };
  }
  async function loadState(){
    if(useLocal()){
      try{ return clean(JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}')); }catch(e){ return clean(); }
    }
    const r = await ask('brainGet');
    if(!r || r.ok === false) throw new Error((r && r.error) || 'unknown');
    return clean(r.data);
  }
  let saveTimer = null, saving = false, dirty = false;
  function save(){ dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); }
  async function flush(){
    if(saving){ saveTimer = setTimeout(flush, 400); return; }
    saving = true; dirty = false;
    try{
      if(useLocal()){
        localStorage.setItem(LOCAL_KEY, JSON.stringify(S));
      } else {
        const r = await ask('brainSave', { data:S });
        if(!r || r.ok === false) throw new Error((r && r.error) || 'unknown');
      }
      if(!dirty) msg('');
    }catch(e){
      msg(WHY[e.message] ? '저장하지 못했어요. ' + WHY[e.message] : '저장하지 못했어요. 인터넷 연결을 확인해 주세요. 화면의 내용은 그대로 있어요. (' + e.message + ')');
    }
    saving = false;
  }

  /* ---------- 그리기 ---------- */
  function order(){ const a = LAYERS.slice(); return flipped ? a.reverse() : a; }   // 안쪽 → 바깥쪽

  function mapHTML(){
    const inner = order();                    // [가장 안쪽, …, 가장 바깥]
    let h = '';
    for(let i = inner.length - 1; i >= 0; i--){            // 바깥부터 그려야 안쪽이 위에 옴
      const l = inner[i], size = 100 + i * 44;
      h += '<button type="button" class="br-ring' + (l.id === sel ? ' on' : '') + '" data-layer="' + l.id + '" style="width:' + size + 'px; height:' + size + 'px;" aria-label="' + l.name + ' 물결"><span>' + l.name + '</span></button>';
    }
    return '<div class="br-map">' + h + '<div class="br-core">' + esc(k || '단어') + '</div></div>' +
      '<button type="button" class="br-btn br-flip" id="brFlip">⇅ 순서 뒤집기</button>';
  }

  function inBasket(layer, word){ return S.basket.some(function(b){ return b.k === k && b.layer === layer && b.word === word; }); }

  function sentsHTML(){
    const l = layerOf(sel);
    return '<div class="br-layer">' + l.name + '<small>' + esc(l.sub) + '</small></div>' +
      '<div class="br-sents">' + l.words.map(function(w, i){
        const has = k && inBasket(l.id, w.w);
        return '<div class="br-sent"><div><b>' + esc(w.w) + '</b><p>' + esc(ripFill(w.frame, k)) + '</p></div>' +
          '<button type="button" class="br-add' + (has ? ' in' : '') + '" data-add="' + i + '"' + (k && !has ? '' : ' disabled') + '>' + (has ? '담았어요' : '＋ 담기') + '</button>' +
          (w.note ? '<em>' + esc(w.note) + '</em>' : '') + '</div>';
      }).join('') + '</div>';
  }

  function fitOf(items){
    const n = new Set(items.map(function(b){ return b.layer; })).size;
    if(!n) return { n:0, text:'' };
    return { n:n, fit: n >= 4 ? '롱폼' : '숏폼', text: n >= 4 ? '네 겹을 모두 골랐어요 · 롱폼에 맞아요' : n + '겹을 골랐어요 · 숏폼에 맞아요' };
  }

  function basketHTML(){
    const f = fitOf(S.basket);
    return '<div class="br-bhead"><b>문장 바구니</b>' + (f.text ? '<span class="br-fit">' + f.text + '</span>' : '') +
      '<button type="button" class="br-btn pri" id="brKeep"' + (S.basket.length ? '' : ' disabled') + '>씨앗으로 저장</button></div>' +
      (S.basket.length
        ? S.basket.map(function(b){
            return '<div class="br-brow"><input type="text" data-edit="' + b.id + '" value="' + esc(b.text) + '" aria-label="문장 고치기"><button type="button" class="br-x" data-drop="' + b.id + '" aria-label="빼기">✕</button></div>';
          }).join('')
        : '<p class="br-empty">마음에 드는 문장 옆 ‘＋ 담기’를 누르면 여기에 모여요. 담은 뒤에 내 말투로 고쳐도 좋아요.</p>');
  }

  function seedsHTML(){
    const list = S.seeds.filter(function(s){ return !k || s.k === k; });
    const head = '<h3>내 씨앗 <small>' + (k ? '‘' + esc(k) + '’ 씨앗 ' + list.length + '개' : '모두 ' + S.seeds.length + '개') + '</small></h3>';
    if(!list.length){
      return head + '<p class="br-empty">' + (S.seeds.length
        ? '‘' + esc(k) + '’로 만든 씨앗은 아직 없어요.'
        : '아직 씨앗이 없어요. 바구니에 담은 문장을 ‘씨앗으로 저장’하면 여기에 쌓여요. 언제든 다시 와서 이어 가세요.') + '</p>';
    }
    return head + '<div class="br-seeds">' + list.map(function(s){
      const l = layerOf(s.layer), si = Math.max(0, STATUS.indexOf(s.status));
      return '<div class="br-seed s' + si + '">' +
        '<p>' + esc(s.text) + '</p>' +
        '<select data-status="' + s.id + '" aria-label="상태">' + STATUS.map(function(t){ return '<option' + (t === STATUS[si] ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
        '<div class="meta"><i>' + esc(s.k) + '</i> · ' + l.name + ' ‘' + esc(s.word) + '’ · ' + esc(s.at) + (s.fit ? ' · ' + esc(s.fit) + '에 맞아요' : '') + '</div>' +
        '<button type="button" class="del" data-del="' + s.id + '">지우기</button>' +
      '</div>';
    }).join('') + '</div>';
  }

  function pastHTML(){
    const seen = [];
    S.seeds.concat(S.basket).forEach(function(s){ if(s.k && seen.indexOf(s.k) < 0) seen.push(s.k); });
    return seen.length ? seen.map(function(w){ return '<button type="button" data-past="' + esc(w) + '">' + esc(w) + '</button>'; }).join('')
                       : '<span>아직 쓴 말이 없어요.</span>';
  }

  function part(id, html){ const el = document.getElementById(id); if(el) el.innerHTML = html; }
  function refresh(){ part('brMap', mapHTML()); part('brSents', sentsHTML()); part('brBasket', basketHTML()); part('brSeeds', seedsHTML()); }

  function shell(){
    root.innerHTML =
      '<div class="br-grid">' +
        '<div class="br-panel">' +
          '<div class="br-kw">' +
            '<input type="text" id="brK" maxlength="20" autocomplete="off" placeholder="지금 떠오르는 단어를 적어 보세요">' +
            '<button type="button" class="br-btn" id="brPastBtn">전에 쓴 말</button>' +
            '<div class="br-past" id="brPast"></div>' +
          '</div>' +
          '<div class="br-wave"><div id="brMap"></div><div id="brSents"></div></div>' +
          '<div class="br-basket" id="brBasket"></div>' +
          '<p class="br-msg" id="brMsg"></p>' +
        '</div>' +
        '<div class="br-panel" id="brSeeds"></div>' +
      '</div>';
    refresh();
  }

  /* ---------- 누르고 적는 일 ---------- */
  root.addEventListener('input', function(e){
    const t = e.target;
    if(t.id === 'brK'){
      k = t.value.trim();
      part('brMap', mapHTML()); part('brSents', sentsHTML()); part('brSeeds', seedsHTML());
    } else if(t.dataset.edit){
      const b = S.basket.find(function(x){ return x.id === t.dataset.edit; });
      if(b){ b.text = t.value; save(); }
    }
  });
  root.addEventListener('change', function(e){
    const t = e.target;
    if(t.dataset.status){
      const s = S.seeds.find(function(x){ return x.id === t.dataset.status; });
      if(s){ s.status = t.value; save(); part('brSeeds', seedsHTML()); }
    }
  });
  root.addEventListener('click', function(e){
    const t = e.target.closest('button'); const past = document.getElementById('brPast');
    if(!t){ if(past) past.classList.remove('show'); return; }
    if(t.dataset.layer){ sel = t.dataset.layer; part('brMap', mapHTML()); part('brSents', sentsHTML()); }
    else if(t.id === 'brFlip'){ flipped = !flipped; part('brMap', mapHTML()); }
    else if(t.dataset.add != null){
      const l = layerOf(sel), w = l.words[Number(t.dataset.add)];
      if(k && w && !inBasket(l.id, w.w)){
        S.basket.push({ id:uid(), text:ripFill(w.frame, k), k:k, layer:l.id, word:w.w });
        save(); part('brSents', sentsHTML()); part('brBasket', basketHTML());
      }
    }
    else if(t.dataset.drop){
      S.basket = S.basket.filter(function(b){ return b.id !== t.dataset.drop; });
      save(); part('brSents', sentsHTML()); part('brBasket', basketHTML());
    }
    else if(t.id === 'brKeep'){
      const f = fitOf(S.basket), at = today();
      const add = S.basket.filter(function(b){ return String(b.text).trim(); }).map(function(b){
        return { id:uid(), text:String(b.text).trim(), k:b.k, layer:b.layer, word:b.word, at:at, status:STATUS[0], fit:f.fit };
      });
      S.seeds = add.concat(S.seeds); S.basket = [];
      save(); refresh();
    }
    else if(t.dataset.del){
      if(confirm('이 씨앗을 지울까요?')){
        S.seeds = S.seeds.filter(function(s){ return s.id !== t.dataset.del; });
        save(); part('brSeeds', seedsHTML());
      }
    }
    else if(t.id === 'brPastBtn'){ past.innerHTML = pastHTML(); past.classList.toggle('show'); return; }
    else if(t.dataset.past){
      const inp = document.getElementById('brK'); inp.value = t.dataset.past; k = t.dataset.past;
      part('brMap', mapHTML()); part('brSents', sentsHTML()); part('brSeeds', seedsHTML());
    }
    if(past) past.classList.remove('show');
  });
  window.addEventListener('beforeunload', function(){ if(dirty && useLocal()){ try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(S)); }catch(e){} } });

  /* ---------- 시작 ---------- */
  function lockView(){
    root.innerHTML = '<div class="br-lock"><b>멤버 전용 프로그램입니다</b><p>떠오른 단어 하나로 콘텐츠 주제를 찾는 자리예요. 멤버가 되면 언제든 열려 있어요.</p><a href="/">멤버쉽 살펴보기</a></div>';
  }
  async function start(){
    if(!member()){ lockView(); return; }
    if(loaded) return;
    root.innerHTML = '<p class="br-empty">불러오는 중…</p>';
    try{
      S = await loadState(); loaded = true; shell();
    }catch(e){
      root.innerHTML = '<p class="br-msg">내 씨앗을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요. (' + esc(e.message) + ')</p>';
    }
  }
  window.addEventListener('pu-member', start);    // 이 화면에서 로그인했을 때
  start();
})();
