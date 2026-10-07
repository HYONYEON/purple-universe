/* ══════════════════════════════════════════════════════════════════
 *  Webinar.gs — 웨비나 신청 · 문자 자동 발송
 *  (요청을 받는 doPost / doGet 은 Code.gs 에 있고, 여기 함수를 불러 씁니다)
 *
 *  필요한 것 (스크립트 속성 — 프로젝트 설정 ⚙ → 스크립트 속성)
 *    SOLAPI_KEY     솔라피 API Key
 *    SOLAPI_SECRET  솔라피 API Secret
 *    SOLAPI_FROM    솔라피에 등록한 발신번호 (예: 01012345678)
 *
 *  키를 이 코드에 직접 적지 마세요. 속성에 두면 코드를 공유해도 새지 않습니다.
 *
 *  처음 한 번: 위쪽 함수 선택에서 setup 실행 → 권한 허용
 *  연결 확인 : testSms 실행 → 발신번호로 확인 문자가 오면 정상
 * ══════════════════════════════════════════════════════════════════ */

const SITE_URL = 'https://purpleuniverse.net';

const WB_TAB  = '웨비나신청';
const WB_HEAD = ['제출시간', '웨비나번호', '웨비나명', '이름', '연락처', '하는일',
                 '안내동의', '소식동의', '신청완료', '당일안내', '입장링크', '자료안내', '끝까지참여'];
// 열 번호 (1부터)
const WB_C = { at:1, no:2, title:3, name:4, phone:5, job:6, agree:7, news:8,
               confirm:9, today:10, link:11, materials:12, attend:13 };

const WL_TAB  = '웨비나링크';            // 줌 링크는 사이트에 공개하지 않고 여기에만 둡니다
const WL_HEAD = ['웨비나번호', '입장링크', '수정시간', '참석코드'];

const TR_TAB  = '클릭통계';               // 웨비나 · 클래스 팝업 열람 / 신청 버튼 클릭 수 (날짜별)
const TR_HEAD = ['날짜', '웨비나번호', '이벤트', '클릭', '고유'];
const KIT_TAB  = '툴킷열람';             // 툴킷을 연 번호 기록 (참석 코드 통과 = 끝까지 참여)
const KIT_HEAD = ['시간', '연락처', '웨비나번호', '방법'];


/* ---------- 공통 ---------- */

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function stamp() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); }
function digits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function hyphen(p) {
  const d = digits(p);
  return d.length === 11 ? d.slice(0,3) + '-' + d.slice(3,7) + '-' + d.slice(7)
       : d.length === 10 ? d.slice(0,3) + '-' + d.slice(3,6) + '-' + d.slice(6) : d;
}

/** 탭을 가져오고, 없으면 머리글과 함께 만듭니다 */
function getTab(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(head);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#EDE7FF');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < head.length) {
    const add = head.slice(sh.getLastColumn());
    sh.getRange(1, sh.getLastColumn() + 1, 1, add.length)
      .setValues([add]).setFontWeight('bold').setBackground('#EDE7FF');
  }
  return sh;
}

/** 사이트에 공개된 웨비나 목록을 읽어옵니다 (5분 저장) */
function webinars(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('webinars');
    if (hit) return JSON.parse(hit);
  }
  const res = UrlFetchApp.fetch(SITE_URL + '/webinars-data.js?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];
  const m = res.getContentText().match(/window\.WEBINARS\s*=\s*([\s\S]*?);?\s*$/);
  let list = [];
  try { list = JSON.parse(m ? m[1].trim().replace(/;$/, '') : '[]'); } catch (e) { list = []; }
  try { cache.put('webinars', JSON.stringify(list), 300); } catch (e) {}
  return list;
}
function webinarByNo(no, fresh) {
  return webinars(fresh).filter(function (w) { return String(w.no) === String(no); })[0] || null;
}

/** '2026-10-08' → '10월 8일 (목)' */
function fmtDateK(s) {
  const p = String(s || '').split('-').map(Number);
  if (p.length !== 3) return String(s || '');
  const d = new Date(p[0], p[1] - 1, p[2]);
  return p[1] + '월 ' + p[2] + '일 (' + '일월화수목금토'.charAt(d.getDay()) + ')';
}

