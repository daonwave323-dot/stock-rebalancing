/* 라우터와 시작 */
(function (w) {
  'use strict';

  var NAV = [
    { href: '#/', label: '홈', key: 'home' },
    { href: '#/crash', label: '폭락 사례', key: 'crash' },
    { href: '#/rebalance', label: '리밸런싱', key: 'rebalance' },
    { href: '#/journal', label: '기록', key: 'journal' },
    { href: '#/verify', label: '검증 기록', key: 'verify' },
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
    if (path.indexOf('/crash') === 0) return 'crash';
    if (path.indexOf('/rebalance') === 0) return 'rebalance';
    if (path.indexOf('/journal') === 0) return 'journal';
    if (path.indexOf('/verify') === 0) return 'verify';
    if (path.indexOf('/read') === 0) return 'readings';
    return '';
  }

  function parse() {
    var raw = location.hash.replace(/^#/, '');
    var parts = raw.split('/').filter(function (x) { return x !== ''; });
    return { parts: parts, path: '/' + parts.join('/') };
  }

  var lastPath = null;
  var busy = false;

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

    try {
      if (parts.length === 0) Views.home(host);
      else if (parts[0] === 'score') Views.score(host, parts[1]);
      else if (parts[0] === 'crash') {
        if (parts[1]) Views.crashDetail(host, parts[1]);
        else Views.crash(host);
      }
      else if (parts[0] === 'rebalance') Views.rebalance(host);
      else if (parts[0] === 'journal') Views.journal(host);
      else if (parts[0] === 'verify') Views.verify(host);
      else if (parts[0] === 'readings') Views.readings(host);
      else if (parts[0] === 'read') Views.article(host, parts[1]);
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
      route();
      w.addEventListener('hashchange', route);
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
