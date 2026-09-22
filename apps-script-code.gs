/**
 * 퍼플 유니버스 — 신청 접수 스크립트
 *
 * 하는 일
 *   1) purpleuniverse.net/apply 에서 보낸 신청을 구글 시트에 한 줄씩 쌓습니다
 *   2) 신청이 들어오는 즉시 지정한 메일로 알려줍니다
 *
 * 붙여넣는 곳 : script.google.com → 새 프로젝트 → 이 코드로 전부 교체
 * 자세한 순서 : 신청폼_설정가이드.md 참고
 */

// ───────── 설정 (이 두 줄만 고치면 됩니다) ─────────

/** 알림 메일을 받을 주소. 쉼표로 여러 개 가능 */
const NOTIFY_TO = 'successlife1532@gmail.com';

/** 현재 모집 기수 (시트에 함께 기록됩니다) */
const COHORT = '5기';

/**
 * 관리자 페이지에서 신청 목록을 읽어올 때 쓰는 열쇠.
 *
 * 이 주소는 apply.html 에 들어있어 누구나 알 수 있습니다.
 * 그래서 목록 조회에는 이 열쇠를 요구합니다. 열쇠가 없으면 아무것도 안 알려줍니다.
 *
 * 이 값은 관리자 페이지에 '한 번만' 입력해두면 브라우저에 저장됩니다.
 * 저장소(GitHub)에 올라가는 파일에는 절대 적지 마세요.
 * 새어나갔다고 판단되면 아래 값을 새로 바꾸고 다시 배포하면 즉시 무효가 됩니다.
 */
const READ_KEY = 'IWhO2g8d7qz9cJOFmjNOtX0mWa1f';

// ───────── 여기부터는 고치지 않아도 됩니다 ─────────

/** 시트 첫 줄에 들어갈 항목 이름. apply.html 의 name 속성과 순서가 같습니다.
    뒤의 '상태'·'메모'는 신청자가 쓰는 칸이 아니라 심사 페이지에서 기록하는 칸입니다. */
const HEADERS = [
  '제출시간', '기수', '성함', '나이', '연락처', '직업', '주로 업무를 하는 곳',
  '내 사업의 강점(USP)', '웹사이트·SNS 링크', '교육 경험', '레벨',
  '현재의 고민', '인생의 최종 목표', '동의', '유입경로',
  '상태', '메모'
];

/** 열 번호 (1부터). 순서를 바꾸면 이 값도 같이 고쳐야 합니다 */
const COL_AT     = 1;
const COL_STATUS = 16;
const COL_MEMO   = 17;

/** 폼에서 보내는 이름 → 시트 열 순서 */
const FIELDS = [
  'name', 'age', 'phone', 'job', 'area',
  'usp', 'links', 'edu', 'level',
  'concern', 'goal', 'agree', 'referrer'
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return reply({ ok: false, error: '빈 요청' });
    }

    const data = JSON.parse(e.postData.contents);

    /* 심사 상태 기록 — 심사 페이지에서만 옵니다. 열쇠가 필요합니다.
       (신청 접수는 누구나 할 수 있어야 하므로 열쇠를 요구하지 않습니다) */
    if (data.action === 'status') {
      if (data.key !== READ_KEY) {
        return reply({ ok: false, error: 'unauthorized' });
      }
      return reply(setStatus(data.at, data.status, data.memo));
    }

    // 최소 검증 — 성함과 연락처가 없으면 받지 않습니다
    if (!String(data.name || '').trim() || !String(data.phone || '').trim()) {
      return reply({ ok: false, error: '성함과 연락처는 필수입니다' });
    }

    const sheet = getSheet();
    const now = new Date();

    const row = [Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'), COHORT];
    FIELDS.forEach(function (key) {
      row.push(String(data[key] == null ? '' : data[key]));
    });
    sheet.appendRow(row);

    const total = sheet.getLastRow() - 1;   // 머리글 제외
    notify(data, total, now);

    return reply({ ok: true, total: total });

  } catch (err) {
    // 실패해도 신청 내용은 잃지 않도록 메일로 남겨둡니다
    try {
      MailApp.sendEmail(
        NOTIFY_TO,
        '[퍼플 유니버스] 신청 저장 실패 — 내용 보관',
        '시트 저장에 실패했습니다. 아래 원본을 확인해주세요.\n\n' +
        '오류: ' + err.message + '\n\n' +
        '원본:\n' + (e && e.postData ? e.postData.contents : '(없음)')
      );
    } catch (ignore) {}
    return reply({ ok: false, error: err.message });
  }
}

/**
 * 두 가지 역할을 합니다.
 *   · 주소를 그냥 열면 → 배포가 살아있는지 확인용 메시지
 *   · ?action=list&key=열쇠 → 신청 목록 (관리자 페이지가 씁니다)
 */