/** '밤 9시' · '오후 2시 30분' · '21:00' → { h, m }.  못 읽으면 null */
function parseTime(s) {
  s = String(s || '').trim();
  const m = s.match(/(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] ? +m[2] : (/\d\s*시\s*반/.test(s) ? 30 : 0);
  if (/오후|저녁|밤/.test(s) && h < 12) h += 12;
  if (/오전|새벽|아침/.test(s) && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { h: h, m: mi };
}
function nowMinKST() {
  const t = Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH:mm').split(':');
  return (+t[0]) * 60 + (+t[1]);
}
function todayKST() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }

function ytUrl(v) {
  const s = String(v || '').trim();
  return /^[\w-]{11}$/.test(s) ? 'https://youtu.be/' + s : s;
}


/* ---------- 문자 문구 ----------
   알림톡으로 바꿀 때도 같은 문구를 씁니다 (웨비나_안내메시지.md 참고) */

function smsText(kind, w, name, link) {
  const when = fmtDateK(w.date) + (w.time ? ' ' + w.time : '');
  const B = '\n\n';                       // 문장 사이 한 줄 띄움
  const head = '[퍼플 유니버스]' + B + name + '님, ';
  const K = w.cat === 'class' ? '클래스' : '웨비나';   // 클래스면 문구도 '클래스'로
  if (kind === 'confirm') {
    return head + K + ' 신청이 완료되었습니다.' + B +
           '■ ' + w.title + '\n' +
           '■ ' + when + (w.place ? ' · ' + w.place : '') + B +
           '시작 전에 입장 링크를 이 번호로 보내드립니다.';
  }
  if (kind === 'today') {
    return head + '오늘 ' + (w.time || '') + '에 신청하신 ' + K + '가 열립니다.' + B +
           '■ ' + w.title + B +
           '시작 10분 전에 입장 링크를 보내드립니다.';
  }
  if (kind === 'link') {
    return head + K + '가 곧 시작됩니다.' + B +
           '■ ' + w.title + (w.time ? ' · ' + w.time : '') + B +
           '입장하기 ▶ ' + link;
  }
  if (kind === 'materials') {
    const replay = w.replayYt ? ytUrl(w.replayYt) : '';
    return head + '함께해 주셔서 감사합니다.' + B +
           '■ ' + w.title +
           ((replay || w.materialUrl) ? B : '') +
           (replay ? '녹화본 ▶ ' + replay : '') +
           (replay && w.materialUrl ? '\n' : '') +
           (w.materialUrl ? '자료 ▶ ' + w.materialUrl : '') +
           (link ? '\n참석 코드 ▶ ' + link + ' (이 번호와 함께 입력)' : '');   // 클래스만 — 툴킷 입장용
  }
  return '';
}


/* ---------- 솔라피 발송 ---------- */

function sendSms(to, text) {
  const key = prop('SOLAPI_KEY'), secret = prop('SOLAPI_SECRET'), from = digits(prop('SOLAPI_FROM'));
  if (!key || !secret || !from) throw new Error('스크립트 속성에 SOLAPI_KEY · SOLAPI_SECRET · SOLAPI_FROM 을 넣어주세요');

  const date = new Date().toISOString();
  const salt = Utilities.getUuid().replace(/-/g, '');
  const sig  = Utilities.computeHmacSha256Signature(date + salt, secret)
                 .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');

  const res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'HMAC-SHA256 apiKey=' + key + ', date=' + date + ', salt=' + salt + ', signature=' + sig },
    payload: JSON.stringify({ message: { to: digits(to), from: from, text: text } }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('솔라피 ' + code + ': ' + res.getContentText().slice(0, 240));
  return true;
}

/** 발송 실패는 메일로 알립니다 (같은 내용은 하루 한 번만) */
function alertOnce(tag, subject, body) {
  const props = PropertiesService.getScriptProperties();
  const k = 'alert_' + tag + '_' + todayKST();
  if (props.getProperty(k)) return;
  props.setProperty(k, '1');
  try { MailApp.sendEmail(NOTIFY_TO, '[퍼플 유니버스] ' + subject, body); } catch (e) {}
}


/* ---------- 줌 링크 (비공개) ---------- */

function zoomLinks() {
  const sh = getTab(WL_TAB, WL_HEAD);
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (r[0] !== '') out[String(r[0])] = String(r[1] || '');
  });
  return out;
}
function setZoomLink(no, link) {
  if (!no) return { ok: false, error: '웨비나 번호가 없습니다' };
  const sh = getTab(WL_TAB, WL_HEAD);
  const v = String(link || '').trim();
  if (sh.getLastRow() >= 2) {
    const col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < col.length; i++) {
      if (String(col[i][0]) === String(no)) {
        sh.getRange(i + 2, 2, 1, 2).setValues([[v, stamp()]]);
        return { ok: true };
      }
    }
  }
  sh.appendRow([no, v, stamp()]);
  return { ok: true };
}


