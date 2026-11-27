/* 5분 자동 시세 — data/live.json 을 읽어 점수·가격에 반영하고, 머리말 아래 띠로 보여 준다.
 *
 * 원칙
 *  - 이 파일은 views.js·style.css 를 건드리지 않는다. 자료층(Data)과 머리말 아래 띠만 손댄다.
 *  - live.json 이 없으면(404) 아무 것도 하지 않는다. 사이트는 지금처럼 스냅샷으로 동작한다.
 *  - 점수는 '확정 종가' 기준으로 갈아 끼우고, 프리마켓·애프터마켓 값은 '추정'으로 따로 적는다.
 *  - 값이 없으면 '—' 로 둔다. 지어내지 않는다.
 */
(function (w) {
  'use strict';

  var REL = 'data/live.json';
  /* 깃허브 페이지(Pages)는 커밋 뒤 빌드가 한 번 더 돌아 몇 분 늦다. 그래서 저장소 원본의
     같은 파일을 먼저 본다(원본은 커밋 몇 초 뒤에 갱신된다). CORS 열려 있다. */
  var RAW = 'https://raw.githubusercontent.com/daonwave323-dot/stock-rebalancing/main/data/live.json';
  var LS_WATCH = 'watch';
  var REFRESH_MS = 5 * 60 * 1000;

  /* 진짜 fetch 는 처음에 붙잡아 둔다 — 아래에서 data/live.json 요청을 가로채므로
     스스로를 다시 부르면 영원히 기다리게 된다. */
  var nativeFetch = (w.fetch && w.fetch.bind(w)) || null;

  var LIVE = { ok: false, data: null, error: null };
  var strip = null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function num(v, n) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toFixed(n === undefined ? 2 : n).replace(/\.0+$/, '');
  }
  function pct(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  }
  function money(v, cur) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (cur === '^') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }); /* 지수는 통화 없이 */
    var s = Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (cur === 'KRW') return '₩' + Number(v).toLocaleString('ko-KR');
    if (cur === 'NONE') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return '$' + s;
  }
  function sessKo(s) {
    return { pre: '장전', regular: '정규장', post: '장후', closed: '장 마감' }[s] || (s || '—');
  }
  function etShort(s) {
    if (!s) return '';
    return String(s).replace(/^\d{4}-/, '');
  }

  /* live.json 가져오기 — 같은 파일을 두 곳에서 동시에 받아 **더 새 것**을 쓴다.
     · 저장소 원본(raw.githubusercontent): 커밋 몇 초 뒤 갱신되지만 CDN 캐시가 몇 분 있다.
     · 깃허브 페이지 사본: 빌드가 한 번 돌아야 갱신되지만(1~3분) 캐시는 짧다.
     둘 다 없으면 조용히 실패하고 사이트는 스냅샷으로 돈다. */
  function fetchJson(url) {
    return nativeFetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function fetchLive() {
    var isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
    var fromRaw = isLocal ? Promise.resolve(null) : fetchJson(RAW).catch(function () { return null; });
    var fromSite = fetchJson(REL).catch(function () { return null; });
    return Promise.all([fromRaw, fromSite]).then(function (r) {
      var got = r.filter(function (d) { return d && d.updatedAt; });
      if (!got.length) throw new Error('live.json 을 받지 못했습니다');
      got.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
      return got[0];
    });
  }

  /* 한 번만 받는다 — 이 페이지 안에서 live.json 을 원하는 곳(점수 화면·증시 탭)이 모두 같은 값을 보게. */
  var pending = null;
  function liveDoc(force) {
    if (force) pending = null;
    if (LIVE.data && !force) return Promise.resolve(LIVE.data);
    if (!pending) {
      pending = fetchLive().then(function (d) {
        LIVE.ok = true; LIVE.data = d;
        return d;
      });
    }
    return pending;
  }

  /* 같은 사이트의 data/live.json 요청을 위에서 받아 둔 값으로 돌려준다.
     페이지 빌드가 늦어 옛 사본이 오는 일을 막고, 화면마다 다른 값이 뜨는 것을 막는다.
     (다른 주소·다른 파일 요청은 그대로 통과시킨다) */
  (function patchFetch() {
    if (!nativeFetch || w.__livePatched) return;
    w.__livePatched = true;
    var real = nativeFetch;
    w.fetch = function (input, init) {
      var url = '';
      try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
      var same = /(^|\/)data\/live\.json(\?|$)/.test(url) && !/^[a-z]+:\/\//i.test(url);
      if (same && w.Response) {
        return liveDoc().then(function (doc) {
          return new Response(JSON.stringify(doc), {
            status: 200, headers: { 'Content-Type': 'application/json' }
          });
        }).catch(function () { return real(input, init); });
      }
      return real(input, init);
    };
  })();

  /* ---------------------------------------------------------------- 자료 갈아 끼우기 */

  function applyScores(D) {
    var live = LIVE.data;
    if (!live || !live.symbols) return;
    var asOfLive = null;
    ['TQQQ', 'SOXL'].forEach(function (sym) {
      var s = live.symbols[sym];
      if (!s || s.score === null || s.score === undefined) return;
      if (s.scoreAsOf && D.scores.as_of && s.scoreAsOf < D.scores.as_of) return; /* 더 낡았으면 그대로 둔다 */
      var key = s.target || (sym === 'TQQQ' ? 'ndx' : 'sox');
      var t = D.scores.targets[key];
      if (!t) return;
      t.score = s.score;
      t.rows = s.scoreRows || t.rows;
      /* 판정 문구는 계산 경계(90·80·70·50)에서 바로 낸다 — live.json 사본이 낡아도 문구가 갈리지 않게 */
      t.verdict = (w.GaugeMath && w.GaugeMath.verdictOf) ? w.GaugeMath.verdictOf(s.score) : (s.scoreVerdict || t.verdict);
      t.as_of = s.scoreAsOf || t.as_of;
      t.dd = s.scoreDetail ? s.scoreDetail.dd : t.dd;
      t.close = s.scoreDetail ? s.scoreDetail.close : t.close;
      if (s.scoreDetail) {
        t.detail = t.detail || {};
        t.detail.close = s.scoreDetail.close;
        t.detail.peak = s.scoreDetail.peak;
        t.detail.ma200 = s.scoreDetail.ma200;
        if (s.scoreDetail.vix) {
          t.detail.vix = s.scoreDetail.vix.last;
          t.detail.ma50_vix = s.scoreDetail.vix.ma50;
          t.detail.vix_samples = s.scoreDetail.vix.samples;
        }
      }
      /* 실시간(추정) — 프리마켓·애프터마켓 값을 '진행 중인 봉'으로 얹은 점수 */
      t.live = s.scoreLive === null || s.scoreLive === undefined ? null : {
        score: s.scoreLive,
        verdict: s.scoreLiveVerdict,
        rows: s.scoreLiveRows,
        basis: s.scoreLiveBasis,
        price: s.scoreLivePrice,
        asOf: s.scoreLiveAsOf
      };
      if (!asOfLive || (s.scoreAsOf && s.scoreAsOf > asOfLive)) asOfLive = s.scoreAsOf;
    });
    if (asOfLive) D.scores.as_of = asOfLive;

    /* 점수 이력 차트의 마지막 점도 새 기준일까지 이어 준다 —
       카드가 93.2인데 차트 마지막이 98.6으로 끝나면 같은 화면에서 숫자가 어긋난다. */
    try {
      var hist = D.scores.history && D.scores.history.daily;
      var n = D.scores.targets.ndx, x = D.scores.targets.sox;
      if (hist && asOfLive && n && x && n.score !== undefined && x.score !== undefined) {
        var lastD = hist.length ? hist[hist.length - 1][0] : '';
        var lastW = D.scores.history.weekly && D.scores.history.weekly.length
          ? D.scores.history.weekly[D.scores.history.weekly.length - 1][0] : '';
        if (asOfLive > lastD) {
          hist.push([asOfLive, n.score, x.score, n.dd === undefined ? null : n.dd,
            x.dd === undefined ? null : x.dd]);
        }
        if (asOfLive > lastW && D.scores.history.weekly) {
          D.scores.history.weekly.push([asOfLive, n.score, x.score]);
        }
      }
    } catch (e) {}

    D.live = live;
  }

  /* ---------------------------------------------------------------- 머리말 아래 띠 */

  function symbolChip(sym) {
    var s = LIVE.data && LIVE.data.symbols ? LIVE.data.symbols[sym] : null;
    if (!s) return '';
    var shown = s.sessionPrice !== null && s.sessionPrice !== undefined ? s.sessionPrice : s.last;
    var chg = s.session !== 'regular' && s.session !== 'closed' ? s.sessionChangePct : s.changePct;
    var cls = chg === null || chg === undefined ? 'dim' : (chg >= 0 ? 'up' : 'down');
    return '<span class="lv-chip" data-sym="' + esc(sym) + '" title="' + esc(
      (s.name || sym) + ' · ' + sessKo(s.session) + (s.sessionTimeEt ? ' ' + s.sessionTimeEt : '') +
      (s.marketCapText ? ' · 시총 ' + s.marketCapText : '')
    ) + '">' +
      '<b>' + esc(sym.replace('^', '')) + '</b>' +
      '<span>' + esc(shown === null || shown === undefined ? '—' : money(shown, sym.charAt(0) === '^' ? '^' : s.currency)) + '</span>' +
      '<i class="' + cls + '">' + esc(pct(chg)) + '</i>' +
      '<em>' + esc(sessKo(s.session)) + '</em>' +
      '</span>';
  }

  function stripHtml() {
    var L = LIVE.data;
    if (!L) return '';
    var m = L.market || {};
    var closed = m.session === 'closed';
    var label = closed
      ? '장 마감 · 값이 멈춘 상태'
      : (m.sessionLabel || sessKo(m.session)) + (m.isHalfDay ? ' · 반나절 장' : '');
    return '<div class="lv-in">' +
      '<span class="lv-tag"><i class="lv-dot' + (closed ? ' off' : '') + '"></i>5분 자동 갱신</span>' +
      '<span class="lv-when">갱신 ' + esc(L.updatedAtKst || '') + ' KST · ' + esc(label) +
        ' · <b>지연될 수 있음</b></span>' +
      '<span class="lv-chips">' + ['TQQQ', 'SOXL', '^VIX', '^NDX'].map(symbolChip).join('') + '</span>' +
      '<button type="button" class="lv-more" id="lvMore">티커 시세</button>' +
      '</div>' +
      '<div class="lv-note">' + noteText() + '</div>';
  }

  function noteText() {
    var L = LIVE.data;
    var tq = L.symbols ? L.symbols['TQQQ'] : null;
    var parts = [];
    if (tq && (tq.session === 'pre' || tq.session === 'post') && tq.sessionPrice !== null && tq.sessionPrice !== undefined) {
      parts.push('지금 보이는 가격은 ' + sessKo(tq.session) + ' 체결가(' + etShort(tq.sessionTimeEt || '') +
        ')이고, 점수는 마지막 정규장 종가(' + String(tq.scoreAsOf || '').replace(/-/g, '.') + ') 기준입니다.');
    } else if (L.market && (L.market.session === 'regular')) {
      parts.push('정규장 진행 중 — 가격은 지금 체결가, 점수는 마지막 확정 종가(' +
        String(tq && tq.scoreAsOf || '').replace(/-/g, '.') + ') 기준입니다.');
    } else if (L.market && L.market.session === 'closed') {
      parts.push('정규장 밖이라 새 체결이 없습니다 — 보이는 값은 마지막 정규장 종가입니다.');
    }
    /* 지금 값을 마지막 봉으로 얹은 '추정' 점수 — 확정이 아니라고 분명히 적는다 */
    var t = L.symbols && L.symbols['TQQQ'], x = L.symbols && L.symbols['SOXL'];
    if (t && t.scoreLive !== null && t.scoreLive !== undefined && x && x.scoreLive !== null && x.scoreLive !== undefined) {
      parts.push('실시간(추정) TQQQ ' + Number(t.scoreLive).toFixed(1) + ' · SOXL ' + Number(x.scoreLive).toFixed(1) +
        ' — 지금 값을 진행 중인 봉으로 얹은 참고값입니다(확정 아님).');
    }
    parts.push('5분 주기지만 깃허브 사정으로 10~20분 늦을 수 있습니다. 판단 근거로 쓰지 마세요.');
    var ageMin = null;
    if (L.updatedAt) {
      var ts = Date.parse(L.updatedAt);
      if (!isNaN(ts)) ageMin = Math.round((Date.now() - ts) / 60000);
    }
    if (ageMin !== null && ageMin > 30) {
      parts.unshift('⚠ 이 파일이 ' + ageMin + '분째 그대로입니다 — 자동 갱신이 멈췄을 수 있습니다.');
    }
    return esc(parts.join(' '));
  }

  function mountStrip() {
    if (!LIVE.ok || !LIVE.data) return;
    var header = document.querySelector('.topbar');
    if (!header) return;
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'liveStrip';
      strip.setAttribute('role', 'status');
      header.parentNode.insertBefore(strip, header.nextSibling);
    }
    strip.innerHTML = stripHtml();
    var more = document.getElementById('lvMore');
    if (more) more.addEventListener('click', openPanel);
  }

  /* ---------------------------------------------------------------- 티커 시세 판(임의 티커) */

  function watchList() {
    var out = [];
    try {
      var extra = JSON.parse(w.localStorage.getItem('stockrebal.' + LS_WATCH) || '[]');
      if (Object.prototype.toString.call(extra) === '[object Array]') {
        extra.forEach(function (s) { if (s && out.indexOf(s) < 0) out.push(s); });
      }
    } catch (e) {}
    try {
      var hold = JSON.parse(w.localStorage.getItem('stockrebal.holdings') || '[]');
      if (Object.prototype.toString.call(hold) === '[object Array]') {
        hold.forEach(function (r) {
          var s = r && r.sym ? String(r.sym).toUpperCase().trim() : '';
          if (s && s !== 'CASH' && out.indexOf(s) < 0) out.push(s);
        });
      }
    } catch (e) {}
    return out;
  }

  function saveWatch(list) {
    try { w.localStorage.setItem('stockrebal.' + LS_WATCH, JSON.stringify(list)); } catch (e) {}
  }

  /* live.json 에 없는 티커는 브라우저가 야후에 직접 물어본다.
     대개 사이트 간 요청 차단(CORS)으로 실패한다 — 그 사실을 숨기지 않고 '지연/실패'로 적는다. */
  var DIRECT = {};
  function directQuote(sym) {
    if (DIRECT[sym]) return Promise.resolve(DIRECT[sym]);
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(sym) + '?range=1d&interval=5m&includePrePost=true';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (js) {
      var m = ((js.chart || {}).result || [{}])[0].meta || {};
      if (!m.regularMarketPrice) throw new Error('값 없음');
      DIRECT[sym] = { ok: true, price: m.regularMarketPrice, prev: m.chartPreviousClose, time: m.regularMarketTime };
      return DIRECT[sym];
    }).catch(function (e) {
      DIRECT[sym] = { ok: false, error: String(e && e.message || e) };
      return DIRECT[sym];
    });
  }

  function openPanel() {
    var old = document.getElementById('lvPanel');
    if (old) { old.parentNode.removeChild(old); return; }
    var L = LIVE.data || {};
    var rows = watchList();
    var panel = document.createElement('div');
    panel.id = 'lvPanel';
    panel.innerHTML =
      '<div class="lv-p-head"><b>티커 시세</b><span>5분 갱신 목록에서 찾고, 없으면 브라우저가 직접 시도합니다.</span>' +
      '<button type="button" id="lvClose">닫기</button></div>' +
      '<div class="lv-p-add"><input id="lvSym" maxlength="12" placeholder="티커 (예: NVDA, 005930.KS)">' +
      '<button type="button" id="lvAdd">목록에 추가</button></div>' +
      '<div class="lv-p-body">' + (rows.length ? '' : '<p class="lv-empty">아직 담은 티커가 없습니다. 리밸런싱 화면에 보유를 넣거나 위에 티커를 추가해 보세요.</p>') + '</div>' +
      '<p class="lv-p-foot">이 판은 이 브라우저에만 저장됩니다. 서버로 보내지 않습니다.</p>';
    document.body.appendChild(panel);

    function render() {
      var body = panel.querySelector('.lv-p-body');
      var list = watchList();
      if (!list.length) {
        body.innerHTML = '<p class="lv-empty">아직 담은 티커가 없습니다. 리밸런싱 화면에 보유를 넣거나 위에 티커를 추가해 보세요.</p>';
        return;
      }
      body.innerHTML = '<table><thead><tr><th>티커</th><th>현재가</th><th>등락</th><th>세션</th><th>시가총액</th></tr></thead><tbody>' +
        list.map(function (sym) {
          var s = (L.symbols || {})[sym];
          if (s) {
            var shown = s.sessionPrice !== null && s.sessionPrice !== undefined ? s.sessionPrice : s.last;
            var chg = s.session !== 'regular' && s.session !== 'closed' ? s.sessionChangePct : s.changePct;
            return '<tr><td><b>' + esc(sym) + '</b><div class="lv-nm">' + esc(s.name || '') + '</div></td>' +
              '<td>' + esc(money(shown, s.currency)) + '</td>' +
              '<td class="' + (chg >= 0 ? 'up' : 'down') + '">' + esc(pct(chg)) + '</td>' +
              '<td>' + esc(sessKo(s.session)) + '</td>' +
              '<td>' + esc(s.marketCapText || '—') + '</td></tr>';
          }
          var d = DIRECT[sym];
          var cell = d === undefined ? '조회 중…'
            : d.ok ? money(d.price, '') + ' <span class="lv-warn">(직접 조회)</span>'
            : '<span class="lv-warn">지연/실패 · 갱신 목록에 없음</span>';
          if (d === undefined) {
            directQuote(sym).then(function () { render(); });
          }
          return '<tr><td><b>' + esc(sym) + '</b></td><td colspan="3">' + cell + '</td><td>—</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="lv-p-foot">갱신 목록에 없는 티커를 계속 쓰려면 저장소의 data/watchlist.json 에 티커를 더하면 다음 갱신부터 들어옵니다.</p>';
    }
    render();

    panel.querySelector('#lvClose').addEventListener('click', function () {
      panel.parentNode.removeChild(panel);
    });
    panel.querySelector('#lvAdd').addEventListener('click', function () {
      var inp = panel.querySelector('#lvSym');
      var sym = String(inp.value || '').toUpperCase().replace(/\s+/g, '');
      if (!sym) return;
      var list = watchList();
      if (list.indexOf(sym) < 0) list.push(sym);
      saveWatch(list.filter(function (x) {
        /* 보유에서 온 것은 저장하지 않는다 — 중복을 막기 위해 추가분만 남긴다 */
        return true;
      }));
      /* 관심 목록은 증시 탭과 한 벌(watch.us·watch.kr)이다 — 여기서 담아도 같이 남는다. */
      if (w.Mkt && Mkt.addWatch) Mkt.addWatch(Mkt.marketOf(sym), sym, sym);
      inp.value = '';
      render();
    });
  }

  /* ---------------------------------------------------------------- 시작 */

  function refresh(D) {
    return liveDoc(true).then(function (live) {
      if (D) applyScores(D);
      else if (w.Data && w.Data.ready) applyScores(w.Data);
      mountStrip();
      /* 다른 파일(매수 지표)도 같은 파일을 보게 사본을 갈아 끼우고 알린다 */
      try { if (w.Basis && w.Basis.adopt) w.Basis.adopt(live); } catch (e) {}
      try {
        document.dispatchEvent(new CustomEvent('stockrebal:live', { detail: { updatedAt: live && live.updatedAt } }));
      } catch (e2) {
        try { document.dispatchEvent(new Event('stockrebal:live')); } catch (e3) {}
      }
      return D;
    }).catch(function (e) {
      LIVE.ok = false; LIVE.error = String(e && e.message || e);
      return D;
    });
  }

  /* Data.load() 가 끝난 직후 점수를 갈아 끼운다 — 화면이 그리기 전이어야 한다 */
  function wrap() {
    if (!w.Data || !w.Data.load) { setTimeout(wrap, 50); return; }
    var orig = w.Data.load;
    w.Data.load = function () {
      return orig.apply(this, arguments).then(function (D) { return refresh(D); });
    };

    setInterval(function () { refresh(null); }, REFRESH_MS);

    /* 탭으로 돌아오면 한 번 더 — 5분을 기다리지 않는다 */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh(null);
    });
  }
  wrap();

  /* 화면이 직접 부를 수 있는 새로고침 — 같은 5분 경로를 재사용한다(새 타이머를 만들지 않는다) */
  w.Live = {
    refresh: function () { return refresh(null); },
    data: function () { return LIVE.data; }
  };

  /* 띠 모양 — style.css 를 건드리지 않도록 이 파일에서만 넣는다 */
  var css = document.createElement('style');
  css.textContent = [
    '#liveStrip{font-size:12px;color:var(--dim,#9aa5b6);border-bottom:1px solid var(--line,#2a3140);',
    'background:var(--sunken,#161b24);padding:6px 14px 7px;line-height:1.5}',
    '#liveStrip .lv-in{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;max-width:1180px;margin:0 auto}',
    '#liveStrip .lv-tag{display:inline-flex;align-items:center;gap:5px;font-weight:600;color:var(--tx,#e8ecf4)}',
    '#liveStrip .lv-dot{width:6px;height:6px;border-radius:50%;background:#43b795;display:inline-block}',
    '#liveStrip .lv-dot.off{background:#8b94a3}',
    '#liveStrip .lv-when{color:var(--dim,#9aa5b6)}',
    '#liveStrip .lv-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '#liveStrip .lv-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border-radius:7px;',
    'border:1px solid var(--line2,#38404f);background:var(--panel,#1b2029)}',
    '#liveStrip .lv-chip b{color:var(--tx,#e8ecf4)}',
    '#liveStrip .lv-chip em{font-style:normal;color:var(--dim,#9aa5b6);font-size:11px}',
    '#liveStrip .up{color:#e05a5a}#liveStrip .down{color:#3f8fd6}',
    '#liveStrip .lv-note{max-width:1180px;margin:2px auto 0;color:var(--dim,#9aa5b6);font-size:11px}',
    '#liveStrip .lv-more{margin-left:auto;background:none;border:1px solid var(--line2,#38404f);color:inherit;',
    'border-radius:7px;padding:2px 9px;font:inherit;cursor:pointer}',
    '#lvPanel{position:fixed;z-index:60;top:96px;left:50%;transform:translateX(-50%);width:min(680px,94vw);',
    'max-height:70vh;overflow:auto;background:var(--panel,#1b2029);color:var(--tx,#e8ecf4);',
    'border:1px solid var(--line2,#38404f);border-radius:12px;box-shadow:0 18px 40px rgba(0,0,0,.35);padding:14px 16px}',
    '#lvPanel table{width:100%;border-collapse:collapse;font-size:12.5px}',
    '#lvPanel td, #lvPanel th{padding:6px 4px;border-bottom:1px solid var(--line,#2a3140);text-align:left}',
    '#lvPanel .lv-nm{color:var(--dim,#9aa5b6);font-size:11px}',
    '#lvPanel .up{color:#e05a5a}#lvPanel .down{color:#3f8fd6}',
    '#lvPanel .lv-warn{color:#c9a227}',
    '#lvPanel .lv-p-head{display:flex;gap:10px;align-items:baseline;margin-bottom:10px}',
    '#lvPanel .lv-p-head span{color:var(--dim,#9aa5b6);font-size:11.5px}',
    '#lvPanel .lv-p-head button{margin-left:auto;background:none;border:1px solid var(--line2,#38404f);',
    'color:inherit;border-radius:7px;padding:2px 9px;font:inherit;cursor:pointer}',
    '#lvPanel .lv-p-add{display:flex;gap:8px;margin-bottom:8px}',
    '#lvPanel .lv-p-add input{flex:1;background:var(--sunken,#161b24);border:1px solid var(--line2,#38404f);',
    'border-radius:7px;color:inherit;padding:6px 9px;font:inherit}',
    '#lvPanel .lv-p-add button{background:var(--sunken,#161b24);border:1px solid var(--line2,#38404f);',
    'border-radius:7px;color:inherit;padding:6px 10px;font:inherit;cursor:pointer}',
    '#lvPanel .lv-p-foot{color:var(--dim,#9aa5b6);font-size:11px;margin:8px 0 0}',
    '#lvPanel .lv-empty{color:var(--dim,#9aa5b6);font-size:12px}'
  ].join('');
  (document.head || document.documentElement).appendChild(css);
})(window);
