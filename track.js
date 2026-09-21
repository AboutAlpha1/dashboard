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
  //  ★2026-08-25 규칙 통일: 종전엔 같은 판정이 세 벌(여기 + 상품노출 + 검색개수)이었다.
  //    한 곳만 고치는 사고를 막으려 인자를 받게 하고 나머지 둘이 이 함수를 부른다.
  //    u 를 주면 그 주소를, 안 주면 현재 페이지를 본다.
  //    ⚠ '?' 앞뒤를 갈라 쓴다 — 안 그러면 ?returnUrl=/product/x/12/ 같은 주소에서
  //      로그인 링크를 상품으로 착각한다.
  function productNo(u) {
    var s = u == null ? location.pathname + location.search : String(u);
    var i = s.indexOf('?');
    var path = i < 0 ? s : s.slice(0, i);
    var qs = i < 0 ? '' : s.slice(i);
    var m = qs.match(/product_no=(\d+)/);
    if (m) return m[1];
    m = path.match(/\/surl\/P\/(\d+)/i);
    if (m) return m[1];
    m = path.match(/\/product\/[^/]+\/(\d+)(?:[\/#?]|$)/);
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

  // 행동 기록 공용 전송구 — 서버 `events` 표에 kind 로 쌓인다(표를 또 만들지 않는다).
  // ★2026-08-19 HNP_ALLREC_0819: 종전엔 담기(2d) 안에만 있던 것을 밖으로 뺐다. 종류가 늘어서.
  function evt(kind, ok, detail) {
    try {
      send({ t: kind, vid: vid, sid: sid, ok: ok, detail: String(detail == null ? '' : detail).slice(0, 200),
             product: productNo(), path: location.pathname, ts: Date.now() });
    } catch (e) {}
  }

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
  // ※CART_RE(담기 버튼 판별)는 2026-08-19 전 페이지 수집으로 바뀌면서 필요 없어져 지웠다.
  //   담기 판별은 서버 `beacon.py` 의 CART_CLICK 하나로 한다(판별 규칙이 두 곳이면 또 어긋난다).
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
  //
  // ★2026-08-19 HNP_ALLREC_0819 — **전 페이지 클릭을 다 받는다**(사장님 지시: 들어온 순간부터 기록).
  //   종전엔 상품페이지 밖에서는 담기/구매 성격만 보냈다 → 목록·검색·장바구니·주문서에서
  //   손님이 뭘 눌렀는지가 통째로 비어 있었다. 대신 두 가지로 양을 억제한다:
  //     ① 같은 자리 연타(500ms 내 같은 버튼)는 1건으로 접는다
  //     ② 한 페이지 400건 상한 (정상 손님은 수십 건. 폭주는 봇이거나 버그다)
  //   `href` 를 함께 남긴다 → 목록에서 어느 상품으로 갔는지·외부로 나갔는지가 보인다.
  var lastSig = '', lastSigTs = 0, clickN = 0;
  addEventListener('click', function (e) {
    try {
      if (++clickN > 400) return;
      var dh = document.documentElement.scrollHeight || document.body.scrollHeight || 1;
      var t = e.target || {}, b = btnOf(t);
      var cls = (typeof b.className === 'string' ? b.className : '').slice(0, 120);
      var eid = ((b && b.id) || '').slice(0, 80);
      var label = txtOf(b);
      var sig = eid + '|' + label + '|' + (b.tagName || '');
      if (sig === lastSig && Date.now() - lastSigTs < 500) return;
      lastSig = sig; lastSigTs = Date.now();
      send({ t: 'click', vid: vid, sid: sid, product: productNo(), path: location.pathname,
             x: Math.round((e.clientX / (innerWidth || 1)) * 1000) / 10,        // 뷰포트폭 대비 %
             y: Math.round(((window.scrollY + e.clientY) / dh) * 1000) / 10,     // 전체 페이지높이 대비 %
             tag: (b.tagName || '').toLowerCase(), cls: cls, el_id: eid,
             href: ((b && b.getAttribute && b.getAttribute('href')) || '').slice(0, 300),
             label: label, ts: Date.now() });
    } catch (err) { /* 수집 실패가 손님 화면을 죽이면 안 된다 */ }
  }, { passive: true, capture: true });

  // 2d) 담기 성공/실패 — HNP_EVENTS_0818
  //
  // ★왜 필요한가: 담기는 **페이지가 안 바뀐다**(팝업만 뜬다). 그래서 종전엔 '장바구니 페이지를
  //   봤나'로만 셌고 카페24 정답지의 22%밖에 못 봤다. 클릭으로 보정해도 49%였고,
  //   그 클릭에는 **옵션 안 고르고 눌러 실패한 것**이 섞여 있었다.
  // ★실측으로 확정한 신호(2026-08-18, 세라펙스 상품페이지에서 직접 눌러 확인):
  //     성공 → POST /exec/front/order/basket/ (200) 발생 + 장바구니 개수 뱃지 0→1, 이동 없음
  //     실패 → alert("필수 옵션을 선택해주세요") 만 뜨고 **통신 자체가 없음**
  // ★XHR 을 가로채지 않는다 — 카페24·알파리뷰·메타픽셀과 충돌 위험. 표준 관찰자만 쓴다.
  (function () {
    // ① 성공: 담기 요청이 실제로 나갔는지 (PerformanceObserver = 남의 코드를 안 건드림)
    try {
      var seen = 0;
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          var u = e.name || '';
          // /exec/front/order/basket/ 가 진짜 담기. Basketduplicate(중복확인)는 제외된다.
          if (/\/exec\/front\/order\/basket\//i.test(u) || /\/product\/add_basket/i.test(u)) {
            if (Date.now() - seen < 1500) return;      // 한 번 담을 때 여러 요청이 이어진다
            seen = Date.now();
            evt('cart', 1, u.slice(0, 200));
          }
        });
      }).observe({ entryTypes: ['resource'] });
    } catch (e) {}
    // ② 실패·안내: 경고창 문구를 남긴다(원본 동작은 그대로 호출한다)
    try {
      ['alert', 'confirm'].forEach(function (fn) {
        var orig = window[fn];
        if (typeof orig !== 'function' || orig.__hnp) return;
        var wrapped = function (m) {
          try {
            var s = String(m == null ? '' : m);
            evt('dialog', /옵션|선택|초과|품절|재고|오류|실패/.test(s) ? 0 : null, s);
          } catch (e) {}
          return orig.apply(window, arguments);      // ★원래 동작은 절대 바꾸지 않는다
        };
        wrapped.__hnp = 1;                            // 두 번 감싸지 않게
        window[fn] = wrapped;
      });
    } catch (e) {}
  })();

  // 2e) 전방위 기록 — HNP_ALLREC_0819 (사장님 지시: 들어온 순간부터 웬만하면 다 남긴다)
  //
  // ★설계 원칙 세 가지 — 어긴 적이 있어서 적어 둔다.
  //   ① **남의 코드를 건드리지 않는다.** XHR·fetch 가로채기 금지(카페24·알파리뷰·메타픽셀과 충돌).
  //      표준 관찰자(IntersectionObserver·PerformanceObserver)와 이벤트 청취만 쓴다.
  //   ② **손님 화면을 절대 막지 않는다.** 전부 try 안, 전송은 sendBeacon(비동기).
  //      값은 페이지를 떠날 때 한 번에 모아 보낸다(노출 60개를 60번 보내지 않는다).
  //   ③ **입력값은 기록하지 않는다.** 이름·전화·주소·카드번호가 들어오는 칸이다.
  //      고른 항목(옵션·수량 같은 선택지)만 남기고, 손으로 친 글자는 사이트내 검색어만 남긴다.
  (function () {
    // ── 기기·진입 유형: 세션당 1회만 (같은 손님이 10페이지 봐도 1건)
    try {
      if (!ss('aa_env')) {
        ss('aa_env', '1');
        var nv = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
        evt('env', null, [
          (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? '모바일' : 'PC'),
          (screen.width || 0) + 'x' + (screen.height || 0),
          'win' + (innerWidth || 0),
          nv.type || '',                                   // navigate / reload / back_forward
          (navigator.language || '')
        ].join(' | '));
      }
    } catch (e) {}

    // ── 상품 노출: 목록·메인·검색에서 **실제로 눈에 들어온** 상품. 스크롤로 지나친 것도 포함.
    //    상품 상세는 pv 로 이미 알 수 있으므로 제외. 떠날 때 한 번에 보낸다.
    try {
      if (!isProductPage() && 'IntersectionObserver' in window) {
        var seenP = {}, seenN = 0;
        var io = new IntersectionObserver(function (es) {
          es.forEach(function (x) {
            if (!x.isIntersecting || seenN >= 60) return;
            var h = x.target.getAttribute('href') || '';
            var no = productNo(h);
            if (no && !seenP[no]) { seenP[no] = 1; seenN++; }
            io.unobserve(x.target);
          });
        }, { threshold: 0.5 });
        var wire = function () {
          var as = document.querySelectorAll('a[href*="product_no="], a[href*="/product/"]');
          for (var i = 0; i < as.length && i < 300; i++) { try { io.observe(as[i]); } catch (e) {} }
        };
        wire(); setTimeout(wire, 1500); setTimeout(wire, 4000);   // 목록은 늦게 그려지기도 한다
        addEventListener('pagehide', function () {
          var ks = Object.keys(seenP);
          if (ks.length) evt('view', null, ks.join(','));         // 상품번호 CSV
        });
      }
    } catch (e) {}

    // ── 옵션·수량 고르기: **고른 항목 이름만**. 손으로 친 칸(input type=text 등)은 건드리지 않는다.
    try {
      addEventListener('change', function (e) {
        try {
          var el = e.target; if (!el || !el.tagName) return;
          var tg = el.tagName.toLowerCase(), ty = (el.type || '').toLowerCase();
          var okType = (tg === 'select') || ty === 'radio' || ty === 'checkbox' ||
                       (ty === 'number' && /qty|quantity|수량/i.test((el.name || '') + (el.id || '')));
          if (!okType) return;                                    // ★입력값은 안 본다
          var val = tg === 'select'
            ? ((el.options[el.selectedIndex] || {}).text || '')    // 고른 옵션의 **표시 글자**
            : (ty === 'number' ? el.value : (el.checked ? 'on' : 'off'));
          evt('opt', null, ((el.name || el.id || tg) + ' = ' + val).slice(0, 200));
        } catch (er) {}
      }, { passive: true, capture: true });
    } catch (e) {}

    // ── 사이트 안 검색: 검색어 + 결과 개수. **0건이면 우리한테 없는 상품을 손님이 찾은 것**이다.
    try {
      var kw = (location.search.match(/[?&](keyword|q)=([^&]*)/) || [])[2];
      if (kw && /search/i.test(location.pathname)) {
        setTimeout(function () {
          var seen = {}, n = 0;
          var as = document.querySelectorAll('a[href*="product_no="], a[href*="/product/"]');
          for (var i = 0; i < as.length; i++) {
            var no = productNo(as[i].getAttribute('href') || '');
            if (no && !seen[no]) { seen[no] = 1; n++; }
          }
          evt('search', n > 0 ? 1 : 0, decodeURIComponent(kw).slice(0, 100) + ' → ' + n + '건');
        }, 2000);
      }
    } catch (e) {}

    // ── 폼 제출: 어느 폼을 냈는지만(주문·회원가입·문의). **내용은 안 본다.**
    try {
      addEventListener('submit', function (e) {
        try {
          var f = e.target || {};
          evt('form', null, ((f.id || f.name || '') + ' ' + (f.getAttribute && (f.getAttribute('action') || ''))).slice(0, 200));
        } catch (er) {}
      }, { passive: true, capture: true });
    } catch (e) {}

    // ── 페이지 오류: 손님 화면이 실제로 깨졌는지. 페이지당 3건까지(같은 오류가 초당 수백 번 나는 일이 있다).
    try {
      var errN = 0;
      addEventListener('error', function (e) {
        try {
          if (++errN > 3) return;
          var m = (e && (e.message || (e.error && e.error.message))) || '';
          var tg = e && e.target;
          var src = (e && (e.filename || (tg && (tg.src || tg.href)))) || '';
          if (!m && !src) return;
          // ★ 2026-08-26 HNP_JSERRTAG_0826: 리소스 로드 실패는 message 가 비어 있어
          //   '무엇이' 실패했는지 알 수 없었다(세라펙스 메인 30일 419건, 재현 실패).
          //   태그·id·class 를 앞에 적어 다음 발생부터 범인이 보이게 한다.
          var w = '';
          try {
            if (tg && tg.nodeType === 1 && tg.tagName) {
              w = '<' + tg.tagName.toLowerCase()
                + (tg.id ? '#' + tg.id : '')
                + (typeof tg.className === 'string' && tg.className
                    ? '.' + tg.className.trim().split(/\s+/)[0] : '')
                + '> ';
            }
          } catch (er2) {}
          evt('jserr', 0, (w + m + ' @ ' + src).slice(0, 200));
        } catch (er) {}
      }, true);
    } catch (e) {}
  })();

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