/* ---------- 참석 코드 (웨비나마다 관리 페이지에서 정함) ---------- */

function attendCodes() {
  const sh = getTab(WL_TAB, WL_HEAD);
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (r[0] !== '' && String(r[3] || '').trim()) out[String(r[0])] = String(r[3]).trim();
  });
  return out;
}
function setAttendCode(no, code) {
  if (!no) return { ok: false, error: '웨비나 번호가 없습니다' };
  const sh = getTab(WL_TAB, WL_HEAD);
  const v = String(code || '').trim();
  if (sh.getLastRow() >= 2) {
    const col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < col.length; i++) {
      if (String(col[i][0]) === String(no)) {
        sh.getRange(i + 2, 3, 1, 2).setValues([[stamp(), v]]);
        return { ok: true };
      }
    }
  }
  sh.appendRow([no, '', stamp(), v]);
  return { ok: true };
}

/** 툴킷 입장 — 처음엔 번호 + 참석 코드, 한 번 통과한 번호는 번호만으로 다시 열림 */
function kitUnlock(d) {
  const phone = digits(d.phone);
  const code  = String(d.code || '').trim().toUpperCase();
  // 번호 없이 코드만으로 입장 (지인에게 링크 + 코드만 공유해도 열리게)
  if (!phone) {
    if (!code) return { ok: false, error: 'need_code' };
    const all = attendCodes();
    const hit = Object.keys(all).filter(function (k) { return String(all[k]).toUpperCase() === code; })[0];
    if (!hit) return { ok: false, error: 'code' };
    getTab(KIT_TAB, KIT_HEAD).appendRow([stamp(), '', hit, '코드만']);
    return { ok: true };
  }
  if (!/^01[016789]\d{7,8}$/.test(phone)) return { ok: false, error: 'phone' };

  const log = getTab(KIT_TAB, KIT_HEAD);

  if (!code) {
    // 번호만: 예전에 통과한 번호인지
    if (log.getLastRow() >= 2) {
      const ph = log.getRange(2, 2, log.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < ph.length; i++) if (digits(ph[i][0]) === phone) {
        log.appendRow([stamp(), hyphen(phone), '', '번호 재입장']);
        return { ok: true };
      }
    }
    return { ok: false, error: 'need_code' };
  }

  // 코드가 맞는 웨비나 찾기 (대소문자 무시)
  const codes = attendCodes();
  let no = null;
  Object.keys(codes).forEach(function (k) { if (codes[k].toUpperCase() === code) no = k; });
  if (!no) return { ok: false, error: 'code' };

  // 그 웨비나 신청자라면 '끝까지참여' 표시
  const sh = getTab(WB_TAB, WB_HEAD);
  let registered = false;
  if (sh.getLastRow() >= 2) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues();
    rows.forEach(function (r, i) {
      if (String(r[WB_C.no - 1]) === String(no) && digits(r[WB_C.phone - 1]) === phone) {
        registered = true;
        if (!r[WB_C.attend - 1]) sh.getRange(i + 2, WB_C.attend).setValue(stamp());
      }
    });
  }
  log.appendRow([stamp(), hyphen(phone), no, registered ? '참석 코드' : '참석 코드 (미신청)']);
  return { ok: true };
}


/* ---------- 신청 접수 ---------- */