function doGet(e) {
  const p = (e && e.parameter) || {};

  if (p.action === 'list') {
    if (p.key !== READ_KEY) {
      return reply({ ok: false, error: 'unauthorized' });
    }
    return reply(listApplications(Number(p.limit) || 30, p.full === '1'));
  }

  return reply({ ok: true, message: '퍼플 유니버스 신청 접수 대기 중' });
}

/** 신청을 최신순으로 돌려줍니다. 테스트 줄([테스트]로 시작)은 셈에서 뺍니다.
 *  full=true 면 답변 전문까지 (심사 페이지용), false 면 요약만 (관리자 사이드바용) */
function listApplications(limit, full) {
  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, total: 0, approved: 0, items: [] };

  const rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const items = [];
  let total = 0, approved = 0;

  rows.forEach(function (r) {
    const name = String(r[2] || '').trim();
    const isTest = name.indexOf('[테스트]') === 0;
    const status = String(r[15] || '').trim() || '심사중';
    if (!isTest) {
      total++;
      if (status === '승인') approved++;
    }

    const it = {
      at:     fmt(r[0]),
      cohort: String(r[1] || ''),
      name:   name,
      age:    String(r[3] || ''),
      phone:  String(r[4] || ''),
      job:    String(r[5] || ''),
      area:   String(r[6] || ''),
      level:  String(r[10] || ''),
      status: status,
      test:   isTest
    };

    if (full) {
      it.usp     = String(r[7]  || '');
      it.links   = String(r[8]  || '');
      it.edu     = String(r[9]  || '');
      it.concern = String(r[11] || '');
      it.goal    = String(r[12] || '');
      it.agree   = String(r[13] || '');
      it.referrer= String(r[14] || '');
      it.memo    = String(r[16] || '');
    } else {
      it.concern = cut(r[11], 90);
    }

    items.push(it);
  });

  items.reverse();                                  // 최신이 위로
  return { ok: true, total: total, approved: approved, items: items.slice(0, limit) };
}

/** 심사 상태·메모를 기록합니다. 제출시간으로 해당 줄을 찾습니다 */
function setStatus(at, status, memo) {
  const ALLOWED = ['심사중', '승인', '보류', '제외'];
  if (ALLOWED.indexOf(status) < 0) {
    return { ok: false, error: '허용되지 않은 상태: ' + status };
  }

  const sheet = getSheet();
  const last = sheet.getLastRow();
  if (last < 2) return { ok: false, error: '신청이 없습니다' };

  const col = sheet.getRange(2, COL_AT, last - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    if (fmt(col[i][0]) === String(at)) {
      const row = i + 2;
      sheet.getRange(row, COL_STATUS).setValue(status);
      if (memo != null) sheet.getRange(row, COL_MEMO).setValue(String(memo));
      return { ok: true, at: at, status: status };
    }
  }
  return { ok: false, error: '해당 신청을 찾지 못했습니다' };
}

/** 시트의 시간 값이 문자열이든 날짜든 같은 모양으로 맞춤 */
function fmt(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  return String(v || '');
}

function cut(v, n) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 시트를 가져오고, 머리글이 없거나 모자라면 채워 둡니다 */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('신청');
  if (!sheet) {
    sheet = ss.insertSheet('신청');
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#EDE7FF');
    sheet.setFrozenRows(1);
    return sheet;
  }

  // 이미 쓰던 시트에 '상태'·'메모' 열이 없으면 뒤에 덧붙입니다 (기존 데이터는 그대로)
  const cols = sheet.getLastColumn();
  if (cols < HEADERS.length) {
    const add = HEADERS.slice(cols);
    sheet.getRange(1, cols + 1, 1, add.length)
      .setValues([add])
      .setFontWeight('bold')
      .setBackground('#EDE7FF');
  }
  return sheet;
}

/** 신청이 들어왔다고 메일로 알립니다 */
function notify(data, total, now) {
  const name = String(data.name || '').trim();
  const subject = '[퍼플 유니버스] ' + COHORT + ' 신청 — ' + name + ' (누적 ' + total + '명)';

  const lines = [
    '새 신청이 들어왔습니다.',
    '',
    '성함      ' + val(data.name),
    '나이      ' + val(data.age),
    '연락처    ' + val(data.phone),
    '직업      ' + val(data.job),
    '활동 지역 ' + val(data.area),
    '레벨      ' + val(data.level),
    '교육 경험 ' + val(data.edu),
    '',
    '── 사업의 강점(USP) ──',
    val(data.usp),
    '',
    '── 웹사이트·SNS ──',
    val(data.links),
    '',
    '── 현재의 고민 ──',
    val(data.concern),
    '',
    '── 인생의 최종 목표 ──',
    val(data.goal),
    '',
    '─────────────',
    '유입 경로 ' + val(data.referrer),
    '제출 시간 ' + Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
    '누적      ' + total + '명 / 정원 10명',
    '',
    '시트에서 전체 보기: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  ];

  MailApp.sendEmail(NOTIFY_TO, subject, lines.join('\n'));
}

function val(v) {
  const s = String(v == null ? '' : v).trim();
  return s || '(미입력)';
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
