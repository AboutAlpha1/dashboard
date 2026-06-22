/* 어바웃알파 자체 방문 추적 픽셀 (track.js)
 * - 모든 페이지: pv 비콘(세션 내 페이지 순서 → 이탈률 계산용)
 * - 후기 페이지(/board/review/): 체류시간(탭이 보이고 활동중인 시간만) 비콘
 * 수집 엔드포인트는 GitHub Pages의 beacon_endpoint.json에서 동적 조회(터널주소 바뀌어도 픽셀 불변).
 * 개인정보 미수집: 랜덤 익명 id만 사용.
 */
(function () {
  // 엔드포인트 조회는 raw(즉시 반영 + CORS 허용). 스크립트 자체는 Pages에서 로드.
  var RESOLVER = 'https://raw.githubusercontent.com/AboutAlpha1/dashboard/main/beacon_endpoint.json';
  var REVIEW_RE = /\/board\/review\//i;     // 후기 게시판 경로
  var BUF_KEY = 'aa_beacon_buf', EP_KEY = 'aa_ep', EP_TS = 'aa_ep_ts';
  var IDLE_MS = 30000;   // 30초 무활동이면 체류 일시정지

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function ls(k, v) { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } }
  function ss(k, v) { try { return v === undefined ? sessionStorage.getItem(k) : sessionStorage.setItem(k, v); } catch (e) { return null; } }

  var vid = ls('aa_vid'); if (!vid) { vid = uid(); ls('aa_vid', vid); }   // 방문자(브라우저) 식별
  var sid = ss('aa_sid'); if (!sid) { sid = uid(); ss('aa_sid', sid); }   // 세션 식별

  function endpoint(cb) {
    var ep = ls(EP_KEY), ts = +ls(EP_TS) || 0;
    if (ep && Date.now() - ts < 3600000) { cb(ep); return; }              // 1시간 캐시
    fetch(RESOLVER, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.url) { ls(EP_KEY, j.url); ls(EP_TS, Date.now()); cb(j.url); } else cb(ep); })
      .catch(function () { cb(ep); });
  }
  function buffer(p) { try { var b = JSON.parse(ls(BUF_KEY) || '[]'); b.push(p); if (b.length > 50) b = b.slice(-50); ls(BUF_KEY, JSON.stringify(b)); } catch (e) {} }
  function post(ep, p) {
    var body = JSON.stringify(p);
    var ok = false;
    // text/plain = CORS-safelisted → 프리플라이트(OPTIONS) 없이 단순요청. 서버가 JSON 파싱.
    try { ok = navigator.sendBeacon(ep, new Blob([body], { type: 'text/plain;charset=UTF-8' })); } catch (e) {}
    if (!ok) {
      try { fetch(ep, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true, mode: 'cors' }).catch(function () { buffer(p); }); }
      catch (e) { buffer(p); }
    }
  }
  function send(p) { endpoint(function (ep) { if (!ep) { buffer(p); return; } post(ep, p); }); }
  function flush() { try { var b = JSON.parse(ls(BUF_KEY) || '[]'); if (!b.length) return; ls(BUF_KEY, '[]'); b.forEach(send); } catch (e) {} }

  var enteredAt = Date.now();

  // 1) 페이지뷰 (모든 페이지)
  send({ t: 'pv', vid: vid, sid: sid, path: location.pathname, q: location.search.slice(0, 200), ref: (document.referrer || '').slice(0, 200), ts: enteredAt });
  flush();

  // 2) 후기 페이지 체류시간 측정
  if (REVIEW_RE.test(location.pathname)) {
    var activeMs = 0, lastTick = Date.now(), lastAct = Date.now(), visible = !document.hidden;
    function accrue() { var n = Date.now(); if (visible && (n - lastAct) < IDLE_MS) activeMs += n - lastTick; lastTick = n; }
    setInterval(accrue, 1000);
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
      addEventListener(ev, function () { lastAct = Date.now(); }, { passive: true });
    });
    function report() {
      accrue();
      send({ t: 'dwell', vid: vid, sid: sid, path: location.pathname, ent: enteredAt,
             active_ms: Math.round(activeMs), total_ms: Date.now() - enteredAt, ts: Date.now() });
    }
    document.addEventListener('visibilitychange', function () {
      accrue();
      if (document.hidden) { report(); visible = false; }
      else { visible = true; lastTick = Date.now(); }
    });
    addEventListener('pagehide', report);
  }
})();