function registerWebinar(d) {
  const name  = String(d.name || '').trim();
  const phone = digits(d.phone);
  if (!name) return { ok: false, error: '이름을 입력해주세요' };
  if (!/^01[016789]\d{7,8}$/.test(phone)) return { ok: false, error: '연락처를 확인해주세요' };
  if (d.agree !== '동의') return { ok: false, error: '안내 문자 수신 동의가 필요합니다' };

  const w = webinarByNo(d.no);
  if (!w) return { ok: false, error: '웨비나를 찾지 못했습니다' };

  const sh = getTab(WB_TAB, WB_HEAD);

  // 같은 웨비나에 같은 번호로 두 번 신청하면 다시 저장하지 않습니다
  if (sh.getLastRow() >= 2) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][WB_C.no - 1]) === String(w.no) && digits(rows[i][WB_C.phone - 1]) === phone) {
        return { ok: true, already: true };
      }
    }
  }

  sh.appendRow([stamp(), w.no, w.title, name, hyphen(phone), String(d.job || '').trim(),
                '동의', d.news === '동의' ? '동의' : '', '', '', '', '']);
  const row = sh.getLastRow();

  // ① 신청 완료
  try {
    sendSms(phone, smsText('confirm', w, name));
    sh.getRange(row, WB_C.confirm).setValue(stamp());
  } catch (e) {
    alertOnce('confirm', '웨비나 신청 완료 문자 실패',
      '신청은 시트에 저장됐지만 확인 문자를 보내지 못했습니다.\n\n' + name + ' / ' + hyphen(phone) + '\n오류: ' + e.message);
  }

  // 이미 입장 시간대에 신청했다면 링크도 바로 보냅니다
  if (w.date === todayKST()) {
    const t = parseTime(w.time), link = zoomLinks()[String(w.no)];
    if (t && link) {
      const now = nowMinKST(), start = t.h * 60 + t.m;
      if (now >= start - 10 && now <= start + 90) {
        try {
          sendSms(phone, smsText('link', w, name, link));
          sh.getRange(row, WB_C.link).setValue(stamp());
        } catch (e) {}
      }
    }
  }
  return { ok: true };
}


/* ---------- 5분마다 실행 (setup 이 걸어둡니다) ---------- */

function runSchedule() {
  cleanupOnce();
  const today = todayKST();
  const list = webinars().filter(function (w) { return w.date === today; });
  if (!list.length) return;                               // 오늘 웨비나가 없으면 바로 끝

  const sh = getTab(WB_TAB, WB_HEAD);
  if (sh.getLastRow() < 2) return;
  const rows  = sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues();
  const links = zoomLinks();
  const now   = nowMinKST();

  list.forEach(function (w) {
    const t = parseTime(w.time);
    if (!t) {
      alertOnce('time_' + w.no, '웨비나 시간을 읽지 못했습니다',
        '"' + w.title + '"의 시간 "' + (w.time || '') + '"을 읽지 못해 당일 안내·입장 링크를 보낼 수 없습니다.\n' +
        '웨비나 관리 페이지에서 시간을 "밤 9시" 또는 "21:00" 형태로 고쳐주세요.');
      return;
    }
    const start = t.h * 60 + t.m;
    const link  = links[String(w.no)] || '';

    if (!link && now >= start - 30 && now < start) {
      alertOnce('nolink_' + w.no, '입장 링크가 아직 없습니다',
        '"' + w.title + '"이 ' + w.time + '에 시작하는데 줌 링크가 등록되지 않았습니다.\n' +
        '웨비나 관리 페이지에서 입장 링크를 넣어주시면, 5분 안에 신청자에게 자동으로 보내집니다.');
    }

    rows.forEach(function (r, i) {
      if (String(r[WB_C.no - 1]) !== String(w.no)) return;
      const row = i + 2, name = r[WB_C.name - 1], phone = r[WB_C.phone - 1];

      // ② 당일 안내 — 오전 10시부터 시작 30분 전까지
      //    단, 시작 2시간 전 이후에 신청한 분은 생략 (밤 9시 웨비나면 저녁 7시 이후 신청) — 곧 입장 링크가 가니까
      const at = r[WB_C.at - 1] instanceof Date ? Utilities.formatDate(r[WB_C.at - 1], 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : String(r[WB_C.at - 1] || '');
      const am = at.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/);
      const lateApply = am && am[1] === today && (+am[2]) * 60 + (+am[3]) >= start - 120;
      if (!r[WB_C.today - 1] && !lateApply && now >= 600 && now < start - 30) {
        try { sendSms(phone, smsText('today', w, name)); sh.getRange(row, WB_C.today).setValue(stamp()); }
        catch (e) { alertOnce('today_' + w.no, '당일 안내 문자 실패', w.title + '\n오류: ' + e.message); }
      }
      // ③ 입장 링크 — 시작 10분 전부터 시작 90분 후까지
      if (!r[WB_C.link - 1] && link && now >= start - 10 && now <= start + 90) {
        try { sendSms(phone, smsText('link', w, name, link)); sh.getRange(row, WB_C.link).setValue(stamp()); }
        catch (e) { alertOnce('link_' + w.no, '입장 링크 문자 실패', w.title + '\n오류: ' + e.message); }
      }
    });
  });
}


/* ---------- 개인정보 정리 — 하루 한 번
   신청일로부터 4개월(120일) 지난 신청 중 '소식동의'가 없는 줄을 지웁니다
   (신청 폼에 적힌 약속과 같습니다) ---------- */

