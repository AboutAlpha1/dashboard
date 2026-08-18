/* 어바웃알파 자체 방문 추적 픽셀 (track.js)
 * - 모든 페이지: pv 비콘(세션 내 페이지 순서 → 이탈률 계산용)
 * - 후기 페이지(/board/review/): 체류시간(탭이 보이고 활동중인 시간만) 비콘
 * 수집 엔드포인트는 GitHub Pages의 beacon_endpoint.json에서 동적 조회(터널주소 바뀌어도 픽셀 불변).
 * 개인정보 미수집: 랜덤 익명 id만 사용.
 */
(function () {
  // 중복 로드 가드: 스킨 삽입 + ScriptTags API 주입이 겹쳐도 1회만 동작 (2026-07-02)
  if (window.__aa_track_loaded) return;
  window.__aa_track_loaded = true;
  // 엔드포인트 조회는 raw(즉시 반영 + CORS 허용). 스크립트 자체는 Pages에서 로드.
  var RESOLVER = 'https://raw.githubusercontent.com/AboutAlpha1/dashboard/main/beacon_endpoint.json';
  // 후기는 상품 상세페이지 안의 알파리뷰 위젯 영역(.alpha_widget). 상품페이지에서만 추적.
  // /surl/ = 카페24 단축URL(세라펙스 마케팅 유입이 대부분 /surl/P/24/ → 상품페이지 그대로 서빙).
  // 위젯이 없으면 findReview가 20초 후 알아서 포기하므로 비상품 /surl/도 무해.
  // 상품 상세 식별: ①product_no 쿼리 ②단축URL /surl/P/<no>/ ③SEO URL /product/<이름>/<no>/...
  // ⚠️ 카페24 SEO는 /product/<이름>/<상품번호>/category/<c>/display/<d>/ 형태 → 끝자리(display번호)를
  //    뽑으면 1·2·4 같은 가짜 상품번호가 잡힌다. 반드시 이름 다음 첫 숫자(상품번호)를 뽑을 것.
  function productNo() {
    var m = location.search.match(/product_no=(\d+)/);
    if (m) return m[1];
    m = location.pathname.match(/\/surl\/P\/(\d+)/i);
    if (m) return m[1];
    m = location.pathname.match(/\/product\/[^/]+\/(\d+)(?:\/|$)/);
    if (m) return m[1];
    return '';
  }
  function isProductPage() { return productNo() !== ''; }   // 상세페이지에서만 추적
  var BUF_KEY = 'aa_beacon_buf', EP_KEY = 'aa_ep', EP_TS = 'aa_ep_ts';
  var IDLE_MS = 30000;   // 30초 무활동이면 체류 일시정지

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function ls(k, v) { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } }
  function ss(k, v) { try { return v === undefined ? sessionStorage.getItem(k) : sessionStorage.setItem(k, v); } catch (e) { return null; } }

  var vid = ls('aa_vid'); if (!vid) { vid = uid(); ls('aa_vid', vid); }   // 방문자(브라우저) 식별
  var sid = ss('aa_sid'); if (!sid) { sid = uid(); ss('aa_sid', sid); }   // 세션 식별

  // 엔드포인트는 동기 변수로 보유(언로드 시 sendBeacon이 동기여야 안 샘). 백그라운드로 갱신.
  var EP = ls(EP_KEY) || '';
  (function resolve() {
    var ts = +ls(EP_TS) || 0;
    if (EP && Date.now() - ts < 3600000) return;                          // 1시간 캐시면 스킵
    fetch(RESOLVER, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.url) { EP = j.url; ls(EP_KEY, j.url); ls(EP_TS, Date.now()); flush(); } })
      .catch(function () {});
  })();
  function buffer(p) { try { var b = JSON.parse(ls(BUF_KEY) || '[]'); b.push(p); if (b.length > 50) b = b.slice(-50); ls(BUF_KEY, JSON.stringify(b)); } catch (e) {} }
  function send(p) {
    if (!p.site) p.site = location.hostname;   // 몰(도메인) 구분 태그 — 블랙알파/세라펙스 분리
    // 항상 동기 전송(pagehide 안전). EP 미확보면 버퍼 → resolve 완료/다음 페이지에서 flush.
    if (!EP) { buffer(p); return; }
    var body = JSON.stringify(p), ok = false;
    // text/plain = CORS-safelisted → 프리플라이트 없이 단순요청. 서버가 JSON 파싱.
    try { ok = navigator.sendBeacon(EP, new Blob([body], { type: 'text/plain;charset=UTF-8' })); } catch (e) {}
    if (!ok) {
      try { fetch(EP, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true, mode: 'cors' }).catch(function () { buffer(p); }); }
      catch (e) { buffer(p); }
    }
  }
  function flush() { try { var b = JSON.parse(ls(BUF_KEY) || '[]'); if (!b.length || !EP) return; ls(BUF_KEY, '[]'); b.forEach(send); } catch (e) {} }

  var enteredAt = Date.now();

  // 로그인 회원ID(있으면) — 검색어별 실결제 조인용. footer의 window.__hnp_mid='{$member_id}' 우선.
  function memberId() {
    try {
      var hv = window.__hnp_mid;
      if (hv && String(hv).indexOf('{') < 0) return String(hv).slice(0, 60);
      var mc = document.cookie.match(/login_provider_\d+=([^;]+)/);
      if (mc) { try { var mo = JSON.parse(decodeURIComponent(mc[1])); if (mo && mo.member_id) return String(mo.member_id).slice(0, 60); } catch (e2) {} }
      var C = window.CAFE24 || {}, m = C.FRONT_JS_CONFIG_MEMBER || {};
      if (m && m.member_id) return String(m.member_id).slice(0, 60);
      return '';
    } catch (e) { return ''; }
  }

  // 1) 페이지뷰 (모든 페이지)
  // ★2026-08-18 HNP_NOCUT_0818: ref 200자 한계에서 5,808건이 잘려 저장됐다(꼬리표 한가운데서 끊김).
  //   잘린 데이터는 되돌릴 수 없다 → 넉넉히. q 는 2026-08 에 이미 1000 으로 풀었다.
  send({ t: 'pv', vid: vid, sid: sid, path: location.pathname, q: location.search.slice(0, 1000), ref: (document.referrer || '').slice(0, 2000), mid: memberId(), ts: enteredAt });
  flush();

  // HNP_ORDERTAG_0721: 주문서 추가항목(oa_content, 라벨 hnp)에 vid 심기 → 간편결제 주문↔검색어 조인
  function fillOrderTag() {
    try {
      var ins = document.querySelectorAll('input[name^="oa_content"], textarea[name^="oa_content"]');
      for (var i = 0; i < ins.length; i++) {
        var e = ins[i], box = e.closest('tr, li, dl, div, p'), lbl = box ? (box.textContent || '') : '';
        if (ins.length === 1 || /hnp/i.test(lbl)) {
          e.value = vid;
          if (box) { box.style.display = 'none'; } else { e.style.display = 'none'; }
        }
      }
    } catch (e) {}
  }
  fillOrderTag();
  setTimeout(fillOrderTag, 700);
  setTimeout(fillOrderTag, 2000);

  // 2) 상품페이지: 리뷰영역 열람·체류 — 상단 별점요약(top)·하단 리뷰리스트(bottom) 각각 측정
  if (isProductPage()) {
    var tabVisible = !document.hidden, lastAct = Date.now();
    var zones = {};   // 'top'|'bottom' → {el, viewed, dwellMs, inView, lastTick}
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
      addEventListener(ev, function () { lastAct = Date.now(); }, { passive: true });
    });
    function accrue() {
      var n = Date.now(), active = tabVisible && (n - lastAct) < IDLE_MS;
      for (var k in zones) {
        var z = zones[k];
        if (z.inView && active) z.dwellMs += n - z.lastTick;
        z.lastTick = n;
      }
    }
    setInterval(accrue, 1000);

    function addZone(zone, el) {
      if (zones[zone]) return;
      var z = zones[zone] = { el: el, viewed: false, dwellMs: 0, inView: false, lastTick: Date.now() };
      if (!('IntersectionObserver' in window)) {            // 폴백: 스크롤 판정
        var ck = function () {
          var r = el.getBoundingClientRect();
          z.inView = r.top < innerHeight * 0.85 && r.bottom > 0;
          if (z.inView) z.viewed = true;
        };
        addEventListener('scroll', ck, { passive: true }); ck(); return;
      }
      new IntersectionObserver(function (es) {
        accrue();
        z.inView = es[0].isIntersecting && es[0].intersectionRatio > 0.2;
        if (z.inView) z.viewed = true;
        z.lastTick = Date.now();
      }, { threshold: [0, 0.2, 0.5] }).observe(el);
    }

    // 위젯은 비동기 로드 → 등장까지 폴링. 상단=상품정보 옆 별점요약, 하단=가장 큰 리뷰 리스트.
    function scan() {
      var top = document.querySelector('.info-review-summary');   // 상단 요약(가격/구매버튼 옆)
      if (top && top.offsetHeight > 10) addZone('top', top);
      var uses = document.getElementById('use_review');
      var cands = [].slice.call(document.querySelectorAll('#prd-review, #prdReview, .alpha_widget'))
                    .filter(function (e) { return e.offsetHeight > 150; });
      if (uses && uses.offsetHeight > 150) cands.push(uses);
      if (cands.length) {
        cands.sort(function (a, b) { return b.offsetHeight - a.offsetHeight; });
        addZone('bottom', cands[0]);                              // 가장 큰 영역 = 리뷰 리스트
      }
    }
    var tries = 0, finder = setInterval(function () {
      scan();
      if ((zones.top && zones.bottom) || ++tries > 40) clearInterval(finder);   // 최대 20초
    }, 500);

    function report() {
      accrue();
      for (var k in zones) {
        var z = zones[k];
        send({ t: 'rev', vid: vid, sid: sid, product: productNo(), zone: k,
               viewed: z.viewed ? 1 : 0, dwell_ms: Math.round(z.dwellMs), ts: Date.now() });
      }
    }
    document.addEventListener('visibilitychange', function () {
      accrue();
      if (document.hidden) { tabVisible = false; report(); }
      else { tabVisible = true; for (var k in zones) zones[k].lastTick = Date.now(); }
    });
    addEventListener('pagehide', report);
  }

  // 2b) 상품페이지: 스크롤 깊이·구간별(4구간) 체류·이탈 + 세로 20밴드별 체류(체류·이탈 히트맵)
  if (isProductPage()) {
    var NB = 20;                                   // 페이지를 20개 세로밴드(각 5%)로
    var segMs = [0, 0, 0, 0], bandMs = [], maxPct = 0, curSeg = 0;
    for (var bi = 0; bi < NB; bi++) bandMs.push(0);
    var sTick = Date.now(), sAct = Date.now(), sVis = !document.hidden;
    function pageH() { return document.documentElement.scrollHeight || document.body.scrollHeight || 1; }
    function depthPct() {
      var seen = (window.scrollY || window.pageYOffset || 0) + innerHeight;
      return Math.max(0, Math.min(100, Math.round(seen / pageH() * 100)));
    }
    function segOf(p) { return p >= 75 ? 3 : p >= 50 ? 2 : p >= 25 ? 1 : 0; }
    function sAccrue() {
      var n = Date.now(), dt = n - sTick;
      if (sVis && (n - sAct) < IDLE_MS && dt > 0) {
        segMs[curSeg] += dt;
        // 현재 뷰포트가 덮는 모든 밴드에 체류시간 가산(=화면에 보인 시간)
        var h = pageH(), top = (window.scrollY || window.pageYOffset || 0);
        var p0 = Math.max(0, Math.min(100, top / h * 100));
        var p1 = Math.max(0, Math.min(100, (top + innerHeight) / h * 100));
        var i0 = Math.floor(p0 / (100 / NB)), i1 = Math.floor((p1 - 0.0001) / (100 / NB));
        for (var i = i0; i <= i1; i++) if (i >= 0 && i < NB) bandMs[i] += dt;
      }
      sTick = n;
    }
    setInterval(sAccrue, 1000);
    function onScroll() {
      sAccrue();
      var p = depthPct(); if (p > maxPct) maxPct = p; curSeg = segOf(p);
    }
    ['scroll', 'resize'].forEach(function (ev) { addEventListener(ev, onScroll, { passive: true }); });
    ['mousemove', 'keydown', 'touchstart', 'click'].forEach(function (ev) {
      addEventListener(ev, function () { sAct = Date.now(); }, { passive: true });
    });
    onScroll();
    function sReport() {
      sAccrue();
      send({ t: 'scroll', vid: vid, sid: sid, product: productNo(), path: location.pathname,
             max_pct: maxPct, seg_ms: segMs.map(Math.round), exit_seg: curSeg,
             band_ms: bandMs.map(Math.round), nb: NB, ts: Date.now() });
    }
    document.addEventListener('visibilitychange', function () {
      sAccrue(); if (document.hidden) { sVis = false; sReport(); } else { sVis = true; sTick = Date.now(); }
    });
    addEventListener('pagehide', sReport);
  }

  // 2c) 클릭 수집 — 상품페이지는 전체(히트맵용), 그 외 페이지는 담기/구매 버튼만.
  //
  // ★2026-08-18 HNP_CLICKFIX_0818 — 세 가지를 한꺼번에 고친다(전부 실측으로 확인한 결함).
  //  ① **비상품 페이지 클릭이 통째로 안 왔다**: 종전엔 `if (isProductPage())` 안에 있어서
  //     목록·카테고리·기획전에서 담는 클릭이 전송조차 안 됐다. (장바구니 페이지에 도달한
  //     233세션 중 52세션은 '클릭 기록 자체가 없음' — 그 원인이 이것이다.)
  //     ※같은 수정이 2026-08-06 에 서버 파일에는 들어갔으나 **배포되지 않은 채 남아 있었다.**
  //  ② **버튼 이름이 안 잡혔다**: `e.target` 은 '손가락이 닿은 조각'이다. 카페24 버튼은
  //     `<a><img></a>`·`<button><span>` 구조가 많아 아이콘을 누르면 이름이 빈칸이 되고,
  //     헤더 장바구니의 개수 뱃지를 누르면 이름이 「1」로 잡혔다(실측 18세션).
  //     → **closest 로 진짜 버튼까지 올라가서** 읽고, `id` 를 함께 남긴다.
  //       (담기 버튼 실측 = `<button id="actionCart">장바구니</button>` — id 가 가장 확실한 신분증)
  //  ③ **이름이 40자에서 잘렸다**(11,869건) → 200자.
  var CART_RE = /장바구니|바로구매|구매하기|간편구매|결제하기|주문하기|cart|buy|checkout|order|basket/i;
  function btnOf(t) {
    try {
      var el = (t && t.nodeType === 3) ? t.parentElement : t;   // 글자 노드면 부모 요소부터
      if (!el || !el.closest) return el || t;
      return el.closest('a,button,input,[role=button],[onclick]') || el;
    } catch (e) { return t; }
  }
  function txtOf(b) {
    if (!b) return '';
    var s = b.innerText || b.alt || b.value || b.title ||
            (b.getAttribute && (b.getAttribute('aria-label') || b.getAttribute('name'))) || '';
    return (s + '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  addEventListener('click', function (e) {
    try {
      var dh = document.documentElement.scrollHeight || document.body.scrollHeight || 1;
      var t = e.target || {}, b = btnOf(t);
      var cls = (typeof b.className === 'string' ? b.className : '').slice(0, 120);
      var eid = ((b && b.id) || '').slice(0, 80);
      var label = txtOf(b);
      var onProduct = isProductPage();
      // 비상품 페이지는 담기/구매 성격만 보낸다(전 페이지 전체를 보내면 양이 폭증).
      if (!onProduct && !(CART_RE.test(label) || CART_RE.test(cls) || CART_RE.test(eid))) return;
      send({ t: 'click', vid: vid, sid: sid, product: productNo(), path: location.pathname,
             x: Math.round((e.clientX / (innerWidth || 1)) * 1000) / 10,        // 뷰포트폭 대비 %
             y: Math.round(((window.scrollY + e.clientY) / dh) * 1000) / 10,     // 전체 페이지높이 대비 %
             tag: (b.tagName || '').toLowerCase(), cls: cls, el_id: eid,
             label: label, ts: Date.now() });
    } catch (err) { /* 수집 실패가 손님 화면을 죽이면 안 된다 */ }
  }, { passive: true, capture: true });

  // 3) 모든 페이지: 페이지 체류시간(활동시간) — 구매자 여정 분석용
  (function () {
    var ms = 0, tick = Date.now(), act = Date.now(), vis = !document.hidden;
    function accrue() { var n = Date.now(); if (vis && (n - act) < IDLE_MS) ms += n - tick; tick = n; }
    setInterval(accrue, 1000);
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
      addEventListener(ev, function () { act = Date.now(); }, { passive: true });
    });
    function report() {
      accrue();
      send({ t: 'pg', vid: vid, sid: sid, path: location.pathname, q: location.search.slice(0, 1000),
             ent: enteredAt, active_ms: Math.round(ms), ts: Date.now() });
    }
    document.addEventListener('visibilitychange', function () {
      accrue(); if (document.hidden) { vis = false; report(); } else { vis = true; tick = Date.now(); }
    });
    addEventListener('pagehide', report);
  })();

  // 4) 모든 페이지: 로딩속도(Navigation Timing, DOMContentLoaded ms) — 로딩↔이탈 상관 분석용
  (function () {
    function rep() {
      try {
        var ms = 0, nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]);
        if (nav && nav.domContentLoadedEventEnd) ms = Math.round(nav.domContentLoadedEventEnd);
        else if (performance.timing && performance.timing.domContentLoadedEventEnd) {
          ms = performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart;
        }
        if (ms > 0 && ms < 120000) send({ t: 'perf', vid: vid, sid: sid, path: location.pathname, ms: ms, ts: Date.now() });
      } catch (e) {}
    }
    if (document.readyState === 'complete') setTimeout(rep, 0);
    else addEventListener('load', function () { setTimeout(rep, 800); });
  })();
})();
