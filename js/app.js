/* 라우터와 시작 */
(function (w) {
  'use strict';

  /* 상단 탭 — 확정된 여섯 개, 이 순서 그대로.
     (일정·도구 화면은 #/calendar · #/tools 로 열린다. 상단 탭에는 넣지 않는다.) */
  var NAV = [
    { href: '#/', label: '홈', key: 'home' },
    { href: '#/market', label: '증시', key: 'market' },
    { href: '#/gauge', label: '매수 지표', key: 'gauge' },
    { href: '#/rebalance', label: '리밸런싱', key: 'rebalance' },
    { href: '#/journal', label: '기록', key: 'journal' },
    { href: '#/readings', label: '글', key: 'readings' }
  ];

  function buildNav() {
    var nav = document.getElementById('nav');
    nav.innerHTML = NAV.map(function (n) {
      return '<a href="' + n.href + '" data-key="' + n.key + '">' + n.label + '</a>';
    }).join('');
  }

  function activeKey(path) {
    if (path === '' || path === '/') return 'home';
    if (path.indexOf('/score') === 0) return 'home';
    if (path.indexOf('/market') === 0) return 'market';
    if (path.indexOf('/gauge') === 0) return 'gauge';
    if (path.indexOf('/crash') === 0) return 'gauge';      /* 옛 경로 — 매수 지표 안 폭락 섹션 */
    if (path.indexOf('/calendar') === 0) return 'calendar';
    if (path.indexOf('/tools') === 0) return 'tools';
    if (path.indexOf('/rebalance') === 0) return 'rebalance';
    if (path.indexOf('/journal') === 0) return 'journal';
    if (path.indexOf('/verify') === 0) return 'journal';   /* 옛 경로 — 기록 안 검증 섹션 */
    if (path.indexOf('/read') === 0) return 'readings';
    return '';
  }

  function parse() {
    var raw = location.hash.replace(/^#/, '');
    var parts = raw.split('/').filter(function (x) { return x !== ''; });
    return { parts: parts, path: '/' + parts.join('/') };
  }

  var lastPath = null;

  function render(scroll) {
    var parsed = parse();
    var parts = parsed.parts;
    var host = document.getElementById('view');

    /* 이전 화면에 붙은 이벤트를 확실히 떼기 위해 노드를 새로 만든다 */
    var fresh = host.cloneNode(false);
    host.parentNode.replaceChild(fresh, host);
    host = fresh;

    var key = activeKey(parsed.path);
    els('#nav a', document).forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('data-key') === key);
    });

    /* 옛 주소 → 새 자리. 기록을 남기지 않는다(뒤로 가기가 막다른 곳으로 가지 않게) */
    if (parts[0] === 'crash') {
      location.replace('#/gauge/crash' + (parts[1] ? '/' + parts[1] : ''));
      return;
    }
    if (parts[0] === 'verify') {
      location.replace('#/journal/verify');
      return;
    }

    try {
      if (parts.length === 0) Views.home(host);
      else if (parts[0] === 'score') Views.score(host, parts[1]);
      else if (parts[0] === 'market') {
        if (typeof Views.market === 'function') Views.market(host, parts.slice(1));
        else host.innerHTML = '<section class="hero"><div class="crumb"><a href="#/">홈</a> / 증시</div>' +
          '<h1>증시</h1><p>지수·관심 종목·마켓맵·순위 화면을 옮겨 오는 중입니다. 자료가 준비되면 이 자리에 열립니다.</p></section>';
      }
      else if (parts[0] === 'calendar' && typeof Views.calendar === 'function') Views.calendar(host);
      else if (parts[0] === 'tools' && typeof Views.tools === 'function') Views.tools(host, parts);
      else if (parts[0] === 'gauge') {
        var detailId = parts[1] === 'crash' ? parts[2] : null;
        var path = parsed.path;
        Data.loadGauge().then(function () {
          if (parse().path !== path) return;
          Views.gauge(fresh, detailId || null);
        }).catch(function (e) {
          fresh.innerHTML = '<div class="empty" style="padding:50px 10px">매수 지표 자료를 불러오지 못했습니다.<br>' +
            '<span class="small">' + esc(String(e && e.message || e)) + '</span></div>';
          if (w.console) console.error(e);
        });
      }
      else if (parts[0] === 'rebalance') Views.rebalance(host);
      else if (parts[0] === 'journal') Views.journal(host, parts[1]);
      else if (parts[0] === 'readings') Views.readings(host);
      else if (parts[0] === 'read') Views.article(host, parts[1]);
      else if (parts[0] === 'note') Views.note(host, parts[1]);
      else Views.notFound(host);
    } catch (e) {
      host.innerHTML = '<div class="empty">화면을 그리지 못했습니다.<br><span class="small">' +
        String(e && e.message || e) + '</span></div>';
      if (w.console) console.error(e);
    }

    if (scroll && lastPath !== parsed.path) window.scrollTo(0, 0);
    lastPath = parsed.path;
  }

  function route() {
    if (!Data.ready) return;
    render(true);
  }

  var rzTimer = null;
  w.addEventListener('resize', function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () { if (Data.ready) render(false); }, 220);
  });

  function boot() {
    buildNav();
    bindModal();
    Data.load().then(function () {
      var f = document.getElementById('foot-asof');
      if (f) f.textContent = '점수 ' + F.day(Data.asOf()) + ' · 지수 ' + F.day(Data.now().as_of) + ' 종가 · 지연 데이터';
      /* 실시간(live.json)만 먼저 읽는다. 매수 지표 자료(gauge.json)는 그 탭을 열 때 받는다. */
      var pre = [];
      if (Data.loadLive) pre.push(Data.loadLive());
      return Promise.all(pre).then(function () {
        route();
        w.addEventListener('hashchange', route);
      });
    }).catch(function (e) {
      document.getElementById('view').innerHTML =
        '<div class="empty" style="padding:60px 10px">자료(data/*.json)를 불러오지 못했습니다.<br>' +
        '<span class="small">' + esc(String(e && e.message || e)) + '</span><br><br>' +
        '로컬에서 열었다면 서버로 띄워 주세요 — <code>python3 -m http.server</code><br>' +
        '브라우저가 파일을 직접 읽는 것을 막습니다.</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