function cleanupOnce() {
  const props = PropertiesService.getScriptProperties();
  const today = todayKST();
  if (props.getProperty('cleanup_date') === today) return;
  props.setProperty('cleanup_date', today);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WB_TAB);
  if (!sh || sh.getLastRow() < 2) return;
  const limit = Date.now() - 120 * 24 * 3600 * 1000;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {              // 아래부터 지워야 줄 번호가 안 밀립니다
    const at = rows[i][WB_C.at - 1];
    const t = at instanceof Date ? at.getTime() : new Date(String(at).replace(' ', 'T') + ':00+09:00').getTime();
    if (!isNaN(t) && t < limit && rows[i][WB_C.news - 1] !== '동의') sh.deleteRow(i + 2);
  }
}


/* ---------- ④ 녹화본 · 자료 (관리 페이지 버튼으로 보냅니다) ---------- */

function sendMaterials(no) {
  const w = webinarByNo(no, true);          // 방금 올린 녹화본이 반영되도록 새로 읽음
  if (!w) return { ok: false, error: '웨비나를 찾지 못했습니다' };
  if (!w.replayYt && !w.materialUrl) {
    return { ok: false, error: '녹화본 유튜브나 자료 링크를 먼저 저장해주세요 (저장 후 1~2분 뒤에 눌러주세요)' };
  }
  const sh = getTab(WB_TAB, WB_HEAD);
  if (sh.getLastRow() < 2) return { ok: true, sent: 0, failed: 0 };
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues();
  // 클래스는 채팅창으로 코드를 못 받으니 자료 문자에 참석 코드를 함께 넣습니다
  const code = w.cat === 'class' ? (attendCodes()[String(w.no)] || '') : '';
  let sent = 0, failed = 0, lastErr = '';
  rows.forEach(function (r, i) {
    if (String(r[WB_C.no - 1]) !== String(w.no) || r[WB_C.materials - 1]) return;
    try {
      sendSms(r[WB_C.phone - 1], smsText('materials', w, r[WB_C.name - 1], code));
      sh.getRange(i + 2, WB_C.materials).setValue(stamp());
      sent++;
    } catch (e) { failed++; lastErr = e.message; }
  });
  return { ok: failed === 0, sent: sent, failed: failed, error: lastErr };
}


/* ---------- 외부 명단 등록 (예: 에이프라임 클래스 신청자) ----------
   한 줄에 한 명 — "이름 010-1234-5678" / "이름, 01012345678" / 엑셀에서 복사한 두 칸 모두 됩니다.
   신청완료 · 당일안내 · 입장링크 문자는 보내지 않고 ('외부명단'으로 표시),
   나중에 '녹화본 · 자료 문자 보내기'를 누르면 툴킷 링크가 나갑니다. */

function importApplicants(no, text) {
  const w = webinarByNo(no, true);
  if (!w) return { ok: false, error: '웨비나를 찾지 못했습니다' };
  const sh = getTab(WB_TAB, WB_HEAD);
  const have = {};
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues().forEach(function (r) {
      if (String(r[WB_C.no - 1]) === String(w.no)) have[digits(r[WB_C.phone - 1])] = 1;
    });
  }
  let added = 0, dup = 0;
  const bad = [], rows = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    const L = line.trim();
    if (!L) return;
    const m = L.match(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/);
    if (!m) { bad.push(L); return; }
    const phone = digits(m[0]);
    const name = L.replace(m[0], '').replace(/[,\t|/·]+/g, ' ').replace(/\s+/g, ' ').trim() || '(이름 없음)';
    if (have[phone]) { dup++; return; }
    have[phone] = 1;
    rows.push([stamp(), w.no, w.title, name, hyphen(phone), '외부 명단', '외부 명단', '',
               '외부명단', '외부명단', '외부명단', '', '']);
    added++;
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, WB_HEAD.length).setValues(rows);
  return { ok: true, added: added, dup: dup, bad: bad.slice(0, 10), badCount: bad.length };
}


/* ---------- 클릭 통계 ---------- */

