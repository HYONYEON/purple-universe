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
                 '안내동의', '소식동의', '신청완료', '당일안내', '입장링크', '자료안내'];
// 열 번호 (1부터)
const WB_C = { at:1, no:2, title:3, name:4, phone:5, job:6, agree:7, news:8,
               confirm:9, today:10, link:11, materials:12 };

const WL_TAB  = '웨비나링크';            // 줌 링크는 사이트에 공개하지 않고 여기에만 둡니다
const WL_HEAD = ['웨비나번호', '입장링크', '수정시간'];


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
           (w.materialUrl ? '자료 ▶ ' + w.materialUrl : '');
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
      if (!r[WB_C.today - 1] && now >= 600 && now < start - 30) {
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
  let sent = 0, failed = 0, lastErr = '';
  rows.forEach(function (r, i) {
    if (String(r[WB_C.no - 1]) !== String(w.no) || r[WB_C.materials - 1]) return;
    try {
      sendSms(r[WB_C.phone - 1], smsText('materials', w, r[WB_C.name - 1]));
      sh.getRange(i + 2, WB_C.materials).setValue(stamp());
      sent++;
    } catch (e) { failed++; lastErr = e.message; }
  });
  return { ok: failed === 0, sent: sent, failed: failed, error: lastErr };
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
        sent: { confirm: fmt(r[8]), today: fmt(r[9]), link: fmt(r[10]), materials: fmt(r[11]) }
      });
    });
  }
  return { ok: true, links: zoomLinks(), applicants: apps };
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
