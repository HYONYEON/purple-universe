/* 퍼플 유니버스 — 유튜브 최신 영상 가져오기
 *
 * 채널의 업로드 목록을 최신순으로 읽어 롱폼 4개 / 쇼츠 8개를 골라
 * youtube-data.js 로 저장합니다. GitHub Actions 가 하루 한 번 실행합니다.
 *
 * 필요한 것: 환경변수 YT_API_KEY (GitHub 저장소 Secrets 에 넣어둠)
 * 직접 돌려보려면:  YT_API_KEY=키 node fetch-youtube.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const KEY        = process.env.YT_API_KEY;
const CHANNEL_ID = 'UCngFF4hLlA48aHkn1XqF71A';   // @purple-universe-kk
const OUT        = 'youtube-data.js';

const WANT_LONG   = 4;
const WANT_SHORTS = 8;
const SCAN_MAX    = 100;   // 최신 몇 개까지 훑어볼지 (4+8을 채우기 위한 여유분)
const SHORT_SEC   = 180;   // 3분 이하면 쇼츠 후보

if(!KEY){
  console.error('YT_API_KEY 가 없습니다. GitHub Secrets 에 등록했는지 확인하세요.');
  process.exit(1);
}

const api = async (path, params) => {
  const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
  Object.entries({ ...params, key: KEY }).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url);
  const body = await r.text();
  if(!r.ok) throw new Error(path + ' 실패 (' + r.status + '): ' + body.slice(0, 300));
  return JSON.parse(body);
};

/* ISO8601 길이(PT1M30S) → 초 */
const toSeconds = iso => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if(!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
};

/* 쇼츠인지 확정 — youtube.com/shorts/<id> 가 그대로 열리면 쇼츠,
   /watch 로 되돌려 보내면 일반 영상. 길이만으로는 짧은 롱폼과 구별이 안 돼서 한 번 더 확인한다. */
const isShort = async id => {
  try{
    const r = await fetch('https://www.youtube.com/shorts/' + id, {
      method: 'HEAD', redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; purple-universe-site)' },
    });
    if(r.status >= 300 && r.status < 400){
      return !/\/watch/.test(r.headers.get('location') || '');
    }
    return r.status === 200;
  }catch(e){
    return true;      // 확인 실패 시엔 길이 판단(3분 이하)을 믿는다
  }
};

const main = async () => {
  // 1) 업로드 재생목록 찾기
  const ch = await api('channels', { part: 'contentDetails,snippet', id: CHANNEL_ID });
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if(!uploads) throw new Error('업로드 목록을 찾지 못했습니다. 채널 ID를 확인하세요.');

  // 2) 최신순으로 영상 id 모으기
  const ids = [];
  let pageToken = '';
  while(ids.length < SCAN_MAX){
    const page = await api('playlistItems', {
      part: 'contentDetails', playlistId: uploads, maxResults: 50,
      ...(pageToken ? { pageToken } : {}),
    });
    (page.items || []).forEach(it => {
      const id = it.contentDetails?.videoId;
      if(id) ids.push(id);
    });
    pageToken = page.nextPageToken || '';
    if(!pageToken) break;
  }
  if(!ids.length) throw new Error('영상을 하나도 찾지 못했습니다.');

  // 3) 길이·제목 가져오기 (50개씩)
  const vids = [];
  for(let i = 0; i < ids.length; i += 50){
    const res = await api('videos', {
      part: 'snippet,contentDetails,status', id: ids.slice(i, i + 50).join(','),
    });
    (res.items || []).forEach(v => {
      if(v.status?.privacyStatus && v.status.privacyStatus !== 'public') return;   // 비공개·일부공개 제외
      vids.push({
        id: v.id,
        title: v.snippet?.title || '',
        date: (v.snippet?.publishedAt || '').slice(0, 10),
        sec: toSeconds(v.contentDetails?.duration),
      });
    });
  }
  // playlistItems 순서(최신순)를 유지
  vids.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  // 4) 롱폼 / 쇼츠 나누기
  const longs = [], shorts = [];
  for(const v of vids){
    if(longs.length >= WANT_LONG && shorts.length >= WANT_SHORTS) break;
    if(v.sec > SHORT_SEC){
      if(longs.length < WANT_LONG) longs.push(v);
      continue;
    }
    if(shorts.length >= WANT_SHORTS) continue;
    if(await isShort(v.id)) shorts.push(v);
    else if(longs.length < WANT_LONG) longs.push(v);
  }

  if(!longs.length && !shorts.length) throw new Error('고를 영상이 없습니다.');

  const pick = v => ({ id: v.id, title: v.title, date: v.date });
  const data = {
    updated: new Date().toISOString(),
    long: longs.map(pick),
    shorts: shorts.map(pick),
  };

  const text =
    '/* 유튜브 최신 영상 — GitHub Actions 가 하루 한 번 자동으로 갱신합니다.\n' +
    '   직접 고치지 마세요. 다음 실행 때 덮어써집니다. */\n' +
    'window.YT_LATEST = ' + JSON.stringify(data, null, 2) + ';\n';

  // 내용이 같으면 커밋이 생기지 않게 그대로 둔다 (updated 시각은 비교에서 제외)
  const strip = s => s.replace(/"updated":\s*"[^"]*",?\s*/g, '');
  if(existsSync(OUT) && strip(readFileSync(OUT, 'utf8')) === strip(text)){
    console.log('변화 없음 — 롱폼 ' + longs.length + '개, 쇼츠 ' + shorts.length + '개');
    process.exit(0);
  }

  writeFileSync(OUT, text);
  console.log('갱신 완료 — 롱폼 ' + longs.length + '개, 쇼츠 ' + shorts.length + '개');
  longs.forEach(v => console.log('  [롱폼] ' + v.date + '  ' + v.title));
  shorts.forEach(v => console.log('  [쇼츠] ' + v.date + '  ' + v.title));
};

main().catch(e => { console.error(e.message); process.exit(1); });