function trackEvent(d) {
  const ev = String(d.ev || ''), no = String(d.no || '').replace(/\D/g, '');
  if (['open', 'apply'].indexOf(ev) < 0 || !no) return { ok: false };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false };
  try {
    const sh = getTab(TR_TAB, TR_HEAD), day = todayKST(), u = d.u ? 1 : 0;
    const n = sh.getLastRow() - 1;
    if (n > 0) {
      const rows = sh.getRange(2, 1, n, 5).getValues();
      for (let i = rows.length - 1; i >= 0 && i >= rows.length - 400; i--) {     // 최근 줄만 훑음
        const r = rows[i];
        const rd = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Seoul', 'yyyy-MM-dd') : String(r[0]);
        if (rd === day && String(r[1]) === no && String(r[2]) === ev) {
          sh.getRange(i + 2, 4, 1, 2).setValues([[Number(r[3] || 0) + 1, Number(r[4] || 0) + u]]);
          return { ok: true };
        }
      }
    }
    sh.appendRow([day, no, ev, 1, u]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------- 방문 통계 (30X 퍼플 노트 · 툴킷) — 날짜 · 페이지별 방문자(하루 1번) · 조회수 ---------- */
const PV_TAB = '방문통계', PV_HEAD = ['날짜', '페이지', '방문자', '조회'];
const PV_NAME = { notes: '30X 퍼플 노트', toolkit: '30X 퍼플 툴킷' };
function pageView(d) {
  const name = PV_NAME[String(d.page || '')];
  if (!name) return { ok: false };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false };
  try {
    const sh = getTab(PV_TAB, PV_HEAD), day = todayKST(), u = d.u ? 1 : 0, n = sh.getLastRow() - 1;
    if (n > 0) {
      const rows = sh.getRange(Math.max(2, sh.getLastRow() - 20), 1, Math.min(n, 21), 4).getValues(), start = Math.max(2, sh.getLastRow() - 20);
      for (let i = rows.length - 1; i >= 0; i--) {
        const rd = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], 'Asia/Seoul', 'yyyy-MM-dd') : String(rows[i][0]);
        if (rd === day && String(rows[i][1]) === name) {
          sh.getRange(start + i, 3, 1, 2).setValues([[Number(rows[i][2] || 0) + u, Number(rows[i][3] || 0) + 1]]);
          return { ok: true };
        }
      }
    }
    sh.appendRow([day, name, u, 1]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function trackStats() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TR_TAB), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
    const no = String(r[1]), ev = String(r[2]);
    out[no] = out[no] || { open: { n: 0, u: 0 }, apply: { n: 0, u: 0 } };
    if (out[no][ev]) { out[no][ev].n += Number(r[3] || 0); out[no][ev].u += Number(r[4] || 0); }
  });
  return out;
}


/* ---------- 직접 쓴 문자 보내기 (관리 페이지) ----------
   target: 'all' = 이 웨비나 신청자 전원 / 'news' = 소식 동의자만 (광고 문자용)
   {이름} 은 받는 분 이름으로 바뀝니다. test 번호가 있으면 그 번호로만 한 통. */
const CS_TAB = '문자발송기록', CS_HEAD = ['시간', '웨비나번호', '대상', '보냄', '실패', '내용'];
function sendCustom(d) {
  const w = webinarByNo(d.no, true), text = String(d.text || '').trim();
  if (!w) return { ok: false, error: '웨비나를 찾지 못했습니다' };
  if (!text) return { ok: false, error: '문자 내용을 입력해주세요' };
  if (d.test) {
    try { sendSms(d.test, text.replace(/\{이름\}/g, '테스트')); return { ok: true, sent: 1, failed: 0, test: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  const sh = getTab(WB_TAB, WB_HEAD);
  if (sh.getLastRow() < 2) return { ok: true, sent: 0, failed: 0 };
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues(), seen = {};
  let sent = 0, failed = 0, lastErr = '';
  rows.forEach(function (r) {
    if (String(r[WB_C.no - 1]) !== String(w.no)) return;
    if (d.target === 'news' && r[WB_C.news - 1] !== '동의') return;
    if (d.target === 'attend' && !r[WB_C.attend - 1]) return;          // 끝까지 참여한 분만
    const ph = digits(r[WB_C.phone - 1]);
    if (!ph || seen[ph]) return; seen[ph] = 1;
    try { sendSms(ph, text.replace(/\{이름\}/g, String(r[WB_C.name - 1] || '').trim() || '대표')); sent++; }
    catch (e) { failed++; lastErr = e.message; }
  });
  getTab(CS_TAB, CS_HEAD).appendRow([stamp(), w.no, d.target === 'news' ? '소식 동의자' : d.target === 'attend' ? '끝까지 참여' : '전체', sent, failed, text.slice(0, 200)]);
  return { ok: failed === 0, sent: sent, failed: failed, error: lastErr };
}


/* ---------- 끝까지 참여 표시 (관리 페이지) ----------
   phone 하나를 켜고/끄거나, 줌 참가자 이름 목록(text)을 붙여넣으면 이름이 같은 신청자에게 ✓ */
function setAttend(d) {
  const w = webinarByNo(d.no, true);
  if (!w) return { ok: false, error: '웨비나를 찾지 못했습니다' };
  const sh = getTab(WB_TAB, WB_HEAD);
  if (sh.getLastRow() < 2) return { ok: true, matched: 0, unmatched: [] };
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues();
  const norm = s => String(s || '').replace(/\s+/g, '').replace(/[()\[\]_\-·.]/g, '').toLowerCase();
  if (d.phone) {
    const ph = digits(d.phone);
    rows.forEach(function (r, i) {
      if (String(r[WB_C.no - 1]) === String(w.no) && digits(r[WB_C.phone - 1]) === ph)
        sh.getRange(i + 2, WB_C.attend).setValue(d.on === false ? '' : stamp());
    });
    return { ok: true };
  }
  return attendFromChat(w, sh, rows, String(d.text || ''), !!d.dry);
}

/* 줌 채팅 붙여넣기 → 끝까지 참여 표시
   - 신청자: 휴대폰 끝 4자리   예) 5678 / 홍길동 5678
   - 미신청자: 이름 + 휴대폰 전체  예) 홍길동 010-1234-5678  → 명단에 '현장참여'로 추가하고 ✓
   dry=true 면 아무것도 바꾸지 않고 결과만 미리 보여줌 */
function attendFromChat(w, sh, rows, text, dry) {
  const norm = s => String(s || '').replace(/\s+/g, '').replace(/[()\[\]_\-·.:]/g, '').toLowerCase();
  const mine = [];                                   // 이 웨비나 신청자
  rows.forEach(function (r, i) {
    if (String(r[WB_C.no - 1]) !== String(w.no)) return;
    mine.push({ row: i + 2, name: String(r[WB_C.name - 1] || '').trim(), phone: digits(r[WB_C.phone - 1]), on: !!r[WB_C.attend - 1] });
  });
  const byPhone = {}; mine.forEach(function (a) { if (a.phone) byPhone[a.phone] = a; });

  // 줌 채팅 줄 정리: '21:58:12 From 홍길동 to Everyone: 5678' / '홍길동 → 모두: 5678' / 다음 줄에 내용이 오는 형식 모두
  const msgs = []; let sender = '';
  String(text).split(/\r?\n/).forEach(function (raw) {
    let L = raw.replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|오전|오후)?/gi, ' ').trim();   // 시각 지우기
    if (!L) return;
    const m = L.match(/^(?:From\s+|보낸\s*사람\s*:?\s*)?(.+?)\s+(?:to|To|→|에서|->)\s+.+?:\s*(.*)$/) ||
              L.match(/^(.+?)\s*(?:님)?\s*(?:→|->)\s*.+?:\s*(.*)$/);
    if (m) { sender = m[1].replace(/^From\s+/i, '').trim(); L = m[2].trim(); if (!L) return; }
    msgs.push({ sender: sender, body: L, raw: raw.trim() });
  });

  const done = [], added = [], already = [], unsure = [], unknown = [], seenNew = {};
  const hit = function (a) {
    if (a.mark || done.indexOf(a) >= 0 || already.indexOf(a) >= 0) return;
    if (a.on) already.push(a); else { a.mark = 1; done.push(a); }
  };
  msgs.forEach(function (g) {
    const full = g.body.match(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/);
    if (full) {                                                          // 휴대폰 전체 → 미신청자
      const ph = digits(full[0]);
      const a = byPhone[ph];
      if (a) { hit(a); return; }                                         // 신청한 분이 전체 번호를 쓴 경우
      if (seenNew[ph]) return; seenNew[ph] = 1;
      let name = g.body.replace(full[0], '').replace(/[,\t|/·:]+/g, ' ').replace(/입니다|이에요|예요|이름/g, '').replace(/\s+/g, ' ').trim();
      if (!name || name.length > 20) name = g.sender || '(이름 없음)';
      added.push({ name: name, phone: ph });
      return;
    }
    const four = (g.body.replace(/\d{5,}/g, ' ').match(/(?:^|\D)(\d{4})(?!\d)/) || [])[1];
    if (!four) return;                                                   // 숫자 없는 채팅은 무시
    let c = mine.filter(function (a) { return a.phone.slice(-4) === four; });
    if (c.length > 1) {                                                  // 끝자리가 같은 분이 여럿 → 이름으로 한 번 더
      const hay = norm(g.body + ' ' + g.sender);
      const c2 = c.filter(function (a) { return norm(a.name).length >= 2 && hay.indexOf(norm(a.name)) >= 0; });
      if (c2.length === 1) c = c2;
    }
    if (c.length === 1) hit(c[0]);
    else if (c.length > 1) unsure.push({ line: g.raw, who: c.map(function (a) { return a.name + ' ' + hyphen(a.phone); }) });
    else unknown.push(g.raw);
  });

  if (!dry) {
    done.forEach(function (a) { sh.getRange(a.row, WB_C.attend).setValue(stamp()); });
    if (added.length) {
      sh.getRange('E:E').setNumberFormat('@');
      const rowsNew = added.map(function (p) {
        return [stamp(), w.no, w.title, p.name, hyphen(p.phone), '현장 참여', '채팅에 번호 남김', '',
                '현장참여', '현장참여', '현장참여', '', stamp()];
      });
      sh.getRange(sh.getLastRow() + 1, 1, rowsNew.length, WB_HEAD.length).setValues(rowsNew);
    }
  }
  const nm = a => a.name + ' (' + a.phone.slice(-4) + ')';
  return { ok: true, dry: dry,
           done: done.map(nm), added: added.map(function (p) { return p.name + ' ' + hyphen(p.phone); }),
           already: already.map(nm), unsure: unsure.slice(0, 20), unknown: unknown.slice(0, 30),
           matched: done.length + added.length, unmatched: unknown.concat(unsure.map(function (u) { return u.line; })).slice(0, 40) };
}


/* ---------- 관리 페이지용 조회 ---------- */

function webinarAdmin() {
  const sh = getTab(WB_TAB, WB_HEAD);
  const apps = [];
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, WB_HEAD.length).getValues().forEach(function (r) {
      apps.push({
        at: fmt(r[0]), no: String(r[1]), name: String(r[3]), phone: String(r[4]),
        job: String(r[5]), news: String(r[7]),
        sent: { confirm: fmt(r[8]), today: fmt(r[9]), link: fmt(r[10]), materials: fmt(r[11]) },
        attend: fmt(r[12])
      });
    });
  }
  let live = null;
  try { if (typeof liveAdmin === 'function') live = liveAdmin(); } catch (e) {}   // 유튜브 LIVE 알림 신청자 (Live.gs)
  return { ok: true, links: zoomLinks(), codes: attendCodes(), applicants: apps, stats: trackStats(), live: live };
}


/* ---------- 처음 한 번 / 연결 확인 ---------- */

function setup() {
  getTab(WB_TAB, WB_HEAD);
  getTab(WL_TAB, WL_HEAD);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runSchedule') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runSchedule').timeBased().everyMinutes(5).create();
  const miss = ['SOLAPI_KEY', 'SOLAPI_SECRET', 'SOLAPI_FROM'].filter(function (k) { return !prop(k); });
  Logger.log(miss.length ? '⚠ 스크립트 속성이 비어 있습니다: ' + miss.join(', ')
                         : '✓ 설정 완료 — 5분마다 자동 발송이 돌아갑니다');
}

function testSms() {
  sendSms(prop('SOLAPI_FROM'), '[퍼플 유니버스] 문자 연결이 정상입니다.');
  Logger.log('✓ 발신번호로 확인 문자를 보냈습니다');
}

/** 문자 미리보기 — 가장 최근에 등록한 웨비나로 ②당일안내 · ③입장링크 문자를
    대표님 번호(SOLAPI_FROM)로 지금 바로 보냅니다. 시트에는 아무것도 기록하지 않습니다.
    (①신청완료는 직접 신청해서 이미 확인했으니 뺐습니다. 약 45원 × 2통) */
function testWebinarSms() {
  const list = webinars(true);
  if (!list.length) { Logger.log('⚠ 사이트에 등록된 웨비나가 없습니다'); return; }
  const w = list.slice().sort(function (a, b) { return (+b.no) - (+a.no); })[0];
  const link = zoomLinks()[String(w.no)] || '(입장 링크 미등록)';
  const to = prop('SOLAPI_FROM');
  ['today', 'link'].forEach(function (k) {
    const text = smsText(k, w, '대표', link);
    sendSms(to, text);
    Logger.log('✓ 보냄 [' + k + ']\n' + text);
  });
}
