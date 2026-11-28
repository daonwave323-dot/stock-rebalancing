/* 화면들 */
(function (w) {
  'use strict';

  var V = {};
  var scoreTab = 'ndx';        /* 점수 상세에서 보고 있는 갈래 */
  var crashScale = 'peak';     /* 폭락 상세 차트 눈금 */
  var analogHorizon = 30;      /* 산점도 세로축: 30/90/180 */
  var analogFilter = 'all';    /* 사례 필터 */
  var analogFocus = null;      /* 다른 화면에서 '닮은 날'로 넘어올 때 기준 낙폭 */
  var analogFocusNote = '';
  var journalEditId = null;    /* 매매일지 수정 중인 기록 */
  var homeLoadingGauge = false; /* 홈이 프리마켓 값 때문에 매수 지표 자료를 받는 중인지 */
  var journalFocus = null;     /* 일지에서 방금 누른 매매 — 줄을 강조한다 */
  var verifyTradeFocus = null; /* 검증 섹션에서 강조할 매매(일지 ↔ 검증 연결) */
  var journalOnlyBad = false;  /* 원칙 위반 매매만 보기 */
  var verifyOnlyBad = false;

  /* 지금 화면에 붙어 있는 #view 노드 — 라우터가 화면을 다시 그리면 노드가 바뀌므로
     콜백(모달 확인, 비동기 응답) 안에서는 잡아 둔 view 대신 이걸 쓴다. */
  function liveView() { return document.getElementById('view'); }

  /* ------------------------------------------------------------ 산점도 기준 (확정 종가 / 실시간) */
  var AVG_BAND = 3;       /* 기준 낙폭 ±%p — 평균선을 내는 구간 */
  var AVG_MIN_N = 5;      /* 표본이 이보다 적으면 평균을 긋지 않는다 */
  var AVG_COLOR = '#3fd0c0';

  /* 매수 지표 화면과 같은 설정(localStorage 'basis')을 따른다 */
  function basisMode() {
    try { if (w.Basis && Basis.get) return Basis.get(); } catch (e) {}
    return S.get('basis', 'close') === 'live' ? 'live' : 'close';
  }
  function setBasisMode(v) {
    var want = v === 'live' ? 'live' : 'close';
    try { if (w.Basis && Basis.set) { Basis.set(want); return; } } catch (e) {}
    S.set('basis', want);
  }

  /* live.json 의 ^NDX 현재 값 — 없으면 null(값을 지어내지 않는다) */
  function ndxLive() {
    var L = (w.Live && Live.data) ? Live.data() : (Data.live || null);
    var s = L && L.symbols ? L.symbols['^NDX'] : null;
    var price = null, at = null, sess = null;
    if (s) {
      price = (s.sessionPrice !== null && s.sessionPrice !== undefined) ? s.sessionPrice : s.last;
      at = s.sessionTimeEt || s.lastTimeEt || s.lastTime || null;
      sess = s.sessionLabel || s.session || null;
    }
    if (price === null || price === undefined) {
      var q = null;
      try { q = (w.Basis && Basis.quote) ? Basis.quote('^NDX') : null; } catch (e) { q = null; }
      if (q && q.price !== null && q.price !== undefined) { price = q.price; at = q.at; sess = q.session; }
    }
    var peak = (Data.analog && Data.analog.now ? Data.analog.now.peak_close : null) ||
      (Data.crashes && Data.crashes.now ? Data.crashes.now.peak_close : null);
    if (price === null || price === undefined || !peak) return null;
    return {
      price: Number(price), dd: (Number(price) / peak - 1) * 100,
      at: at, session: sess, peak: peak, updatedAtKst: (L && L.updatedAtKst) || null
    };
  }

  function idxNum(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  var HOLD_KEY = 'holdings';
  var SET_KEY = 'settings';
  var JOURNAL_KEY = 'journal';
  var VERIFY_KEY = 'verify';
  var PRIN_KEY = 'principles';

  /* ------------------------------------------------------------ 저장소 */
  function holdings() { return S.get(HOLD_KEY, []); }
  function settings() { return S.get(SET_KEY, { total: 0, band: 5 }); }

  /* ------------------------------------------------------------ 시장별 저장소 (미국장·국장) */
  var MKT_LABEL = { us: '미국장', kr: '국장' };
  var MKT_CUR = { us: 'USD', kr: 'KRW' };
  var MKT_UNIT = { us: '달러', kr: '원' };
  var REB_TAB = 'rebal.market';
  var MKT_OK = { us: 1, kr: 1 };

  function rebMarket() { var m = S.get(REB_TAB, 'us'); return MKT_OK[m] ? m : 'us'; }
  function mktHoldKey(m) { return 'holdings.' + (m === 'kr' ? 'kr' : 'us'); }
  function mktSetKey(m) { return 'settings.' + (m === 'kr' ? 'kr' : 'us'); }

  /* 예전 한 벌 키(stockrebal.holdings·settings)를 미국장 자리로 한 번만 옮긴다.
     원래 키는 지우지 않는다 — 홈 시세 표·매매일지·도구 탭이 아직 그 키를 읽는다. */
  function migrateMkt() {
    if (S.get('rebal.split', 0)) return;
    if (S.get('holdings.us', null) === null) {
      var old = S.get(HOLD_KEY, null);
      S.set('holdings.us', Object.prototype.toString.call(old) === '[object Array]' ? old : []);
    }
    if (S.get('holdings.kr', null) === null) S.set('holdings.kr', []);
    if (S.get('settings.us', null) === null) {
      var os = S.get(SET_KEY, null);
      S.set('settings.us', (os && typeof os === 'object') ? os : { total: 0, band: 5 });
    }
    if (S.get('settings.kr', null) === null) S.set('settings.kr', { total: 0, band: 5 });
    S.set('rebal.split', 1);
  }

  function mktHoldings(m) {
    migrateMkt();
    var v = S.get(mktHoldKey(m), []);
    return Object.prototype.toString.call(v) === '[object Array]' ? v : [];
  }
  function mktSettings(m) {
    migrateMkt();
    var v = S.get(mktSetKey(m), null);
    if (!v || typeof v !== 'object') v = { total: 0, band: 5 };
    return {
      total: Number(v.total) || 0,
      band: (v.band === undefined || v.band === null || isNaN(v.band)) ? 5 : Number(v.band)
    };
  }
  function saveMktHoldings(m, rows) {
    S.set(mktHoldKey(m), rows);
    if (m !== 'kr') S.set(HOLD_KEY, rows);   /* 예전 키를 읽는 화면과 같은 내용으로 */
  }
  function saveMktSettings(m, st) {
    S.set(mktSetKey(m), st);
    if (m !== 'kr') S.set(SET_KEY, st);
  }
  function marketCalc(m) {
    var st = mktSettings(m);
    return calcHoldings(mktHoldings(m), { total: st.total, band: st.band });
  }
  function isKrSym(sym) { return /^\d{6}$/.test(String(sym || '').trim()); }

  /* 관심 목록 — 증시 탭과 같은 키(watch.us·watch.kr). 라이브러리에 watchAll 이 없어도 동작하게. */
  function watchSymbols() {
    if (w.Mkt && Mkt.watch) {
      var out = [];
      ['us', 'kr'].forEach(function (m) {
        (Mkt.watch(m) || []).forEach(function (x) {
          var s = String((x && x.sym) || x || '').toUpperCase();
          if (s && out.indexOf(s) < 0) out.push(s);
        });
      });
      return out;
    }
    return S.get('watch', []);
  }

  /* ------------------------------------------------------------ 환율 (원/달러) */
  /* 순서: 직접 넣은 값 → data/live.json 의 fx.usdkrw → 마지막으로 받은 값.
     값이 없으면 없는 대로 적고, 원 환산을 하지 않는다(지어내지 않는다). */
  function fxLiveNow() {
    var L = (w.Live && Live.data) ? Live.data() : ((w.Data && Data.live) || null);
    if (L && L.fx && L.fx.usdkrw > 0) {
      return { usdkrw: Number(L.fx.usdkrw), at: L.fx.time || L.updatedAt || null,
        src: L.fx.source || 'data/live.json' };
    }
    if (w.Mkt && Mkt.fx && Mkt.fx() > 0) return { usdkrw: Number(Mkt.fx()), at: null, src: 'data/market.json' };
    return null;
  }
  function stampOf(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (isNaN(t)) return String(iso);
    var d = new Date(t);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fxNow() {
    var saved = S.get('fx', null);
    if (saved && saved.usdkrw > 0) {
      return { usdkrw: Number(saved.usdkrw), at: saved.at || null, src: '직접 입력', manual: true };
    }
    var live = fxLiveNow();
    if (live) {
      S.set('fx.last', { usdkrw: live.usdkrw, at: live.at });
      return live;
    }
    var last = S.get('fx.last', null);
    if (last && last.usdkrw > 0) {
      return { usdkrw: Number(last.usdkrw), at: last.at || null, src: '마지막으로 받은 값', stale: true };
    }
    return null;
  }

  /* ------------------------------------------------------------ live.json 한 종목 */
  /* 국장은 6자리 코드로도 찾는다(live.json 은 005930.KS 형식으로 담는다). */
  function liveDocNow() {
    return (w.Live && Live.data) ? Live.data() : ((w.Data && Data.live) || null);
  }
  function liveSymEntry(sym) {
    var L = liveDocNow();
    if (!L || !L.symbols) return null;
    var s = String(sym || '').trim().toUpperCase();
    return L.symbols[s] || L.symbols[s + '.KS'] || L.symbols[s + '.KQ'] || null;
  }
  function krLiveInfo(code, suf) {
    var L = liveDocNow();
    if (!L || !L.symbols) return null;
    var e = (suf && L.symbols[code + '.' + suf]) || L.symbols[code + '.KS'] || L.symbols[code + '.KQ'] || L.symbols[code];
    if (!e || e.last === null || e.last === undefined) return null;
    var px = (e.sessionPrice !== null && e.sessionPrice !== undefined) ? e.sessionPrice : e.last;
    return {
      price: px, name: e.name || e.nameKo || '', code: code,
      chg: (e.session === 'regular' && e.sessionChangePct !== null && e.sessionChangePct !== undefined)
        ? e.sessionChangePct : e.changePct,
      at: e.sessionKst || e.lastTimeKst || e.regularCloseKst || null,
      src: e.session === 'regular' ? '국장 정규장' : '마지막 국장 종가',
      live: true
    };
  }

  /* 국장 6자리 코드 → 시세. live.json → 증시 스냅샷 → 브라우저 직접(대개 차단). */
  function krQuote(code, suf) {
    var raw = String(code || '').trim().toUpperCase();
    var m = /^(\d{6})(?:\.(KS|KQ))?$/.exec(raw);
    if (!m) return Promise.resolve(null);
    var c = m[1], s = m[2] || suf || '';
    var live = krLiveInfo(c, s);
    if (live) return Promise.resolve(live);
    function fromSnap() {
      if (!(w.Mkt && Mkt.quote)) return null;
      var q = Mkt.quote(c);
      if (!q || q.regPrice === null || q.regPrice === undefined) return null;
      return { price: q.regPrice, name: q.name || '', code: c, at: (w.Mkt.snap && w.Mkt.snap.generatedAt) || null,
        src: '증시 스냅샷(지연)' };
    }
    var ready = (w.Mkt && Mkt.ready) ? Promise.resolve(true)
      : ((w.Mkt && Mkt.load) ? Mkt.load().catch(function () { return null; }) : Promise.resolve(null));
    return ready.then(fromSnap).then(function (r) {
      if (r) return r;
      return krDirect(c, s);
    });
  }
  function krDirect(code, suf) {
    var order = (suf === 'KQ') ? ['KQ', 'KS'] : ['KS', 'KQ'];
    function one(i) {
      if (i >= order.length) return Promise.resolve(null);
      var sym = code + '.' + order[i];
      return fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + sym + '?range=1d&interval=1d')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (js) {
          var meta = ((js.chart || {}).result || [{}])[0].meta || {};
          if (!meta.regularMarketPrice) throw new Error('값 없음');
          return { price: meta.regularMarketPrice, name: meta.shortName || '', code: code,
            at: new Date().toISOString(), src: '야후 직접 조회', live: false };
        })
        .catch(function () { return one(i + 1); });
    }
    return one(0);
  }

  function defaultPrinciples() {
    return [
      { id: 'p1', text: '계획한 분할 회차인가' },
      { id: 'p2', text: '손실선을 정했는가' },
      { id: 'p3', text: '특이점 점수와 내 자리가 근거에 적혀 있는가' }
    ];
  }
  function principles() {
    var p = S.get(PRIN_KEY, null);
    if (!p || !p.length) { p = defaultPrinciples(); S.set(PRIN_KEY, p); }
    return p;
  }
  function journal() { return S.get(JOURNAL_KEY, []); }
  function verifyList() { return S.get(VERIFY_KEY, []); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var GRADE_TEXT = { ok: '○ 적중', no: '✕ 빗나감', wait: '대기 중' };
  var CALLS = ['매수', '관망', '매도'];

  /* 채점: 30거래일 뒤 지수 수익률. 매수>0, 매도<0, 관망=|수익률|<3% */
  function gradeOf(call, ret) {
    if (ret === null || ret === undefined) return 'wait';
    if (call === '매수') return ret > 0 ? 'ok' : 'no';
    if (call === '매도') return ret < 0 ? 'ok' : 'no';
    return Math.abs(ret) < 3 ? 'ok' : 'no';
  }
  function gradeBadge(call, ret) {
    var g = gradeOf(call, ret);
    var cls = g === 'ok' ? 'good' : g === 'no' ? 'red' : 'grey';
    return '<span class="badge ' + cls + '">' + GRADE_TEXT[g] + '</span>';
  }
  function verifyRows() {
    return verifyList().map(function (r) {
      var f = Data.indexForward(r.date, 30);
      var ret = f ? f.ret : null;
      return { r: r, f: f, ret: ret, grade: gradeOf(r.call, ret) };
    }).sort(function (a, b) { return a.r.date < b.r.date ? 1 : -1; });
  }

  /* ------------------------------------------------------------ 보유·리밸런싱 계산 */
  function calcHoldings(rows, opts) {
    opts = opts || {};
    var band = opts.band === undefined ? 5 : opts.band;
    var list = (rows || []).map(function (r) {
      var price = Number(r.price) || 0;
      var qty = Number(r.qty) || 0;
      var avg = Number(r.avg) || 0;
      var value = price * qty;
      return {
        id: r.id, sym: r.sym, qty: qty, avg: avg, price: price, target: Number(r.target) || 0,
        value: value, cost: avg * qty, pl: value - avg * qty,
        plPct: avg > 0 ? (price / avg - 1) * 100 : null
      };
    });
    var totalValue = list.reduce(function (a, r) { return a + r.value; }, 0);
    var totalCost = list.reduce(function (a, r) { return a + r.cost; }, 0);
    var base = (opts.total && opts.total > 0) ? opts.total : totalValue;
    var targetSum = 0, buy = 0, sell = 0, out = 0, topRow = null;
    list.forEach(function (r) {
      /* 비중은 '총 투자금'(비우면 평가금액 합계) 대비 — 목표 금액과 같은 기준이어야
         밴드 이탈과 매수·매도 방향이 서로 어긋나지 않는다. */
      r.weight = base > 0 ? r.value / base * 100 : 0;
      r.targetValue = r.target / 100 * base;
      r.diffValue = r.targetValue - r.value;
      r.drift = r.weight - r.target;
      r.isOut = Math.abs(r.drift) > band;
      r.qtyDelta = r.isOut && r.price > 0 ? Math.floor(r.diffValue / r.price) : 0;
      targetSum += r.target;
      if (r.isOut) {
        out++;
        if (r.diffValue > 0) buy += r.diffValue; else sell += -r.diffValue;
      }
      if (!topRow || r.value > topRow.value) topRow = r;
    });
    return {
      rows: list, totalValue: totalValue, totalCost: totalCost, pl: totalValue - totalCost,
      plPct: totalCost > 0 ? (totalValue / totalCost - 1) * 100 : null,
      base: base, band: band, targetSum: targetSum || 0, buy: buy, sell: sell, out: out, topRow: topRow
    };
  }

  /* 홈이 쓰는 두 시장 합계 — 미국장은 환율로 원화에 환산해 더한다.
     환율이 없으면 미국장은 환산하지 않고, 그 사실을 krwOnly 로 돌려준다(합계를 지어내지 않는다). */
  function portfolioState() {
    migrateMkt();
    var us = marketCalc('us'), kr = marketCalc('kr');
    if (!us.rows.length && !kr.rows.length) return null;
    var fx = fxNow();
    var rate = fx ? fx.usdkrw : null;
    var rows = [];
    us.rows.forEach(function (r) {
      var c = {}; for (var k in r) c[k] = r[k];
      c.mkt = 'us'; c.cur = 'USD'; c.krw = rate ? r.value * rate : null;
      rows.push(c);
    });
    kr.rows.forEach(function (r) {
      var c = {}; for (var k in r) c[k] = r[k];
      c.mkt = 'kr'; c.cur = 'KRW'; c.krw = r.value;
      rows.push(c);
    });
    var usKrw = rate ? us.totalValue * rate : null;
    var usCostKrw = rate ? us.totalCost * rate : null;
    var totalValue = kr.totalValue + (usKrw || 0);
    var totalCost = kr.totalCost + (usCostKrw || 0);
    var topRow = null;
    rows.forEach(function (r) {
      if (r.krw === null) return;
      if (!topRow || r.krw > topRow.krw) topRow = r;
    });
    return {
      rows: rows, us: us, kr: kr, fx: fx, rate: rate,
      usKrw: usKrw, krKrw: kr.totalValue,
      totalValue: totalValue, totalCost: totalCost, pl: totalValue - totalCost,
      plPct: totalCost > 0 ? (totalValue / totalCost - 1) * 100 : null,
      krwOnly: usKrw === null && us.rows.length > 0,
      out: us.out + kr.out, band: us.band, bands: { us: us.band, kr: kr.band },
      targetSum: us.targetSum + kr.targetSum, topRow: topRow
    };
  }

  /* ------------------------------------------------------------ 홈 (오늘 대시보드) */
  V.home = function (view) {
    var t = Data.scores.targets, now = Data.now();
    var closest = Data.closestCase();
    var ver = verifyRows();
    var pf = portfolioState();
    var asOf = Data.asOf();
    var badCount = journal().filter(function (r) { return r.principles && r.principles.pass === false; }).length;

    /* 기준 — 정규장(확정 종가) / 프리마켓(실시간 추정). 원본 MarketScreen 의 두 탭과 같은 구분이고,
       고른 기준은 홈·매수 지표가 함께 쓴다(Basis 한 곳에 저장). */
    var basis = w.Basis ? Basis.get() : 'close';
    var liveNote = w.Basis ? Basis.status() : null;

    /* 프리마켓인데 매수 지표 자료를 아직 안 받았으면 받아서 다시 그린다(첫 화면을 무겁게 하지 않는다) */
    if (basis === 'live' && w.Basis && Basis.status().hasLive && !Data.gauge && Data.loadGauge && !homeLoadingGauge) {
      homeLoadingGauge = true;
      Data.loadGauge().then(function () { homeLoadingGauge = false; V.home(liveView()); })
        .catch(function () { homeLoadingGauge = false; });
    }

    function liveRows(key) {
      if (basis !== 'live' || !w.Basis || !w.GaugeMath) return null;
      var l = Basis.valuesFor(key);
      if (!l) return null;
      return GaugeMath.scoreOf(l.values, key);
    }

    function card(key, cls) {
      var s = t[key];
      var SHORT = { dd: '고점 대비 낙폭', wrsi: '주간 RSI', vixr: 'VIX/50일', gap: '200일선 이격', drsi: '일간 RSI', vixp: '공포 백분위' };
      var lr = liveRows(key);
      var score = lr ? lr.score : s.score;
      var verdict = lr && w.GaugeMath ? GaugeMath.verdictOf(score) : s.verdict;
      /* 반도체만 2단계 브레이크 — 90점을 넘어도 업황 자리가 아니면 '매수' 대신 '경보'(매수 지표와 같은 판정) */
      var br = (w.Data && Data.brake) ? Data.brake(key) : null;
      var warn = !!(br && score >= 90 && !br.pass);
      if (warn) verdict = { label: '90점 돌파 · 경보', sub: '업황·금리 확인 전에는 매수가 아닙니다' };
      var rows = lr ? lr.rows : s.rows;
      var bars = rows.map(function (r) {
        var c = (r.converted === null || r.converted === undefined) ? 0 : r.converted;
        return '<li><span>' + esc(SHORT[r.key] || r.name) + '</span>' +
          '<span class="track"><i class="' + (c >= 90 ? 'hi' : '') + '" style="width:' + Math.max(0, Math.min(100, c)) + '%"></i></span>' +
          '<b>' + (r.converted === null || r.converted === undefined ? '—' : F.num(r.converted)) + '</b></li>';
      }).join('');
      /* 2단계 브레이크 한 줄 — 매수 지표 카드와 같은 값·같은 자료(data/crashes_sox.json) */
      var brakeLine = '';
      if (br) {
        var sn = (w.Data && Data.nowFor) ? Data.nowFor(key) : null;
        brakeLine = '<p class="note" style="margin:6px 0 0">' +
          '<b>2단계 · 업황·금리</b> ' + (br.pass ? '<span class="badge good">조건 충족</span>' : '<span class="badge amber">경보 유지</span>') +
          '<br>SOX 고점 대비 ' + F.pct(br.dd, 1) + ' (' + (br.band ? '바닥권 −35~−53%' : '바닥권 아님') + ')' +
          ' · 경과 ' + F.num(br.months, 1) + '개월 (' + (br.dur_ok ? '8~14개월 구간' : '8~14개월 전') + ')' +
          (sn ? ' · 고점 ' + F.day(sn.peak_date) + ' → 저점 ' + F.day(sn.trough) : '') + '</p>';
      }
      return '<article class="score-card ' + cls + '">' +
        '<header><span class="sym">' + esc(s.symbol) + '</span><span class="ttl">' + esc(s.label) + '</span>' +
          (lr ? '<span class="badge live" style="margin-left:auto">프리마켓(추정)</span>' : '') +
          (warn ? '<span class="badge amber" style="margin-left:auto">경보</span>' : '') + '</header>' +
        '<div class="score-big">' + F.num(score) + '<small>/ 100</small></div>' +
        '<div class="verdict"><b>' + esc(verdict.label) + '</b><span>' + esc(verdict.sub) + '</span></div>' +
        '<div class="meter"><i style="width:' + score + '%"></i></div>' +
        '<ul class="bars">' + bars + '</ul>' +
        brakeLine +
        '<a class="btn ghost sm" href="#/gauge">지표 자세히 →</a>' +
        '</article>';
    }

    var matched = '';
    if (closest) {
      var m = closest.now_match;
      matched = '가장 닮은 사례 <b>' + esc(closest.short + ' ' + closest.name) + '</b>의 ' + F.day(m.date) +
        ' (고점 +' + m.day + '거래일, 낙폭 ' + F.pct(m.dd, 1) + ', 거리 ' + F.num(m.distance, 2) + ') → 그 뒤 30거래일 ' +
        '<b class="' + (m.fwd30 === null ? '' : (m.fwd30 < 0 ? 'neg' : 'pos')) + '">' + F.pct(m.fwd30, 1) + '</b>';
    }

    /* ② 내 자리 — 시장 자리 + 내 계좌 (미국장은 환율로 원화 환산) */
    var myPos;
    if (!pf) {
      myPos = '<p class="big-line dim">보유를 먼저 넣어 주세요</p>' +
        '<p class="sub-line">리밸런싱의 미국장(달러)·국장(원) 탭에 티커·수량·평균단가를 넣으면 비중과 밴드 이탈을 여기서 계산합니다. ' +
        '<a href="#/rebalance">보유 넣기 →</a></p>';
    } else {
      var usd = function (v) { return '$' + Math.round(Number(v) || 0).toLocaleString('ko-KR'); };
      var parts = [];
      parts.push('미국장 ' + usd(pf.us.totalValue) + (pf.rate ? ' (약 ' + F.int(pf.usKrw) + '원)' : ' (환율 값 없음)'));
      parts.push('국장 ' + F.int(pf.krKrw) + '원');
      if (pf.topRow) parts.push('최대 비중 ' + (pf.topRow.mkt === 'kr' ? '[국장] ' : '[미국장] ') + esc(pf.topRow.sym || '이름 없음') + ' ' + F.num(pf.topRow.weight, 1) + '%');
      parts.push('밴드 이탈 ' + pf.out + '종목');
      myPos = (pf.krwOnly
          ? '<p class="big-line">국장 ' + F.int(pf.krKrw) + '원 <span class="dim">· 미국장은 환율 값이 없어 환산 전</span></p>'
          : '<p class="big-line">총 ' + F.won(pf.totalValue) + '원 · 평가손익 ' +
            '<span class="' + (pf.pl >= 0 ? 'pos' : 'neg') + '">' + (pf.pl >= 0 ? '+' : '') + F.int(pf.pl) + '원' +
            (pf.plPct === null ? '' : ' (' + F.pct(pf.plPct, 1) + ')') + '</span></p>') +
        '<p class="sub-line">' + parts.join(' · ') +
          '<br><span class="dim">' + (pf.rate ? '환율 ' + F.int(pf.rate) + '원/달러로 환산 · 국장은 원금액' : '환율 값 없음 — 미국장 원 환산 전') +
          '</span> · <a href="#/rebalance">표 보기 →</a></p>';
    }

    /* ③ 최근 판단 */
    var recent = ver.slice(0, 3);
    var verHtml;
    if (!recent.length) {
      verHtml = '<p class="sub-line dim">아직 남긴 판단이 없습니다. <a href="#/journal/verify">첫 판단 남기기 →</a></p>';
    } else {
      verHtml = '<ul class="list">' + recent.map(function (v) {
        return '<li>' + F.day(v.r.date) + ' · <b>' + esc(v.r.call) + '</b> · ' +
          (v.ret === null ? '30거래일 뒤 자료 없음' : '30거래일 뒤 ' + F.pct(v.ret, 1)) + ' · ' +
          gradeBadge(v.r.call, v.ret) + '</li>';
      }).join('') + '</ul>';
    }

    /* ④ 오늘 할 일 */
    var todo;
    if (!pf) {
      todo = '<p class="big-line dim">보유를 먼저 넣어 주세요</p><p class="sub-line">넣는 순간 오늘 손댈 종목을 한 줄로 알려 드립니다. <a href="#/rebalance">보유 넣기 →</a></p>';
    } else if (!pf.totalValue) {
      todo = '<p class="big-line dim">현재가·수량이 비어 있습니다</p><p class="sub-line">리밸런싱 표에서 현재가와 수량을 채워 주세요. <a href="#/rebalance">표 열기 →</a></p>';
    } else {
      var hits = pf.rows.filter(function (r) { return r.isOut && Math.abs(r.drift) > 0; }).sort(function (a, b) { return Math.abs(b.drift) - Math.abs(a.drift); });
      var bandTxt = pf.bands.us === pf.bands.kr
        ? '밴드 ±' + F.num(pf.bands.us) + '%p'
        : '밴드 미국 ±' + F.num(pf.bands.us) + ' · 국장 ±' + F.num(pf.bands.kr) + '%p';
      if (!hits.length) {
        todo = '<p class="big-line todo-ok">오늘은 없음 — 모든 종목이 밴드 안입니다</p>' +
          '<p class="sub-line">' + bandTxt + ' · 다음 확인은 다음 거래일. <a href="#/rebalance">표 보기 →</a></p>';
      } else {
        var h = hits[0];
        var hcur = h.cur === 'KRW' ? 'KRW' : 'USD';
        var amtTxt = function (v) {
          return hcur === 'KRW' ? F.int(Math.abs(v)) + '원' : '$' + Math.round(Math.abs(v)).toLocaleString('ko-KR');
        };
        var way;
        if ((h.sym || '').trim().toUpperCase() === 'CASH') {
          way = amtTxt(h.diffValue) + ' ' + (h.diffValue > 0 ? '늘리는 쪽' : '줄이는 쪽');
        } else if (h.qtyDelta < 0) {
          way = Math.abs(h.qtyDelta) + '주 매도 쪽';
        } else if (h.qtyDelta > 0) {
          way = h.qtyDelta + '주 매수 쪽';
        } else {
          way = '금액 조정';
        }
        todo = '<p class="big-line todo-bad">' + (h.mkt === 'kr' ? '[국장] ' : '[미국장] ') +
          esc(h.sym || '이름 없음') + ' ' + F.signed(h.drift, 1) + '%p 이탈 — ' + way + '</p>' +
          '<p class="sub-line">' + bandTxt + ' · 이탈 ' + pf.out + '종목 · <a href="#/rebalance">수량 보기 →</a></p>';
      }
    }

    var cases = Data.crashes.cases;
    var caseCards = cases.map(function (c) {
      var m2 = c.now_match;
      return '<a class="case-card" href="#/gauge/crash/' + c.id + '" style="border-left-color:' + c.color + '">' +
        '<div class="top"><span class="nm">' + esc(c.short) + '</span><span class="dd">' + F.pct(c.dd, 1) + '</span></div>' +
        '<div class="meta">' + esc(c.name) + ' · 저점까지 ' + F.int(c.days_to_trough) + '거래일</div>' +
        (m2 ? '<div class="meta">닮은 날 ' + F.day(m2.date) + ' (고점 +' + m2.day + '일, 거리 ' + F.num(m2.distance, 2) + ') → 30일 ' + F.pct(m2.fwd30, 1) + '</div>' : '') +
        '</a>';
    }).join('');

    var reads = Data.readings.articles.map(function (a) {
      return '<a class="read-card" href="#/read/' + a.id + '">' +
        '<span class="tag">' + esc(a.tag) + '</span>' +
        '<h3>' + esc(a.title) + '</h3><p>' + esc(a.summary) + '</p></a>';
    }).join('');

    view.innerHTML =
      '<section class="hero">' +
        '<div class="row" style="margin-bottom:8px"><h1>오늘</h1>' +
          '<span class="badge live">지연 데이터 · 점수 ' + F.day(asOf) + ' · 지수 ' + F.day(now.as_of) + ' 종가</span>' +
          '<span class="badge">^NDX ' + F.int(now.close) + '</span>' +
        '</div>' +
        '<p>여섯 지표로 오늘의 자리를 재고, 계획한 비중으로 다시 맞춥니다.</p>' +
        '<div class="row" style="margin-top:10px">' +
          '<span class="g-seg" id="homeBasis" role="group" aria-label="시세 기준">' +
            '<button type="button" data-basis="close" class="' + (basis === 'close' ? 'on' : '') + '">정규장</button>' +
            '<button type="button" data-basis="live" class="' + (basis === 'live' ? 'on' : '') + '">프리마켓</button>' +
          '</span>' +
          '<span class="badge ' + (basis === 'live' && liveNote && liveNote.hasLive ? 'live' : 'grey') + '">' +
            (basis === 'live' ? (liveNote && liveNote.hasLive ? (liveNote.label || '실시간(추정)') : '실시간 값 없음 — 확정 종가') : '확정(종가) · ' + F.day(asOf)) +
          '</span>' +
        '</div>' +
        (basis === 'live' && !(liveNote && liveNote.hasLive)
          ? '<p class="note" style="color:var(--amber)">data/live.json 에 실시간 값이 없어 위 두 점수는 마지막 확정 종가 그대로입니다. 값이 들어오면 이 자리에서 다시 계산됩니다.</p>'
          : '') +
        '<div class="row" style="margin-top:10px">' +
          '<button class="btn" type="button" id="shareCard">오늘 자리 카드로 저장</button>' +
          '<a class="btn ghost" href="#/journal/verify">판단 남기기</a>' +
          (badCount ? '<a class="badge red" href="#/journal">원칙 미통과 매매 ' + badCount + '건</a>' : '') +
        '</div>' +
      '</section>' +

      '<div class="score-grid">' + card('ndx', '') + card('sox', 'sox') + '</div>' +

      statusBlock() +
      priceStrip(basis, t) +

      '<div class="daily">' +
        '<div class="block">' +
          '<div class="lab"><b>② 내 자리</b>고점 대비 낙폭</div>' +
          '<div>' +
            '<p class="big-line">' + F.pct(now.dd, 1) + ' <span class="dim">· 고점 ' + F.day(now.peak_date) + ' 이후 ' + now.offset + '거래일</span></p>' +
            '<p class="sub-line">' + (matched || '닮은 사례를 계산하지 못했습니다.') + '</p>' +
            '<div style="margin-top:8px">' + myPos + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="block">' +
          '<div class="lab"><b>③ 어제까지 남긴 판단</b>최근 3건 · 채점</div>' +
          '<div>' + verHtml + '</div>' +
        '</div>' +
        '<div class="block">' +
          '<div class="lab"><b>④ 오늘 할 일</b>리밸런싱 밴드</div>' +
          '<div>' + todo + '</div>' +
        '</div>' +
      '</div>' +

      '<section class="panel">' +
        '<div class="panel-h"><h2>폭락 6사례 <span class="dim" style="font-size:12px;font-weight:400">나스닥 ^NDX</span></h2>' +
          '<span class="note">같은 눈금으로 다시 계산한 고점→저점, 그리고 지금과 가장 닮은 날 · 반도체 SOX 8사례는 매수 지표에서 SOXL을 고르면 나옵니다</span>' +
          '<span class="spacer"></span><a class="linkbtn" href="#/gauge/crash">전체 보기 →</a></div>' +
        '<div class="case-grid">' + caseCards + '</div>' +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-h"><h2>읽을거리</h2><span class="spacer"></span><a class="linkbtn" href="#/readings">전체 보기 →</a></div>' +
        '<div class="read-grid">' + reads + '</div>' +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-h"><h2>아침 메일</h2><span class="badge grey">발송은 2차</span></div>' +
        '<p class="note" style="margin-bottom:10px">매일 아침 이 화면의 네 칸을 그대로 메일로 보낼 예정입니다. 지금은 무엇을 보낼지 미리보기만 됩니다.</p>' +
        '<div class="row">' +
          '<button class="btn" type="button" id="mailPreviewBtn">메일 미리보기</button>' +
          '<button class="btn ghost" type="button" id="mailSendBtn">메일 보내기</button>' +
        '</div>' +
        '<div id="mailPreview" style="margin-top:12px"></div>' +
      '</section>' +

      '<section class="panel">' +
        '<div class="panel-h"><h2>주간 요약 메일</h2></div>' +
        '<p class="note" style="margin-bottom:10px">점수·폭락 사례·판단 채점을 한 통으로. 1차 판은 신청 폼만 있고 실제 발송은 준비 중입니다.</p>' +
        '<form id="subForm" class="row" novalidate>' +
          '<input type="email" id="subMail" placeholder="메일 주소" aria-label="메일 주소" ' +
            'style="flex:1;min-width:200px;background:var(--sunken);border:1px solid var(--line2);border-radius:9px;color:var(--tx);padding:9px 11px;font:inherit">' +
          '<button class="btn primary" type="submit">구독 신청</button>' +
        '</form>' +
        '<p class="note">신청 내용은 이 브라우저에만 남습니다(서버로 보내지 않습니다).</p>' +
      '</section>';

    el('#shareCard', view).addEventListener('click', function () { shareCard(); });

    /* 정규장 / 프리마켓 — 고른 기준을 저장하고 이 화면을 다시 그린다(매수 지표와 같은 값) */
    els('[data-basis]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        if (!w.Basis) return;
        Basis.set(b.getAttribute('data-basis'));
        V.home(liveView());
      });
    });

    /* 실시간 새로고침 — live.json 을 다시 읽어 값·기준 시각을 갱신한다(원본 HomeScreen 141행) */
    var rf = el('#homeRefresh', view);
    if (rf) rf.addEventListener('click', function () {
      if (!w.Basis) return;
      rf.disabled = true;
      rf.textContent = '불러오는 중…';
      Basis.load(true).then(function () {
        V.home(liveView());
        toast(Basis.status().hasLive ? '실시간 값을 다시 읽었습니다.' : 'live.json 이 없어 확정 종가로 남습니다.');
      });
    });

    /* 관심 종목 추가/삭제 */
    var wf = el('#watchForm', view);
    if (wf) wf.addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = el('#watchSym', view);
      var sym = (inp.value || '').trim().toUpperCase();
      if (!sym || !/^[A-Z0-9.\-]{1,12}$/.test(sym)) { toast('티커를 영문·숫자로 적어 주세요(국장은 6자리 코드).'); return; }
      /* 증시 탭과 같은 목록(watch.us·watch.kr)에 담는다 — 두 벌로 나뉘지 않게. */
      var added = w.Mkt ? Mkt.addWatch(Mkt.marketOf(sym), sym, sym) : false;
      if (!added) { var list = S.get('watch', []); if (list.indexOf(sym) < 0) { list.push(sym); S.set('watch', list); } }
      inp.value = '';
      V.home(liveView());
    });
    els('[data-unwatch]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        var sym = b.getAttribute('data-unwatch');
        if (w.Mkt) Mkt.removeWatch(Mkt.marketOf(sym), sym);
        else S.set('watch', S.get('watch', []).filter(function (x) { return x !== sym; }));
        V.home(liveView());
      });
    });

    el('#subForm', view).addEventListener('submit', function (e) {
      e.preventDefault();
      var mail = el('#subMail', view).value.trim();
      if (!mail || mail.indexOf('@') < 1) { toast('메일 주소를 확인해 주세요.'); return; }
      var subs = S.get('subscribers', []);
      subs.push({ mail: mail, at: new Date().toISOString() });
      S.set('subscribers', subs);
      el('#subMail', view).value = '';
      toast('준비 중입니다 — 메일 발송은 다음 판에서 붙입니다.');
    });

    el('#mailPreviewBtn', view).addEventListener('click', function () {
      var box = el('#mailPreview', view);
      box.innerHTML = mailPreviewHtml(pf, now, closest, ver);
      toast('미리보기입니다. 실제 발송은 2차 판입니다.');
    });

    el('#mailSendBtn', view).addEventListener('click', function () {
      var subs = S.get('subscribers', []);
      el('#mailPreview', view).innerHTML = '<div class="notice">아침 메일 발송은 2차 판입니다 — 발송 서버와 주소 확인이 먼저 필요합니다.' +
        (subs.length ? ' 지금 신청된 주소는 이 브라우저에 ' + subs.length + '건 남아 있습니다.' : '') + '</div>';
      toast('발송 기능은 2차 판으로 미뤘습니다.');
    });
  };

  /* ------------------------------------------------ 홈: 시세 상태 줄(원본 HomeScreen 90~150행) */
  function statusBlock() {
    var live = w.Basis ? Basis.status() : { hasLive: false };
    var mode = live.hasLive ? '실시간 체결가' : '종가 기준';
    var session = live.hasLive ? (live.session || '프리마켓') : '정규장';
    var at = live.hasLive ? (live.hhmm || '') : F.day(Data.asOf());
    return '<section class="panel tight" style="margin-bottom:12px">' +
      '<div class="row" style="justify-content:space-between">' +
        '<div class="row"><b class="mono" style="font-size:19px">' + (at || '아직 안 받아옴') + '</b>' +
          '<span class="badge ' + (live.hasLive ? 'live' : 'grey') + '">' + mode + '</span>' +
          '<span class="badge grey">' + esc(session) + '</span></div>' +
        '<button class="btn primary sm" type="button" id="homeRefresh">실시간 새로고침</button>' +
      '</div>' +
      '<p class="note">갱신 ' + (at || '—') + ' · ' + esc(session) + ' · ' +
        (live.hasLive ? '여섯 지표 가중 평균' : '마지막 확정 봉 기준') + '</p>' +
      '<p class="note">실시간이 주 수단입니다. 확정 스냅샷(JSON)은 인터넷이 없거나 실시간이 막힐 때 쓰는 보조 수단입니다.</p>' +
    '</section>';
  }

  /* ------------------------------------------------ 홈: 내 종목 시세 }/>
  /* 보유 + 관심 종목 가격을 고른 기준으로 보여 준다. 색은 앱 규칙(국내 상승 빨강·하락 파랑 / 미국 상승 초록·하락 빨강). */
  function priceStrip(basis, t) {
    var syms = [];
    function add(s, mkt) {
      s = String(s || '').trim().toUpperCase();
      if (!s || s === 'CASH') return;
      if (syms.some(function (x) { return x.sym === s; })) return;
      syms.push({ sym: s, mkt: mkt || (/^\d{6}$/.test(s) ? 'kr' : 'us') });
    }
    mktHoldings('us').forEach(function (r) { add(r.sym, 'us'); });
    mktHoldings('kr').forEach(function (r) { add(r.sym, 'kr'); });
    var watch = watchSymbols();
    watch.forEach(function (s) { add(s); });

    if (!syms.length) {
      return '<section class="panel tight" style="margin-bottom:12px">' +
        '<div class="panel-h"><h2>내 종목 시세</h2><span class="note">보유·관심 종목 가격</span></div>' +
        '<p class="note">종목을 추가하면 가격이 표시됩니다. <a href="#/rebalance">리밸런싱에서 보유 넣기 →</a></p>' +
        '<form id="watchForm" class="row" style="margin-top:8px">' +
          '<input id="watchSym" placeholder="관심 티커 (예: NVDA, 005930)" aria-label="관심 티커" ' +
            'style="flex:1;min-width:160px;background:var(--sunken,#0d1428);border:1px solid var(--line2);border-radius:9px;color:var(--tx);padding:8px 10px;font:inherit">' +
          '<button class="btn sm" type="submit">추가</button>' +
        '</form></section>';
    }

    function snapClose(sym) {
      if (sym === 'TQQQ') return t.ndx.detail.close;
      if (sym === 'SOXL') return t.sox.detail.close;
      return null;
    }

    var rows = syms.map(function (x) {
      var sym = x.sym, kr = x.mkt === 'kr';
      var px = null, chg = null, tag = '값 없음', name = '';
      if (kr) {
        var kl = krLiveInfo(sym);
        var mq = (w.Mkt && Mkt.ready) ? Mkt.quote(sym) : null;
        if (kl) {
          px = kl.price; chg = kl.chg; name = kl.name || '';
          tag = kl.src + (kl.at ? ' ' + kl.at : '');
        } else if (mq) {
          px = mq.regPrice; chg = mq.regChg; name = mq.name || '';
          tag = '증시 스냅샷 ' + (w.Mkt.time ? Mkt.time(mq.snapAt) : '');
        } else {
          tag = '값 없음(국장)';
        }
      } else {
        var q = w.Basis ? Basis.quote(sym) : null;
        var closePx = (q && (q.close || q.prevClose)) || snapClose(sym);
        var useLive = basis === 'live' && q;
        px = useLive ? q.price : closePx;
        chg = useLive ? q.changePct : null;
        tag = useLive
          ? ((q.session || '최근 체결') + ' ' + (q.hhmm || ''))
          : (closePx ? '종가' : '값 없음');
        var le = liveSymEntry(sym);
        name = (le && le.name) || '';
      }
      var color = 'var(--tx2)';
      if (chg !== null && chg !== undefined) {
        color = chg > 0 ? (kr ? 'var(--red)' : 'var(--green)') : chg < 0 ? (kr ? 'var(--blue)' : 'var(--red)') : 'var(--tx2)';
      }
      var pxTxt = px === null || px === undefined ? '—'
        : (kr ? Math.round(px).toLocaleString('ko-KR') + '원'
          : '$' + (px >= 1000 ? px.toFixed(0) : px.toFixed(2)));
      return '<tr><td><b>' + esc(sym) + '</b>' + (kr ? ' <span class="dim small">국장</span>' : '') +
          (watch.indexOf(sym) >= 0 || watch.indexOf(sym + '.KS') >= 0
            ? ' <button class="linkbtn del" type="button" data-unwatch="' + esc(sym) + '" aria-label="관심 종목에서 지우기">×</button>' : '') +
          (name ? '<div class="dim small" style="font-weight:400">' + esc(name) + '</div>' : '') + '</td>' +
        '<td class="mono" style="color:' + (px ? 'var(--green)' : 'var(--dim)') + '">' + pxTxt + '</td>' +
        '<td class="mono" style="color:' + color + '">' + (chg === null || chg === undefined ? '—' : F.signed(chg, 2) + '%') + '</td>' +
        '<td class="dim small">' + esc(tag) + '</td></tr>';
    }).join('');

    return '<section class="panel tight" style="margin-bottom:12px">' +
      '<div class="panel-h"><h2>내 종목 시세</h2><span class="note">' +
        (basis === 'live' ? '프리마켓(최근 체결) 기준' : '정규장 종가 기준') + ' · 5분 갱신</span></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>종목</th><th>가격</th><th>등락</th><th>기준</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>' +
      '<p class="note">가격은 연두색으로 표시합니다. 등락 색은 앱 규칙입니다 — 국내는 상승 빨강·하락 파랑, 미국은 상승 초록·하락 빨강. ' +
        '값이 없는 종목은 ‘—’로 두고 지어내지 않습니다.</p>' +
      '<form id="watchForm" class="row" style="margin-top:8px">' +
        '<input id="watchSym" placeholder="관심 티커 추가 (예: NVDA, 005930)" aria-label="관심 티커" ' +
          'style="flex:1;min-width:160px;background:var(--sunken,#0d1428);border:1px solid var(--line2);border-radius:9px;color:var(--tx);padding:8px 10px;font:inherit">' +
        '<button class="btn sm" type="submit">추가</button>' +
      '</form></section>';
  }

  /* 아침 메일 미리보기 — 오늘 화면의 네 칸을 메일 모양으로 */
  function mailPreviewHtml(pf, now, closest, ver) {
    var t = Data.scores.targets;
    var lines = '<p style="margin:0 0 4px;color:#9aa5b6;font-size:12px">스톡 리밸런싱 · Stock Rebalancing · ' + F.day(F.today()) + ' 아침</p>';
    var out = '<div style="border:1px solid var(--line2);border-radius:12px;overflow:hidden;background:var(--sunken)">' +
      '<div style="padding:14px 16px;background:#2b3342;border-bottom:1px solid var(--line)">' + lines +
        '<b style="font-size:15px">오늘의 네 칸</b></div><div style="padding:14px 16px">';
    out += '<p style="margin:0 0 6px"><b>① 두 점수</b> — TQQQ ' + F.num(t.ndx.score) + ' (' + esc(t.ndx.verdict.label) + ') · SOXL ' +
      F.num(t.sox.score) + ' (' + esc(t.sox.verdict.label) + ')</p>';
    out += '<p style="margin:0 0 6px"><b>② 내 자리</b> — 고점 대비 ' + F.pct(now.dd, 1) + ', 고점 ' + F.day(now.peak_date) + ' 이후 ' + now.offset + '거래일. ' +
      (closest ? '가장 닮은 날 ' + esc(closest.short) + ' ' + F.day(closest.now_match.date) + ' → 그 뒤 30거래일 ' + F.pct(closest.now_match.fwd30, 1) + '.' : '') + '</p>';
    if (pf) {
      out += '<p style="margin:0 0 6px"><b>내 계좌</b> — 총 ' + F.int(pf.totalValue) + '원' +
        (pf.rate ? ' (환율 ' + F.int(pf.rate) + '원 기준, 미국장 환산)' : ' (환율 값 없음 — 국장만)') +
        ', 평가손익 ' + F.signed(pf.pl, 0) + '원, 밴드 이탈 ' + pf.out + '종목.</p>';
    } else {
      out += '<p style="margin:0 0 6px"><b>내 계좌</b> — 보유 입력이 없습니다.</p>';
    }
    out += '<p style="margin:0 0 6px"><b>③ 어제까지 남긴 판단</b> — ' +
      (ver.length ? ver.slice(0, 3).map(function (v) {
        return F.day(v.r.date) + ' ' + esc(v.r.call) + ' ' + (v.ret === null ? '대기' : GRADE_TEXT[v.grade]);
      }).join(' · ') : '없음') + '</p>';
    out += '<p style="margin:0 0 0"><b>④ 오늘 할 일</b> — ' + (pf ? (pf.out ? pf.out + '종목 밴드 이탈, 표에서 수량 확인' : '오늘은 없음') : '보유를 먼저 넣어 주세요') + '</p>';
    out += '</div><div style="padding:10px 16px;border-top:1px solid var(--line);color:#9aa5b6;font-size:11px">' +
      '정보 제공·복기 목적. 매수·매도 추천이 아닙니다. 기준일 ' + F.day(Data.asOf()) + ' 종가 · 글 Verdictjang</div></div>';
    return out;
  }

  /* ------------------------------------------------------------ 공유 카드 (canvas → PNG) */
  function roundRect(x, c, rx, ry, wd, ht, r) {
    c.beginPath();
    c.moveTo(rx + r, ry);
    c.lineTo(rx + wd - r, ry);
    c.quadraticCurveTo(rx + wd, ry, rx + wd, ry + r);
    c.lineTo(rx + wd, ry + ht - r);
    c.quadraticCurveTo(rx + wd, ry + ht, rx + wd - r, ry + ht);
    c.lineTo(rx + r, ry + ht);
    c.quadraticCurveTo(rx, ry + ht, rx, ry + ht - r);
    c.lineTo(rx, ry + r);
    c.quadraticCurveTo(rx, ry, rx + r, ry);
    c.closePath();
  }

  function shareCard() {
    var W = 1200, H = 630;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var t = Data.scores.targets, now = Data.now(), closest = Data.closestCase();
    var KR = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

    var g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2b3342'); g.addColorStop(0.55, '#1b202a'); g.addColorStop(1, '#212a37');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    c.strokeStyle = '#3a4351'; c.lineWidth = 2;
    c.strokeRect(28, 28, W - 56, H - 56);

    c.fillStyle = '#e8ecf4';
    c.font = '700 40px ' + KR;
    c.fillText('스톡 리밸런싱', 72, 108);
    c.fillStyle = '#949fb1';
    c.font = '600 20px ' + KR;
    c.fillText('STOCK REBALANCING', 74, 140);

    c.textAlign = 'right';
    c.fillStyle = '#b3bdcb';
    c.font = '500 20px ' + KR;
    c.fillText(F.day(F.today()), W - 76, 108);
    c.fillStyle = '#949fb1';
    c.font = '400 15px ' + KR;
    c.fillText('기준일 ' + F.day(Data.asOf()) + ' 종가 · 지연 데이터', W - 76, 138);
    c.textAlign = 'left';

    function panel(x, y, wd, ht, key, color) {
      c.fillStyle = 'rgba(37,44,58,.8)';
      roundRect(c, c, x, y, wd, ht, 18); c.fill();
      c.strokeStyle = '#4c5668'; c.lineWidth = 1.5;
      roundRect(c, c, x, y, wd, ht, 18); c.stroke();
      c.fillStyle = color;
      roundRect(c, c, x, y + 22, 5, ht - 44, 3); c.fill();

      var s = t[key];
      c.fillStyle = '#b3bdcb';
      c.font = '600 22px ' + KR;
      c.fillText(s.symbol + ' · ' + s.label, x + 30, y + 44);
      c.fillStyle = '#e8ecf4';
      c.font = '800 78px ' + KR;
      var numText = F.num(s.score);
      c.fillText(numText, x + 28, y + 132);
      var numW = c.measureText(numText).width;
      c.fillStyle = '#949fb1';
      c.font = '500 22px ' + KR;
      c.fillText('/ 100', x + 28 + numW + 14, y + 132);
      c.fillStyle = color;
      c.font = '700 24px ' + KR;
      c.fillText(s.verdict.label, x + 30, y + 172);
      c.fillStyle = '#9aa5b6';
      c.font = '400 17px ' + KR;
      c.fillText(s.verdict.sub, x + 30, y + 200);
    }
    panel(72, 180, 500, 220, 'ndx', '#6a9ae0');
    panel(628, 180, 500, 220, 'sox', '#43b795');

    c.fillStyle = '#e8ecf4';
    c.font = '700 27px ' + KR;
    c.fillText('고점 대비 ' + F.pct(now.dd, 1) + '  ·  고점 ' + F.day(now.peak_date) + ' 이후 ' + now.offset + '거래일', 74, 462);

    if (closest) {
      var m = closest.now_match;
      c.fillStyle = '#9aa5b6';
      c.font = '400 19px ' + KR;
      c.fillText('가장 닮은 사례  ' + closest.short + ' ' + F.day(m.date) + ' (고점 +' + m.day + '거래일)  →  그 뒤 30거래일 ' + F.pct(m.fwd30, 1), 74, 498);
    }

    c.fillStyle = '#7c8798';
    c.font = '400 15px ' + KR;
    c.fillText('정보 제공·복기 목적. 매수·매도 추천이 아닙니다.  여섯 지표는 원본 앱(v2.7.0) 식 그대로 계산했습니다.', 74, 566);

    try {
      var a = document.createElement('a');
      a.href = cv.toDataURL('image/png');
      a.download = '오늘자리-' + F.today() + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('공유 카드를 저장했습니다 — 오늘자리-' + F.today() + '.png');
    } catch (e) {
      toast('카드를 만들지 못했습니다(브라우저 제한).');
    }
  }

  /* ------------------------------------------------------------ 점수 상세 */
  /* 반도체 2단계 브레이크 — 점수 상세(#/score/sox)에서도 매수 지표와 같은 값·같은 판정을 보여 준다.
     값은 data/crashes_sox.json(실제 ^SOX 일봉 계산). 형식은 이 화면의 다른 패널과 같은 panel·kv·tbl. */
  function soxBrakePanel() {
    var b = (w.Data && Data.brake) ? Data.brake('sox') : null;
    if (!b) return '';
    var n = Data.nowFor('sox');
    var bt = Data.backtest('sox');
    function row(name, cell) {
      return '<tr><td>' + name + '</td>' +
        '<td class="mono">' + cell.n + (cell.done !== null && cell.done !== undefined && cell.done !== cell.n ? '<div class="dim small">완결 ' + cell.done + '</div>' : '') + '</td>' +
        '<td class="mono ' + (cell.mean === null ? 'dim' : (cell.mean < 0 ? 'neg' : 'pos')) + '">' + (cell.mean === null ? '—' : F.pct(cell.mean, 2)) + '</td>' +
        '<td class="mono">' + (cell.win === null ? '—' : F.num(cell.win, 1) + '%') + '</td></tr>';
    }
    var A = bt.filterA['213'], B = bt.filterB['213'], P = bt.plain['213'];
    return '<div class="panel">' +
      '<div class="panel-h"><h2>2단계 · 업황·금리 브레이크</h2>' +
        '<span class="badge ' + (b.pass ? 'good' : 'amber') + '">' + (b.pass ? '조건 충족' : '경보 유지') + '</span></div>' +
      '<dl class="kv">' +
        '<div><dt>① SOX 고점 대비 낙폭</dt><dd class="neg">' + F.pct(b.dd, 1) + ' <small>' + (b.band ? '바닥권 −35~−53%' : '바닥권 아님') + '</small></dd></div>' +
        '<div><dt>② 하락 경과</dt><dd>' + F.num(b.months, 1) + '개월 <small>' + (b.dur_ok ? '8~14개월 구간' : '보고서 기준 8~14개월 전') + '</small></dd></div>' +
        '<div><dt>SOX 고점 → 지금</dt><dd>' + F.day(n.peak_date) + ' ' + F.fixed(n.peak_close, 2) + ' → ' + F.fixed(n.close, 2) + '</dd></div>' +
        '<div><dt>SOX 저점</dt><dd>' + F.day(n.trough) + ' ' + F.fixed(n.trough_close, 2) + ' <small>' + F.pct(n.dd_trough, 1) + '</small></dd></div>' +
      '</dl>' +
      '<p class="note">③ 반도체 90점은 매수 신호가 아닌 경보입니다 — +21거래일 평균 +8.68% · 승률 59.1%(전체 거래일 58.9%와 유사). 금리 방향과 업황을 함께 보세요. ' +
        '점수는 원강 님 앱 계산식 그대로이고, 이 브레이크는 그 위에 얹어 90점을 넘어도 판정을 경보로 내립니다.</p>' +
      '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl wrap1" style="table-layout:fixed;width:100%"><colgroup><col style="width:40%"><col style="width:20%"><col style="width:22%"><col style="width:18%"></colgroup><thead><tr><th>구간</th><th>건수</th><th>+21일 평균</th><th>승률</th></tr></thead><tbody>' +
        row('90점 단독 <span class="dim small">— 보고서(2026-11-20)</span>', { n: 24, done: 22, mean: 8.68, win: 59.1 }) +
        row('90점 단독 <span class="dim small">— 이 사이트 재계산</span>', P) +
        row('필터 A · 90점 + SOX −35% 이상 하락', A) +
        row('필터 B · 필터 A + 하락 6개월 이상', B) +
        row('전체 거래일 <span class="dim small">— 아무 날이나 산 경우</span>', { n: bt.all_days.n, done: bt.all_days.n, mean: bt.all_days.mean, win: bt.all_days.win }) +
      '</tbody></table></div>' +
      '<p class="note">필터 A는 ' + A.n + '건(완결 ' + A.done + '건)만 남아 <b>참고용</b>입니다. 그래도 +21거래일 평균 ' + F.pct(P.mean, 2) + ' → ' + F.pct(A.mean, 2) + ', 승률 ' + F.num(P.win, 1) + '% → ' + F.num(A.win, 1) + '%로 방향은 개선됩니다. ' +
        '자세한 계산식·걸러진 날은 <a href="#/gauge">매수 지표 → 반도체 SOXL</a>에 있습니다.</p>' +
      '</div>';
  }

  V.score = function (view, arg) {
    if (arg === 'ndx' || arg === 'sox') scoreTab = arg;
    var s = Data.scores.targets[scoreTab];
    var weights = s.rows.reduce(function (a, r) { return a + r.weight; }, 0);
    var contrib = s.rows.reduce(function (a, r) { return a + r.contribution; }, 0);
    var d = s.detail;

    var ladder = [
      { lv: 90, t: '90 이상', a: '계획의 50% 투입', sub: '1년에 한 번 수준으로 오는 자리입니다' },
      { lv: 80, t: '80 ~ 90', a: '계획의 25% 투입', sub: '1차 진입 자리입니다' },
      { lv: 70, t: '70 ~ 80', a: '계획의 25% 투입', sub: '바닥의 시작 구간입니다' },
      { lv: 50, t: '50 ~ 70', a: '관망', sub: '조정은 맞지만 아직 아닙니다' },
      { lv: 0, t: '50 미만', a: '신규 매수 아님', sub: '아직 바닥 자리가 아닙니다' }
    ];
    var ladderHtml = ladder.map(function (x) {
      var on = s.verdict.level === x.lv;
      return '<div class="row" style="gap:10px;padding:7px 10px;border-radius:9px;' +
        (on ? 'background:#2c3a52;border:1px solid #4a6b96' : 'border:1px solid transparent') + '">' +
        '<span class="badge ' + (on ? 'blue' : 'grey') + '" style="min-width:78px;justify-content:center">' + x.t + '</span>' +
        '<b style="font-size:13.5px">' + x.a + '</b><span class="dim small">' + x.sub + '</span></div>';
    }).join('');

    var rows = s.rows.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td>' +
        '<td class="mono">' + esc(r.raw_display) + esc(r.unit) + '</td>' +
        '<td class="mono">' + F.num(r.converted) + '</td>' +
        '<td class="mono dim">' + F.fixed(r.weight, 2) + '</td>' +
        '<td class="mono">' + F.fixed(r.contribution, 2) + '</td></tr>';
    }).join('');

    var maxDiff = 0;
    var ver = (Data.scores.verify_app_vs_calc || []).map(function (c2) {
      var d1 = Math.abs((c2.app[0] || 0) - (c2.calc[0] || 0));
      var d2 = Math.abs((c2.app[1] || 0) - (c2.calc[1] || 0));
      var diff = Math.max(d1, d2);
      maxDiff = Math.max(maxDiff, diff);
      var cls = diff <= 0.05 ? 'good' : diff <= 0.3 ? 'blue' : 'red';
      var label = diff <= 0.05 ? '일치' : diff <= 0.3 ? '근사 (±' + F.num(diff, 1) + ')' : '다름 (' + F.num(diff, 1) + ')';
      return '<tr><td class="mono">' + F.day(c2.date) + '</td><td class="mono">' + F.num(c2.app[0]) + ' / ' + F.num(c2.app[1]) +
        '</td><td class="mono">' + F.num(c2.calc[0]) + ' / ' + F.num(c2.calc[1]) + '</td><td>' +
        '<span class="badge ' + cls + '">' + label + '</span></td></tr>';
    }).join('');

    view.innerHTML =
      '<section class="hero"><div class="crumb"><a href="#/">홈</a> / 점수 상세</div>' +
        '<h1>' + esc(s.label) + ' <span class="dim" style="font-size:14px">' + esc(s.symbol) + '</span></h1>' +
        '<p>기준일 ' + F.day(s.as_of) + ' 종가 · 여섯 지표를 0~100으로 환산해 가중 평균</p></section>' +

      '<div class="panel">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start">' +
          '<div><div class="score-big">' + F.num(s.score) + '<small>/ 100</small></div>' +
            '<div class="verdict"><b>' + esc(s.verdict.label) + '</b><span>' + esc(s.verdict.sub) + '</span></div></div>' +
          '<div class="tabs">' +
            '<button class="chip ' + (scoreTab === 'ndx' ? 'on' : '') + '" data-tab="ndx">TQQQ · 나스닥</button>' +
            '<button class="chip ' + (scoreTab === 'sox' ? 'on' : '') + '" data-tab="sox">SOXL · 반도체</button>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:14px">' + ladderHtml + '</div>' +
      '</div>' +

      (scoreTab === 'sox' ? soxBrakePanel() : '') +

      '<div class="panel">' +
        '<div class="panel-h"><h2>지표 여섯</h2><span class="note">값 → 변환값(0~100) → 기여도(변환값 × 가중치)</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>지표</th><th>값</th><th>변환값</th><th>가중치</th><th>기여도</th>' +
        '</tr></thead><tbody>' + rows +
        '<tr class="sum"><td>합</td><td>—</td><td>—</td><td class="mono">' + F.fixed(weights, 2) + '</td><td class="mono">' + F.fixed(contrib, 2) + '</td></tr>' +
        '</tbody></table></div>' +
        '<p class="note">기여도 합 ÷ 가중치 합 = ' + F.fixed(contrib, 2) + ' ÷ ' + F.fixed(weights, 2) + ' = ' + F.fixed(contrib / weights, 2) +
          ' → 소수 1자리 반올림 <b>' + F.num(s.score) + '</b>. 값이 없는 지표는 빼고 남은 가중치 합으로 나눕니다. 0~100을 벗어난 값은 잘라 냅니다.</p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>계산에 쓴 자료</h2></div>' +
        '<dl class="kv">' +
          '<div><dt>종가</dt><dd>' + F.fixed(d.close, 2) + '</dd></div>' +
          '<div><dt>5년 최고 종가</dt><dd>' + F.fixed(d.peak, 2) + ' <small>' + F.day(d.peak_date) + '</small></dd></div>' +
          '<div><dt>200일선</dt><dd>' + F.fixed(d.ma200, 2) + '</dd></div>' +
          '<div><dt>VIX</dt><dd>' + F.fixed(d.vix, 2) + '</dd></div>' +
          '<div><dt>VIX 50일 평균</dt><dd>' + F.fixed(d.ma50_vix, 2) + '</dd></div>' +
          '<div><dt>VIX 백분위 표본</dt><dd>' + d.vix_samples + ' <small>거래일</small></dd></div>' +
        '</dl>' +
        '<p class="note">TQQQ·SOXL·VIX 일봉(2026-11-20까지)에서 계산했습니다. 낙폭의 최고점 창은 5년(1260거래일), 200일선은 200거래일 평균, RSI는 와일더 14입니다.</p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>점수 이력</h2>' +
          '<div class="tabs" style="margin-left:auto">' +
            '<button class="chip on" data-hist="daily">일별(최근 400거래일)</button>' +
            '<button class="chip" data-hist="weekly">주별(전체)</button>' +
          '</div></div>' +
        '<div class="legend"><span><i style="background:#6a9ae0"></i>TQQQ · 나스닥</span><span><i style="background:#43b795"></i>SOXL · 반도체</span></div>' +
        '<div class="chart-box" id="histChart"></div>' +
        '<p class="note" id="histNote"></p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>원본 앱 값과 대조</h2><span class="note">원본 앱이 남긴 점수(gauge_scores.json)와 이 사이트 계산값</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>날짜</th><th>원본 앱 (TQQQ / SOXL)</th><th>이 사이트 계산</th><th>판정</th></tr></thead>' +
        '<tbody>' + ver + '</tbody></table></div>' +
        '<p class="note">가장 큰 차이 ' + F.num(maxDiff, 2) + '점. 원본 앱이 저장해 둔 점수와 같은 식·같은 일봉으로 다시 계산한 값입니다. ' +
          '주간 RSI의 마지막 주 처리와 VIX 창의 미세한 차이로 0.1~0.2점 어긋날 수 있어 ±0.3점 안은 <b>근사</b>로 표시했습니다.</p>' +
      '</div>';

    on(view, 'click', '[data-tab]', function (e, t) {
      scoreTab = t.getAttribute('data-tab');
      V.score(liveView(), scoreTab);
    });

    var histMode = 'daily';
    function drawHist() {
      var src = histMode === 'daily' ? Data.scores.history.daily : Data.scores.history.weekly;
      var ndx = [], sox = [];
      src.forEach(function (r, i) { ndx.push([i, r[1]]); sox.push([i, r[2]]); });
      var ticks = [];
      var n = src.length;
      [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1].forEach(function (i) {
        if (i >= 0 && i < n) ticks.push({ x: i, label: F.day(src[i][0]).slice(2) });
      });
      Charts.line(el('#histChart', view), {
        height: 240,
        series: [
          { name: 'TQQQ', color: '#6a9ae0', points: ndx, width: 1.7 },
          { name: 'SOXL', color: '#43b795', points: sox, width: 1.7 }
        ],
        xMin: 0, xMax: n - 1, yMin: 0, yMax: 100,
        yTicks: [0, 25, 50, 70, 80, 90, 100],
        xTicks: ticks,
        hlines: [
          { y: 90, color: '#3f8168', label: '90', dash: '4 4' },
          { y: 70, color: '#525c6e' },
          { y: 50, color: '#525c6e' }
        ],
        markers: [
          { x: n - 1, y: src[n - 1][1], color: '#6a9ae0', r: 3 },
          { x: n - 1, y: src[n - 1][2], color: '#43b795', r: 3 }
        ]
      });
      el('#histNote', view).textContent = histMode === 'daily'
        ? '최근 400거래일 일별 점수. 마지막 점 ' + F.day(src[n - 1][0]) + ' — TQQQ ' + F.num(src[n - 1][1]) + ', SOXL ' + F.num(src[n - 1][2])
        : '전체 기간(2011~) 주별 최고 점수. 주마다 그 주의 가장 높은 값 하나.';
      els(view, '[data-hist]').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-hist') === histMode);
      });
    }
    on(view, 'click', '[data-hist]', function (e, t) {
      histMode = t.getAttribute('data-hist');
      drawHist();
    });
    drawHist();
  };

  /* ------------------------------------------------------------ 폭락 사례 목록 */
  /* 나열은 시간 순 하나(고점 날짜 오래된 것 → 최신). 정렬 토글은 두지 않는다(무아 님 2026-11-28). */
  V.crash = function (view) {
    var now = Data.now();
    var cases = Data.crashes.cases.slice().sort(function (a, b) { return a.peak < b.peak ? -1 : (a.peak > b.peak ? 1 : 0); });

    var rows = cases.map(function (c) {
      var m = c.now_match;
      return '<tr data-case="' + c.id + '" style="cursor:pointer">' +
        '<td><b style="color:' + c.color + '">■</b> ' + esc(c.name) + '<div class="dim small">' + esc(c.tag) + ' · ' + esc(c.index) + '</div></td>' +
        '<td class="mono">' + F.day(c.peak) + '<div class="dim small">' + F.fixed(c.peak_close, 2) + '</div></td>' +
        '<td class="mono">' + F.day(c.trough) + '<div class="dim small">' + F.fixed(c.trough_close, 2) + '</div></td>' +
        '<td class="mono neg">' + F.pct(c.dd, 1) + '</td>' +
        '<td class="mono">' + F.int(c.days_to_trough) + '</td>' +
        '<td class="mono">' + F.int(c.days_to_recovery) + '</td>' +
        '<td class="mono">' + (m ? esc(c.name) + ' · ' + F.day(m.date) + '<div class="dim small">고점 +' + m.day + '일 · 낙폭 ' + F.pct(m.dd, 1) + '</div>' : '—') + '</td>' +
        '<td class="mono">' + (m ? F.num(m.distance, 2) : '—') + '</td>' +
        '<td class="mono ' + (m && m.fwd30 !== null && m.fwd30 < 0 ? 'neg' : 'pos') + '">' + (m ? F.pct(m.fwd30, 1) : '—') + '</td>' +
        '</tr>';
    }).join('');

    view.innerHTML =
      '<section class="hero"><div class="crumb"><a href="#/">홈</a> / 폭락 사례</div>' +
        '<h1>폭락 6사례</h1>' +
        '<p>고점 종가를 0%로 두고 다시 계산한 경로. 지금 지표와 가장 닮은 날을 사례마다 하나씩 뽑았습니다.</p></section>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>지금 위치</h2><span class="note">' + esc(now.source) + ' · ' + F.day(now.as_of) + '</span></div>' +
        '<dl class="kv">' +
          '<div><dt>지수 종가</dt><dd>' + F.fixed(now.close, 2) + '</dd></div>' +
          '<div><dt>고점 대비 낙폭</dt><dd class="neg">' + F.pct(now.dd, 2) + '</dd></div>' +
          '<div><dt>고점 · 경과</dt><dd>' + F.day(now.peak_date) + ' <small>' + now.offset + '거래일</small></dd></div>' +
          '<div><dt>200일선 이격</dt><dd>' + F.pct(now.gap, 2) + '</dd></div>' +
          '<div><dt>일간 RSI(14)</dt><dd>' + F.num(now.rsi) + '</dd></div>' +
          '<div><dt>VIX / 50일 평균</dt><dd>' + F.fixed(now.vix, 2) + ' <small>' + F.num(now.vix_ratio, 2) + '배 · 1년 ' + F.num(now.vix_pct, 1) + '%</small></dd></div>' +
        '</dl>' +
        '<p class="note">' + esc(now.window_note) + '</p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>사례 표</h2><span class="note">고점 날짜 시간 순</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>사례</th><th>고점</th><th>저점</th><th>낙폭</th><th>저점까지</th><th>회복까지</th>' +
          '<th>그 사례와 닮은 날</th><th>거리</th><th>그 뒤 30일</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="note">각 사례 안에서 현재와 지표가 가장 가까운 하루를 골랐습니다. 거리 = 네 지표(낙폭·200일선·RSI·VIX)의 차이를 각 10눈금으로 나눈 평균. 작을수록 닮았습니다. VIX가 없던 1929·1987은 세 지표로만 계산합니다. 표의 줄을 누르면 사례로 들어갑니다.</p>' +
      '</div>' +

      '<div class="case-grid">' + cases.map(function (c) {
        return '<a class="case-card" href="#/crash/' + c.id + '" style="border-left-color:' + c.color + '">' +
          '<div class="top"><span class="nm">' + esc(c.short) + '</span><span class="dd">' + F.pct(c.dd, 1) + '</span></div>' +
          '<div class="meta">' + esc(c.name) + '</div>' +
          '<div class="meta">' + F.day(c.peak) + ' → ' + F.day(c.trough) + ' · ' + F.int(c.days_to_trough) + '거래일</div>' +
          '</a>';
      }).join('') + '</div>';

    on(view, 'click', 'tr[data-case]', function (e, t) {
      location.hash = '#/crash/' + t.getAttribute('data-case');
    });
  };

  /* ------------------------------------------------------------ 폭락 사례 상세 */
  V.crashDetail = function (view, id) {
    var c = Data.caseById(id);
    if (!c) { view.innerHTML = '<div class="empty">없는 사례입니다. <a href="#/crash">목록으로</a></div>'; return; }
    var cases = Data.crashes.cases;
    var idx = cases.indexOf(c);
    var prev = cases[(idx - 1 + cases.length) % cases.length];
    var next = cases[(idx + 1) % cases.length];
    var m = c.now_match;

    function metric(label, v, unit, digits) {
      return '<div><dt>' + label + '</dt><dd>' + (v === null || v === undefined ? '—' : F.fixed(v, digits === undefined ? 2 : digits)) +
        (v === null || v === undefined ? '' : (unit || '')) + '</dd></div>';
    }

    var pointRows = '';
    if (c.path && c.path.length) {
      var picks = [0, 5, 10, 22, 30, 45, 60, 90, 120, 180, 252];
      pointRows = picks.map(function (d) {
        var p = null;
        for (var i = 0; i < c.path.length; i++) {
          if (Math.abs(c.path[i][0] - d) <= 1.5) { p = c.path[i]; }
        }
        return '<tr><td class="mono">+' + d + '</td><td class="mono">' + (p ? F.pct(p[1], 2) : '—') + '</td></tr>';
      }).join('');
    }

    view.innerHTML =
      '<section class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/crash">폭락 사례</a> / ' + esc(c.short) + '</div>' +
        '<h1 style="color:' + c.color + '">' + esc(c.name) + '</h1>' +
        '<p>' + esc(c.tag) + ' · ' + esc(c.index) + ' 기준 · 고점 ' + F.day(c.peak) + ' (' + F.fixed(c.peak_close, 2) + ') → 저점 ' +
          F.day(c.trough) + ' (' + F.fixed(c.trough_close, 2) + ')</p></section>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>경로</h2>' +
          '<div class="tabs" style="margin-left:auto">' +
            '<button class="chip ' + (crashScale === 'peak' ? 'on' : '') + '" data-scale="peak">고점 기준</button>' +
            '<button class="chip ' + (crashScale === 'trough' ? 'on' : '') + '" data-scale="trough">저점 기준</button>' +
          '</div></div>' +
        '<div class="chart-box" id="caseChart"></div>' +
        '<p class="note" id="caseNote"></p>' +
      '</div>' +

      '<div class="grid g2">' +
        '<div class="panel">' +
          '<div class="panel-h"><h2>사례 값</h2></div>' +
          '<dl class="kv">' +
            metric('최대 낙폭', c.dd, '%', 1) +
            metric('저점까지', c.days_to_trough, '거래일', 0) +
            metric('전고점 회복까지', c.days_to_recovery, '거래일', 0) +
            '<div><dt>최악의 하루</dt><dd style="font-size:13px">' + esc(c.worst || '—') + '</dd></div>' +
            '<div><dt>90점 첫 돌파</dt><dd style="font-size:13px">' + esc(c.first90 || '—') + '</dd></div>' +
            metric('고점 당시 점수', c.peak_score, '점', 0) +
            metric('저점 당시 점수', c.trough_score, '점', 0) +
          '</dl>' +
        '</div>' +
        '<div class="panel">' +
          '<div class="panel-h"><h2>고점 당시 지표</h2></div>' +
          '<dl class="kv">' +
            metric('RSI(14)', c.peak_rsi, '', 1) +
            metric('200일선 이격', c.peak_gap, '%', 1) +
            metric('VIX', c.peak_vix, '', 2) +
            metric('20일 실현변동성', c.peak_vol, '%', 1) +
            metric('CAPE', c.peak_cape, '', 2) +
            metric('미 10년 금리', c.peak_10y, '%', 2) +
          '</dl>' +
          '<p class="note">비어 있는 값(—)은 원본에 그 값이 없는 것입니다. 지어내지 않았습니다.</p>' +
        '</div>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>그 사례와 닮은 날</h2>' +
          (m ? '<span class="badge blue">거리 ' + F.num(m.distance, 2) + '</span>' : '') + '</div>' +
        (m ?
          '<p class="sub-line">' + F.day(m.date) + ' (고점 +' + m.day + '거래일) · 낙폭 ' + F.pct(m.dd, 1) +
            ' · 200일선 ' + F.pct(m.gap, 1) + ' · RSI ' + F.num(m.rsi) + ' · VIX ' + F.num(m.vix, 2) + '</p>' +
          '<dl class="kv" style="margin-top:12px">' +
            '<div><dt>그 날 이후 30거래일</dt><dd class="' + (m.fwd30 !== null && m.fwd30 < 0 ? 'neg' : 'pos') + '">' + F.pct(m.fwd30, 1) + '</dd></div>' +
            '<div><dt>90거래일</dt><dd class="' + (m.fwd90 !== null && m.fwd90 < 0 ? 'neg' : 'pos') + '">' + F.pct(m.fwd90, 1) + '</dd></div>' +
            '<div><dt>180거래일</dt><dd class="' + (m.fwd180 !== null && m.fwd180 < 0 ? 'neg' : 'pos') + '">' + F.pct(m.fwd180, 1) + '</dd></div>' +
          '</dl>' +
          '<p class="sub-line" style="margin-top:10px">같은 경과일(지금 = 고점 +' + Data.now().offset + '거래일)에서 이 사례의 낙폭은 ' +
            (c.sameDay === null || c.sameDay === undefined ? '—' : F.pct(c.sameDay, 1)) + ' 입니다.</p>' +
          '<div class="row" style="margin-top:12px"><button class="btn" type="button" id="jumpAnalog">이 날을 과거 대입에서 보기 →</button></div>' +
          '<div class="notice" style="margin-top:10px"><b>닮은 지점은 \'그때 이랬다\'만 알려줍니다.</b> ' +
            '\'그래서 그다음에 왜 그렇게 됐는지\'는 알려주지 않습니다.' +
            (m.metricsUsed < 4 ? '<div class="dim small" style="margin-top:4px">이 사례는 원본 자료에 VIX가 없어 <b>세 지표로만</b> 거리를 쟀습니다.</div>' : '') +
          '</div>' +
          '<p class="note">수익률은 이 사례의 경로(고점 대비 낙폭)에서 같은 날짜의 값을 다시 계산한 것입니다. 경로가 252거래일까지만 있어 180거래일 값이 비는 경우가 있습니다(—).</p>'
          : '<p class="note">닮은 날을 계산하지 못했습니다.</p>') +
      '</div>' +

      '<div class="grid g2">' +
        '<div class="panel"><div class="panel-h"><h2>고점에서 보였던 것</h2></div><ul class="list">' +
          (c.seen || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
        '<div class="panel"><div class="panel-h"><h2>끝까지 보이지 않던 것</h2></div><ul class="list">' +
          (c.unseen || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>고점 이후 낙폭표</h2><span class="note">같은 경로를 날짜별로</span></div>' +
        '<div class="tbl-wrap" style="max-height:320px;overflow-y:auto"><table class="tbl"><thead><tr><th>고점 +경과일</th><th>낙폭</th></tr></thead><tbody>' +
          pointRows + '</tbody></table></div>' +
        (c.ref ? '<p class="note">참고 — 원본 PDF가 지목한 가장 가까운 날: ' + F.day(c.ref.date) + ' (고점 +' + c.ref.d + ', 낙폭 ' + F.pct(c.ref.dd, 1) + ')</p>' : '') +
      '</div>' +

      '<div class="row" style="justify-content:space-between;margin-top:4px">' +
        '<a class="btn ghost" href="#/crash/' + prev.id + '">← ' + esc(prev.short) + '</a>' +
        '<a class="btn ghost" href="#/crash">목록</a>' +
        '<a class="btn ghost" href="#/crash/' + next.id + '">' + esc(next.short) + ' →</a>' +
      '</div>';

    if (m) {
      el('#jumpAnalog', view).addEventListener('click', function () {
        analogFilter = c.id;
        analogFocus = m.dd;
        analogFocusNote = esc(c.short + ' ' + c.name) + ' · ' + F.day(m.date);
        location.hash = '#/journal/verify';
      });
    }

    function drawCase() {
      var host = el('#caseChart', view);
      if (crashScale === 'trough') {
        var pts = (c.troughPath || []).map(function (p) { return [p[0], p[1]]; });
        if (!pts.length) { host.innerHTML = '<div class="empty">저점 기준 경로가 없습니다.</div>'; return; }
        var xr = [pts[0][0], pts[pts.length - 1][0]];
        Charts.line(host, {
          height: 280,
          series: [{ name: '저점 대비', color: c.color, points: pts }],
          xMin: xr[0], xMax: xr[1],
          xTicks: [xr[0], -126, 0, 126, xr[1]].map(function (x) { return { x: x, label: (x > 0 ? '+' : '') + x }; }),
          hlines: [{ y: 0, color: '#5d7096', label: '저점 = 0%', dash: '4 4' }],
          markers: [{ x: 0, y: 0, color: c.color, label: '저점', r: 4 }],
          yDigits: 0
        });
        el('#caseNote', view).textContent = '저점 종가를 0%로 두고 저점 252거래일 전부터 252거래일 뒤까지. 자료: ' +
          (c.troughFrom || '?') + ' ~ ' + (c.troughTo || '?') + '. 세로축은 저점 대비 %입니다.';
      } else {
        var all = (c.prePath || []).concat(c.path || []).map(function (p) { return [p[0], p[1]]; });
        if (!all.length) { host.innerHTML = '<div class="empty">고점 기준 경로가 없습니다.</div>'; return; }
        var minY = Math.min.apply(null, all.map(function (p) { return p[1]; }));
        var ti = 0;
        all.forEach(function (p, i) { if (p[1] < all[ti][1]) ti = i; });
        Charts.line(host, {
          height: 280,
          series: [{ name: '고점 대비', color: c.color, points: all }],
          xMin: all[0][0], xMax: all[all.length - 1][0],
          xTicks: [{ x: -252, label: '-252' }, { x: 0, label: '고점' }, { x: 126, label: '+126' }, { x: all[all.length - 1][0], label: '+' + all[all.length - 1][0] }],
          yMin: Math.min(0, Math.floor(minY / 10) * 10), yMax: 10,
          hlines: [{ y: 0, color: '#5d7096', label: '고점 = 0%' }],
          vlines: [{ x: 0, color: '#5d7096' }],
          markers: [{ x: all[ti][0], y: all[ti][1], color: '#e8ecf4', label: '최저 ' + F.pct(all[ti][1], 1), r: 4 }],
          yDigits: 0
        });
        el('#caseNote', view).textContent = '고점 종가를 0%로 두고 고점 252거래일 전부터 252거래일 뒤까지. 고점 전 자료는 ' +
          (c.preFrom ? c.preFrom + '부터' : '없음') + ' · 야후 일봉 종가.';
      }
    }
    on(view, 'click', '[data-scale]', function (e, t) {
      crashScale = t.getAttribute('data-scale');
      els(view, '[data-scale]').forEach(function (b) { b.classList.toggle('on', b === t); });
      drawCase();
    });
    drawCase();
  };

  /* ------------------------------------------------------------ 리밸런싱 (보유 입력이 원천) */
  /* 미국장·국장 두 탭. 각 탭은 자기 보유·목표 비중·총 투자금·밴드를 따로 갖고(저장도 따로),
     미국장은 달러, 국장은 원으로 넣고 표시한다. 두 탭 합계는 환율로 원화에 맞춰 한 줄로 보여 준다. */
  V.rebalance = function (view) {
    var market = rebMarket();
    var cur = MKT_CUR[market];
    var unitWord = MKT_UNIT[market];
    var st = mktSettings(market);
    var rows = mktHoldings(market);
    var calc = calcHoldings(rows, { total: st.total, band: st.band });

    function money(v, c) {
      if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
      if (c === 'KRW') return F.int(v) + '원';
      var n = Number(v);
      var d = Math.abs(n) < 1000 ? 2 : 0;
      var body = Math.abs(n).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
      return (n < 0 ? '-$' : '$') + body;   /* -$1,115 처럼 부호를 $ 앞에 */
    }
    function pxText(v, c) {
      if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
      return c === 'KRW' ? F.int(v) : F.fixed(v, 2);
    }
    function nameOf(r) {
      if (r.name) return r.name;
      var e = r.sym ? liveSymEntry(r.sym) : null;
      if (e && (e.name || e.nameKo)) return e.name || e.nameKo;
      return '';
    }

    function rowHtml(r, i) {
      var ph = market === 'kr' ? '005930' : 'TQQQ';
      return '<tr>' +
        '<td><input class="name" data-i="' + i + '" data-k="sym" value="' + esc(r.sym || '') + '" placeholder="' + ph + '" aria-label="티커"' +
          (market === 'kr' ? ' inputmode="numeric"' : '') + '>' +
          '<div class="tnm" data-nm="' + i + '">' + esc(nameOf(r)) + '</div></td>' +
        '<td><input data-i="' + i + '" data-k="qty" value="' + (r.qty === '' || r.qty === null || r.qty === undefined ? '' : r.qty) + '" inputmode="decimal" aria-label="수량"></td>' +
        '<td><input data-i="' + i + '" data-k="avg" value="' + (r.avg === '' || r.avg === null || r.avg === undefined ? '' : r.avg) + '" inputmode="decimal" aria-label="평균단가"></td>' +
        '<td><input data-i="' + i + '" data-k="price" value="' + (r.price === '' || r.price === null || r.price === undefined ? '' : r.price) + '" inputmode="decimal" aria-label="현재가"></td>' +
        '<td><input data-i="' + i + '" data-k="target" value="' + (r.target === '' || r.target === null || r.target === undefined ? '' : r.target) + '" inputmode="decimal" aria-label="목표 비중"></td>' +
        '<td class="mono" data-out="value-' + i + '"></td>' +
        '<td class="mono" data-out="pl-' + i + '"></td>' +
        '<td class="mono" data-out="weight-' + i + '"></td>' +
        '<td class="mono" data-out="drift-' + i + '"></td>' +
        '<td data-out="band-' + i + '"></td>' +
        '<td class="mono" data-out="qtyd-' + i + '"></td>' +
        '<td><button class="linkbtn del" data-del="' + i + '" type="button">지운다</button></td>' +
        '</tr>';
    }

    var body;
    var emptyMsg = '';
    if (!rows.length) {
      body = '';
      emptyMsg = '<div class="empty">' + MKT_LABEL[market] + ' 보유가 비어 있습니다. <b>+ 보유 추가</b>로 티커·수량·평균단가를 넣거나, 아래 예시로 채워 보세요.</div>';
    } else {
      body = rows.map(rowHtml).join('');
    }

    view.innerHTML =
      '<section class="hero"><div class="crumb"><a href="#/">홈</a> / 리밸런싱</div>' +
        '<h1>리밸런싱</h1>' +
        '<p>미국장은 <b>달러</b>, 국장은 <b>원</b>으로 따로 넣습니다. 탭마다 보유·목표 비중·총 투자금·밴드가 따로 저장되고, 두 시장 합계는 환율로 원화에 맞춰 보여 줍니다.</p></section>' +

      '<div class="panel tight">' +
        '<div class="mkt-tabs reb-tabs" role="tablist" aria-label="시장">' +
          '<button class="tab' + (market === 'us' ? ' on' : '') + '" data-rebmkt="us" type="button" role="tab" aria-selected="' + (market === 'us') + '">미국장 · 달러($)</button>' +
          '<button class="tab' + (market === 'kr' ? ' on' : '') + '" data-rebmkt="kr" type="button" role="tab" aria-selected="' + (market === 'kr') + '">국장 · 원화(원)</button>' +
        '</div>' +
        '<div id="rebSumStrip"></div>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="form-grid" style="margin-bottom:12px">' +
          '<div class="field span2"><label for="pfTotal">' + MKT_LABEL[market] + ' 총 투자금 (' + unitWord + ', 비우면 평가금액 기준)</label>' +
            '<input id="pfTotal" inputmode="numeric" value="' + (st.total || '') + '"></div>' +
          '<div class="field"><label for="pfBand">밴드 ± (%p)</label>' +
            '<input id="pfBand" inputmode="decimal" value="' + (st.band === undefined ? 5 : st.band) + '"></div>' +
          '<div class="field span3"><label>시세</label>' +
            '<div class="row"><button class="btn" type="button" id="fetchPx">시세 자동 조회</button>' +
            '<button class="btn ghost" type="button" id="pasteBtn">체결 붙여넣기</button></div></div>' +
          (market === 'kr'
            ? '<div class="field span6"><label for="krFind">국장 종목 찾기 (이름 또는 6자리 코드)</label>' +
                '<div class="wadd"><input id="krFind" placeholder="예: 삼성전자, 005930" aria-label="국장 종목 찾기" autocomplete="off">' +
                '<div class="ac" id="krFindAc" hidden></div></div></div>'
            : '') +
        '</div>' +
        '<div class="tbl-wrap"><table class="tbl" id="pfTbl"><thead><tr>' +
          '<th>티커 / 종목</th><th>수량</th><th>평균단가(' + unitWord + ')</th><th>현재가(' + unitWord + ')</th><th>목표 비중 %</th>' +
          '<th>평가금액(' + unitWord + ')</th><th>평가손익(' + unitWord + ')</th><th>현재 비중 %</th><th>목표와 차이(%p)</th><th>밴드</th><th>제안 수량</th><th></th>' +
        '</tr></thead><tbody>' + body + '</tbody>' +
        '</table></div>' + emptyMsg +
        '<div class="row" style="margin-top:10px">' +
          '<button class="btn" type="button" id="addRow">+ 보유 추가</button>' +
          '<button class="btn ghost" type="button" id="exampleRows">예시로 채우기</button>' +
          '<button class="btn ghost" type="button" id="resetPf">처음 값으로</button>' +
          '<span class="spacer"></span>' +
          '<span class="dim small">' + MKT_LABEL[market] + ' 입력은 이 브라우저에 자동 저장됩니다</span>' +
        '</div>' +
        '<div id="pxNotice"></div>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>' + MKT_LABEL[market] + ' 요약</h2><span class="note" id="sumNote"></span></div>' +
        '<dl class="kv" id="sumBox"></dl>' +
        '<p class="note">평가금액 = 현재가 × 수량. 목표 금액과 현재 비중은 모두 그 탭의 총 투자금(비우면 평가금액 합계) 기준입니다. ' +
          '제안 수량 = (목표 금액 − 평가금액) ÷ 현재가를 버림하고, 밴드 안이면 0입니다. ' +
          (market === 'kr' ? '국장은 원화로만 계산합니다. ' : '') +
          '세금·수수료는 넣지 않았습니다.</p>' +
      '</div>';

    function save() { saveMktHoldings(market, rows); }

    /* ------------------------------------------------ 환율·두 시장 합계 줄 */
    function stripHtml() {
      var cUs = marketCalc('us'), cKr = marketCalc('kr');
      var f = fxNow();
      var rate = f ? f.usdkrw : null;
      var usKrw = rate ? cUs.totalValue * rate : null;
      var total = (usKrw || 0) + cKr.totalValue;
      var srcTxt = f
        ? ((f.manual ? '직접 입력' : (f.src || 'data/live.json')) + (f.at ? ' · ' + stampOf(f.at) : ''))
        : '값 없음';
      if (f && f.stale) srcTxt = '마지막으로 받은 값' + (f.at ? ' · ' + stampOf(f.at) : '');
      var note = '';
      if (!f) {
        note = '<p class="note" style="color:var(--amber)">환율 값 없음 — data/live.json 에 환율이 없어 미국장 금액을 원으로 환산하지 못했습니다. 위 칸에 직접 넣으면 환산해 계산합니다.</p>';
      } else if (f.stale) {
        note = '<p class="note" style="color:var(--amber)">지금 받은 환율 값이 없어 마지막으로 받은 값(' + F.int(f.usdkrw) + '원)을 씁니다.</p>';
      }
      var krNote = '';
      if (market === 'kr') {
        var L = liveDocNow();
        var k = L && L.kr;
        krNote = k
          ? '<p class="note">국장 세션 <b>' + esc(k.sessionLabel || '—') + '</b> · ' + esc(k.kst || '') + ' KST · 국내 정규장 09:00~15:30 · 시세는 지연될 수 있습니다.</p>'
          : '<p class="note">국내 정규장 09:00~15:30 KST. data/live.json 에 국장 세션 정보가 아직 없습니다.</p>';
      }
      return '<div class="reb-fx">' +
        '<div class="row reb-fx-row">' +
          '<label for="fxRate">환율 1달러 =</label>' +
          '<span class="fx-in"><input id="fxRate" inputmode="decimal" value="' + (rate ? rate : '') + '" aria-label="환율 원/달러"><span class="dim small">원</span></span>' +
          '<span class="dim small" id="fxSrc">' + esc(srcTxt) + '</span>' +
          (f && f.manual ? '<button class="linkbtn" type="button" id="fxAuto">자동 값으로</button>' : '') +
        '</div>' +
        note +
        '<dl class="kv reb-sum">' +
          '<div><dt>미국장 (달러)</dt><dd class="mono">' + money(cUs.totalValue, 'USD') +
            '<small> ' + (rate ? '≈ ' + F.int(usKrw) + '원' : '환율 값 없음') + '</small></dd></div>' +
          '<div><dt>국장 (원)</dt><dd class="mono">' + money(cKr.totalValue, 'KRW') + '</dd></div>' +
          '<div class="sum"><dt>두 시장 합계 (원화)</dt><dd class="mono">' +
            (rate ? F.int(total) + '원' : '국장 ' + F.int(cKr.totalValue) + '원 <small>미국장 환산 불가</small>') + '</dd></div>' +
        '</dl>' +
        krNote +
        '</div>';
    }

    function drawStrip() {
      var box = el('#rebSumStrip', view);
      if (!box) return;
      box.innerHTML = stripHtml();
      var fxIn = el('#fxRate', view);
      if (fxIn) fxIn.addEventListener('change', function () {
        var v = numOrNull(this.value);
        if (v === null || v <= 0) {
          S.del('fx');
          toast('직접 넣은 환율을 지웠습니다. 자동 값으로 돌아갑니다.');
        } else {
          S.set('fx', { usdkrw: v, at: new Date().toISOString(), src: '직접 입력' });
          toast('환율을 ' + F.int(v) + '원으로 저장했습니다.');
        }
        V.rebalance(liveView());
      });
      var auto = el('#fxAuto', view);
      if (auto) auto.addEventListener('click', function () {
        S.del('fx');
        toast('자동 환율 값으로 되돌렸습니다.');
        V.rebalance(liveView());
      });
    }

    /* ------------------------------------------------ 표·요약 다시 계산 */
    function recompute() {
      var c2 = calcHoldings(rows, { total: st.total, band: st.band });
      c2.rows.forEach(function (r, i) {
        var q = function (k) { return el('[data-out="' + k + '-' + i + '"]', view); };
        if (q('value')) q('value').innerHTML = money(r.value, cur);
        if (q('pl')) {
          q('pl').innerHTML = r.cost > 0
            ? '<span class="' + (r.pl >= 0 ? 'pos' : 'neg') + '">' + (r.pl >= 0 ? '+' : '') + money(r.pl, cur) + '</span>' +
              '<div class="dim small">' + (r.plPct === null ? '' : F.pct(r.plPct, 1)) + '</div>'
            : '<span class="dim">—</span>';
        }
        if (q('weight')) q('weight').textContent = r.value > 0 ? F.num(r.weight, 2) + '%' : '—';
        if (q('drift')) {
          q('drift').textContent = r.value > 0 ? F.signed(r.drift, 2) : '—';
          q('drift').className = 'mono ' + (!r.isOut ? 'dim' : (r.qtyDelta > 0 ? 'pos' : r.qtyDelta < 0 ? 'neg' : 'dim'));
        }
        if (q('band')) q('band').innerHTML = r.isOut ? '<span class="badge amber">이탈</span>' : '<span class="badge good">안</span>';
        if (q('qtyd')) {
          var isCash = (r.sym || '').trim().toUpperCase() === 'CASH';
          if (isCash) {
            q('qtyd').innerHTML = r.isOut
              ? '<b class="' + (r.diffValue > 0 ? 'pos' : 'neg') + '">' + money(Math.abs(r.diffValue), cur) + '</b><span class="dim small"> ' + (r.diffValue > 0 ? '늘리는 쪽' : '줄이는 쪽') + '</span>'
              : '<span class="dim">0</span>';
          } else {
            q('qtyd').innerHTML = r.qtyDelta === 0 ? '<span class="dim">0</span>' :
              '<b class="' + (r.qtyDelta > 0 ? 'pos' : 'neg') + '">' + F.int(r.qtyDelta) + '</b><span class="dim small"> 주</span>';
          }
        }
      });
      el('#sumBox', view).innerHTML =
        '<div><dt>총 평가금액</dt><dd>' + money(c2.totalValue, cur) + '</dd></div>' +
        '<div><dt>평가손익</dt><dd class="' + (c2.pl >= 0 ? 'pos' : 'neg') + '">' + (c2.pl >= 0 ? '+' : '') + money(c2.pl, cur) +
          (c2.plPct === null ? '' : ' <small>' + F.pct(c2.plPct, 1) + '</small>') + '</dd></div>' +
        '<div><dt>목표 비중 합</dt><dd>' + F.num(c2.targetSum, 1) + ' <small>%</small></dd></div>' +
        '<div><dt>밴드 이탈</dt><dd>' + c2.out + ' <small>종목</small></dd></div>' +
        '<div><dt>매수 필요</dt><dd class="pos">' + money(c2.buy, cur) + '</dd></div>' +
        '<div><dt>매도 필요</dt><dd class="neg">' + money(c2.sell, cur) + '</dd></div>';
      el('#sumNote', view).textContent = '밴드 ±' + F.num(st.band) + '%p · 목표 비중 합 ' + F.num(c2.targetSum, 1) + '%' +
        (Math.abs(c2.targetSum - 100) > 0.01 && c2.targetSum > 0 ? ' (합이 100%가 아닙니다)' : '') +
        (c2.base !== c2.totalValue ? ' · 비중은 총 투자금 ' + money(c2.base, cur) + ' 기준' : '');
      if (market === 'kr') {
        var L = liveDocNow(), k = L && L.kr;
        if (k) {
          var sn = el('#sumNote', view);
          if (sn) sn.textContent += ' · 국장 ' + (k.sessionLabel || '세션 정보 없음');
        }
      }
      drawStrip();
    }

    /* ------------------------------------------------ 탭 전환 */
    els('[data-rebmkt]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-rebmkt');
        if (m === market) return;
        S.set(REB_TAB, m);
        V.rebalance(liveView());
      });
    });

    on(view, 'input', '#pfTbl input', function (e, t) {
      var i = Number(t.getAttribute('data-i'));
      var k = t.getAttribute('data-k');
      var r = rows[i];
      if (!r) return;
      r[k] = (k === 'sym') ? t.value : numOrNull(t.value);
      if (k === 'sym') {
        r.sym = String(t.value || '').trim().toUpperCase();
        var nm = el('[data-nm="' + i + '"]', view);
        if (nm) nm.textContent = nameOf(r);
      }
      save();
      recompute();
    });

    on(view, 'click', '[data-del]', function (e, t) {
      var i = Number(t.getAttribute('data-del'));
      rows.splice(i, 1);
      save();
      V.rebalance(liveView());
      toast(MKT_LABEL[market] + ' 줄을 지웠습니다.');
    });

    el('#addRow', view).addEventListener('click', function () {
      rows.push({ id: uid(), sym: '', qty: null, avg: null, price: null, target: 0 });
      save();
      V.rebalance(liveView());
    });

    el('#exampleRows', view).addEventListener('click', function () {
      if (market === 'kr') {
        var a = krLiveInfo('005930'), b = krLiveInfo('000660');
        rows = [
          { id: uid(), sym: '005930', name: a ? a.name : '삼성전자', qty: 100, avg: 150000, price: a ? Math.round(a.price) : null, target: 60 },
          { id: uid(), sym: '000660', name: b ? b.name : 'SK하이닉스', qty: 10, avg: 900000, price: b ? Math.round(b.price) : null, target: 20 },
          { id: uid(), sym: 'CASH', qty: 2000000, avg: 1, price: 1, target: 20 }
        ];
        save();
        V.rebalance(liveView());
        toast('국장 예시 값으로 채웠습니다. 실제 보유로 바꿔 주세요.');
        return;
      }
      rows = [
        { id: uid(), sym: 'TQQQ', qty: 100, avg: 60, price: Data.scores.targets.ndx.detail.close, target: 50 },
        { id: uid(), sym: 'SOXL', qty: 100, avg: 90, price: Data.scores.targets.sox.detail.close, target: 30 },
        { id: uid(), sym: 'CASH', qty: 2000, avg: 1, price: 1, target: 20 }
      ];
      save();
      V.rebalance(liveView());
      toast('미국장 예시 값(달러)으로 채웠습니다. 실제 보유로 바꿔 주세요.');
    });

    el('#resetPf', view).addEventListener('click', function () {
      confirmBox({ title: MKT_LABEL[market] + ' 보유를 모두 지울까요?', body: '이 탭의 티커·수량·평균단가가 지워집니다. 다른 탭은 그대로입니다. 되돌릴 수 없습니다.', ok: '지운다' }, function () {
        rows = [];
        save();
        V.rebalance(liveView());
        toast(MKT_LABEL[market] + ' 보유를 지웠습니다.');
      });
    });

    el('#pfTotal', view).addEventListener('input', function () {
      st.total = numOrNull(this.value) || 0;
      saveMktSettings(market, st);
      recompute();
    });
    el('#pfBand', view).addEventListener('input', function () {
      st.band = numOrNull(this.value);
      if (st.band === null) st.band = 5;
      saveMktSettings(market, st);
      recompute();
    });

    el('#pasteBtn', view).addEventListener('click', function () {
      el('#pxNotice', view).innerHTML = '<div class="notice"><b>체결 붙여넣기는 2차 판입니다.</b> ' +
        '증권사마다 체결 내역 형식이 달라 자동 해석을 아직 붙이지 못했습니다. 지금은 위 표에 직접 넣어 주세요.</div>';
      toast('체결 붙여넣기는 준비 중입니다.');
    });

    /* ------------------------------------------------ 시세 자동 조회 (탭별) */
    el('#fetchPx', view).addEventListener('click', function () {
      var btn = this;
      var notice = el('#pxNotice', view);
      var targets = rows.filter(function (r) {
        var s = String(r.sym || '').trim().toUpperCase();
        if (!s || s === 'CASH') return false;
        return market === 'kr' ? /^\d{6}(\.(KS|KQ))?$/.test(s) : /^[A-Z][A-Z0-9.\-]{0,7}$/.test(s);
      });
      if (!targets.length) {
        notice.innerHTML = '<div class="notice">' + (market === 'kr'
          ? '국장 탭에서는 6자리 코드(예: 005930)로 적어 주세요. .KS·.KQ 를 붙여도 됩니다.'
          : '미국장 탭에서는 영문 티커(예: TQQQ)로 적어 주세요. 국장 6자리 코드는 국장 탭에서 조회합니다.') + '</div>';
        return;
      }
      btn.disabled = true;
      btn.textContent = '조회 중…';

      var got = {}, miss = [], srcNotes = {};
      var done = 0;

      function finish() {
        btn.disabled = false;
        btn.textContent = '시세 자동 조회';
        /* 그 사이 사용자가 표를 고쳤을 수 있으니 지금 저장된 보유에만 가격을 얹는다 */
        var curRows = mktHoldings(market);
        curRows.forEach(function (r) {
          var key = String(r.id || '');
          if (got[key]) {
            r.price = got[key].price;
            if (got[key].name) r.name = got[key].name;
            if (got[key].sym) r.sym = got[key].sym;
          }
        });
        if (location.hash.indexOf('#/rebalance') === 0) {
          saveMktHoldings(market, curRows);
          V.rebalance(liveView());
        }
        var okN = Object.keys(got).length;
        if (miss.length) {
          var box0 = document.getElementById('pxNotice');
          if (box0) box0.innerHTML = '<div class="notice"><b>' + miss.join(', ') + '</b> — 시세를 찾지 못했습니다. ' +
            'data/live.json(5분 갱신)에도 증시 스냅샷에도 없는 종목입니다. 현재가를 직접 넣어 주세요.</div>';
        }
        if (okN > 0) {
          var srcTxt = Object.keys(srcNotes).map(function (k) { return srcNotes[k]; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' · ');
          toast(okN + '종목 시세를 채웠습니다' + (srcTxt ? ' (' + srcTxt + ')' : '') + '.');
        } else {
          var box = document.getElementById('pxNotice');
          if (box) box.innerHTML = '<div class="notice"><b>자동 시세를 받지 못했습니다.</b> ' +
            (market === 'kr'
              ? 'data/live.json(5분 갱신)과 증시 스냅샷에 그 종목이 없고, 브라우저가 금융 사이트를 직접 부르는 것도 막혀 있는 경우입니다(교차 출처 차단). 현재가를 직접 넣어 주세요.'
              : 'data/live.json 에 그 종목이 있으면 그 값을 쓰고, 없으면 현재가를 직접 넣어 주세요.') + '</div>';
        }
      }

      function step() {
        done++;
        if (done >= targets.length) finish();
      }

      targets.forEach(function (r) {
        var key = String(r.id || '');
        var sym = String(r.sym || '').trim().toUpperCase();
        if (market === 'kr') {
          krQuote(sym).then(function (q) {
            if (q && q.price) {
              got[key] = { price: Math.round(q.price), name: q.name || '', sym: q.code || sym.replace(/\.(KS|KQ)$/, '') };
              srcNotes[q.src] = (srcNotes[q.src] || q.src);
              if (q.at) srcNotes[q.src] = q.src + ' ' + q.at;
            } else miss.push(sym);
          }).catch(function () { miss.push(sym); }).then(step);
          return;
        }
        /* 미국장 — data/live.json 값(홈·매수 지표와 같은 기준)을 먼저 쓰고, 없으면 야후 직접 */
        var q = w.Basis ? Basis.quote(sym) : null;
        if (q && q.price > 0 && (Basis.get() === 'live' || q.close)) {
          var p = (Basis.get() === 'live' ? q.price : (q.close || q.price));
          got[key] = { price: Math.round(p * 100) / 100 };
          srcNotes['5분 갱신'] = '5분 갱신';
          var le = liveSymEntry(sym);
          if (le && le.name) got[key].name = le.name;
          step();
          return;
        }
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=1d&interval=1d')
          .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
          .then(function (j) {
            var meta = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
            var price = meta && (meta.regularMarketPrice || meta.previousClose);
            if (!price) throw new Error('no price');
            got[key] = { price: Math.round(price * 100) / 100, name: meta.shortName || '' };
            srcNotes['직접 조회'] = '직접 조회';
          })
          .catch(function () { miss.push(sym); })
          .then(step);
      });
    });

    /* ------------------------------------------------ 국장 종목 찾기 (이름→코드) */
    var findInp = el('#krFind', view);
    if (findInp) {
      var box = el('#krFindAc', view);
      function suggest() {
        var q = findInp.value.trim();
        if (!q) { box.hidden = true; box.innerHTML = ''; return; }
        var up = q.toUpperCase();
        var hits = [];
        var L = liveDocNow();
        if (L && L.symbols) {
          Object.keys(L.symbols).forEach(function (k) {
            var e = L.symbols[k] || {};
            var isKr = e.market === 'kr' || /^\d{6}\.(KS|KQ)$/i.test(k);
            if (!isKr) return;
            var code = e.code || k.split('.')[0];
            var nm = e.name || e.nameKo || '';
            if (String(code).indexOf(q) === 0 || String(nm).indexOf(q) >= 0) hits.push({ sym: code, name: nm });
          });
        }
        if (w.Mkt && Mkt.ready) {
          Mkt.search(q, 'kr', 10).forEach(function (h) {
            if (!hits.some(function (x) { return x.sym === h.sym; })) hits.push({ sym: h.sym, name: h.name || '' });
          });
        }
        if (!hits.length) {
          box.innerHTML = '<div class="em">찾지 못했습니다 — 6자리 코드를 직접 넣어도 됩니다(' + esc(up) + ').</div>';
          box.hidden = false;
          return;
        }
        box.innerHTML = hits.slice(0, 8).map(function (h) {
          return '<button type="button" data-pick="' + esc(h.sym) + '" data-nm="' + esc(h.name || '') + '">' +
            '<span class="t">' + esc(h.sym) + '</span><span class="m">' + esc(h.name || '') + '</span></button>';
        }).join('');
        box.hidden = false;
      }
      findInp.addEventListener('input', function () {
        if (w.Mkt && !Mkt.ready && Mkt.load) {
          box.innerHTML = '<div class="em">종목 목록을 받는 중…</div>';
          box.hidden = false;
          Mkt.load().then(suggest).catch(suggest);
        } else {
          suggest();
        }
      });
      box.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-pick]');
        if (!b) return;
        var sym = b.getAttribute('data-pick');
        var nm = b.getAttribute('data-nm') || '';
        var empty = -1;
        for (var i = 0; i < rows.length; i++) { if (!String(rows[i].sym || '').trim()) { empty = i; break; } }
        if (empty >= 0) {
          rows[empty].sym = sym;
          if (nm) rows[empty].name = nm;
        } else {
          rows.push({ id: uid(), sym: sym, name: nm, qty: null, avg: null, price: null, target: 0 });
        }
        save();
        V.rebalance(liveView());
        toast(MKT_LABEL.kr + ' 종목을 넣었습니다 — 시세 자동 조회로 현재가를 채우세요.');
      });
    }

    recompute();
  };

  /* ------------------------------------------------------------ 기록(매매일지) + 원칙 */
  V.journal = function (view, sub) {
    var verifyOpen = sub === 'verify';
    var all = journal();
    var list = all.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var badCount = all.filter(function (r) { return r.principles && r.principles.pass === false; }).length;
    var vrows0 = verifyRows();
    var vStat = {
      ok: vrows0.filter(function (x) { return x.grade === 'ok'; }).length,
      no: vrows0.filter(function (x) { return x.grade === 'no'; }).length,
      wait: vrows0.filter(function (x) { return x.grade === 'wait'; }).length
    };
    var shown = journalOnlyBad ? list.filter(function (r) { return r.principles && r.principles.pass === false; }) : list;
    var editRec = journalEditId ? all.filter(function (r) { return r.id === journalEditId; })[0] : null;
    var pr = principles();
    var checkedCount = pr.length;

    var stats = { n: list.length, buy: 0, sell: 0, buyAmt: 0, sellAmt: 0, syms: {} };
    list.forEach(function (r) {
      var amt = (r.qty || 0) * (r.price || 0);
      if (r.side === '매수') { stats.buy++; stats.buyAmt += amt; }
      else { stats.sell++; stats.sellAmt += amt; }
      stats.syms[r.sym] = (stats.syms[r.sym] || 0) + 1;
    });

    var rowsHtml = shown.map(function (r) {
      var snap = r.snap || Data.scoreOn(r.date);
      var snapHtml = snap
        ? '<b class="mono">' + F.num(snap.ndx) + '</b> / <b class="mono">' + F.num(snap.sox) + '</b>' +
          '<div class="dim small">낙폭 ' + (snap.ndxDd === null || snap.ndxDd === undefined ? '—' : F.pct(snap.ndxDd, 1)) +
          ' / ' + (snap.soxDd === null || snap.soxDd === undefined ? '—' : F.pct(snap.soxDd, 1)) + '</div>' +
          (snap.exact ? '' : '<div class="dim small">' + F.day(snap.date) + ' 값</div>')
        : '<span class="dim">—</span>';
      var prBadge = r.principles
        ? (r.principles.pass ? '<span class="badge good">원칙 통과</span>'
          : '<span class="badge red">미통과 ' + r.principles.checked + '/' + r.principles.total + '</span>')
        : '<span class="badge grey">기록 없음</span>';
      return '<tr' + (journalFocus === r.id ? ' class="focus"' : '') + '>' +
        '<td class="mono">' + F.day(r.date) + '</td>' +
        '<td><b>' + esc(r.sym) + '</b></td>' +
        '<td><span class="badge ' + (r.side === '매수' ? 'blue' : 'amber') + '">' + esc(r.side) + '</span></td>' +
        '<td class="mono">' + F.int(r.qty) + '</td>' +
        '<td class="mono">' + F.fixed(r.price, 2) + '</td>' +
        '<td class="mono">' + F.int((r.qty || 0) * (r.price || 0)) + '</td>' +
        '<td>' + snapHtml + '</td>' +
        '<td>' + prBadge + '</td>' +
        '<td class="wrap">' + (r.memo ? esc(r.memo) : '<span class="dim">—</span>') + '</td>' +
        '<td><button class="linkbtn" data-vjump="' + r.id + '" type="button">닮은 날·채점</button>' +
          '<button class="linkbtn" data-edit="' + r.id + '" type="button">수정</button>' +
          '<button class="linkbtn del" data-rm="' + r.id + '" type="button">삭제</button></td>' +
        '</tr>';
    }).join('');

    var checks = pr.map(function (p, i) {
      var on = editRec && editRec.principles && editRec.principles.checkedList
        ? editRec.principles.checkedList.indexOf(p.id) >= 0 : false;
      return '<label class="chip" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 12px">' +
        '<input type="checkbox" data-prin="' + p.id + '" ' + (on ? 'checked' : '') + ' style="width:16px;height:16px;accent-color:#6a9ae0">' +
        '<span>' + esc(p.text) + '</span></label>';
    }).join('');

    view.innerHTML =
      '<section class="hero"><div class="crumb"><a href="#/">홈</a> / 기록</div>' +
        '<h1>기록</h1>' +
        '<p>내 매매일지와 그 기록의 채점을 한 자리에 두었습니다. 저장하기 전에 내 원칙을 통과시키고, 산 날의 점수·낙폭이 함께 남습니다. ' +
          '아래 <b>검증 기록(과거 대입)</b>에서 매매 하나를 누르면 그 매매의 닮은 날과 30거래일 뒤 채점으로 이어집니다. 기록은 이 브라우저에만 저장됩니다.</p></section>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>' + (editRec ? '기록 수정' : '기록 추가') + '</h2>' +
          (editRec ? '<span class="badge amber">수정 중</span>' : '') + '</div>' +
        '<form id="jForm" class="form-grid">' +
          '<div class="field"><label for="jDate">날짜</label><input type="date" id="jDate" value="' + (editRec ? editRec.date : F.today()) + '" required></div>' +
          '<div class="field"><label for="jSym">티커</label><input id="jSym" placeholder="TQQQ" value="' + (editRec ? esc(editRec.sym) : '') + '" required></div>' +
          '<div class="field"><label for="jSide">구분</label><select id="jSide">' +
            ['매수', '매도'].map(function (x) { return '<option' + (editRec && editRec.side === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label for="jQty">수량</label><input id="jQty" inputmode="decimal" value="' + (editRec ? editRec.qty : '') + '" required></div>' +
          '<div class="field"><label for="jPrice">가격</label><input id="jPrice" inputmode="decimal" value="' + (editRec ? editRec.price : '') + '" required></div>' +
          '<div class="field"><label>&nbsp;</label><button class="btn primary" type="submit">' + (editRec ? '수정 저장' : '기록 저장') + '</button></div>' +
          '<div class="field span6"><label for="jMemo">한 줄 메모</label><input id="jMemo" placeholder="왜 샀는지 한 줄" value="' + (editRec ? esc(editRec.memo || '') : '') + '"></div>' +
          '<div class="field span6"><label>원칙 체크 (' + pr.length + '개)</label>' +
            '<div class="row" id="prinChecks">' + checks + '</div>' +
            '<span class="note">체크하지 않아도 저장됩니다. 다만 그 기록은 \'원칙 미통과\'로 남고 목록에서 걸러 볼 수 있습니다.</span>' +
          '</div>' +
        '</form>' +
        (editRec ? '<div class="row" style="margin-top:8px"><button class="btn ghost sm" type="button" id="jCancel">수정 취소</button></div>' : '') +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>내 원칙</h2><span class="note">저장 전 체크리스트로 씁니다</span>' +
          '<span class="spacer"></span><button class="btn sm" type="button" id="prinAdd">+ 원칙 추가</button></div>' +
        '<div id="prinList">' + pr.map(function (p, i) {
          return '<div class="row" style="margin-bottom:6px">' +
            '<span class="badge grey" style="min-width:26px;justify-content:center">' + (i + 1) + '</span>' +
            '<input data-prin-text="' + p.id + '" value="' + esc(p.text) + '" style="flex:1;background:var(--sunken);border:1px solid var(--line2);border-radius:9px;color:var(--tx);padding:7px 10px;font:inherit">' +
            '<button class="linkbtn del" data-prin-del="' + p.id + '" type="button">지운다</button></div>';
        }).join('') + '</div>' +
        (pr.length ? '' : '<div class="empty">원칙이 없습니다. 추가하면 저장 전 체크리스트가 됩니다.</div>') +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>요약</h2></div>' +
        '<dl class="kv">' +
          '<div><dt>기록</dt><dd>' + stats.n + ' <small>건</small></dd></div>' +
          '<div><dt>매수 / 매도</dt><dd>' + stats.buy + ' / ' + stats.sell + '</dd></div>' +
          '<div><dt>매수 금액</dt><dd>' + F.int(stats.buyAmt) + ' <small>원</small></dd></div>' +
          '<div><dt>매도 금액</dt><dd>' + F.int(stats.sellAmt) + ' <small>원</small></dd></div>' +
          '<div><dt>원칙 미통과</dt><dd class="' + (badCount ? 'neg' : '') + '">' + badCount + ' <small>건</small></dd></div>' +
        '</dl>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>기록 목록</h2><span class="note">' + shown.length + '건' + (journalOnlyBad ? ' (미통과만)' : '') + '</span>' +
          '<span class="spacer"></span>' +
          '<button class="chip ' + (journalOnlyBad ? 'on' : '') + '" type="button" id="badFilter">원칙 위반 매매만 보기' + (badCount ? ' (' + badCount + ')' : '') + '</button>' +
        '</div>' +
        (shown.length ?
          '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
            '<th>날짜</th><th>티커</th><th>구분</th><th>수량</th><th>가격</th><th>금액</th><th>그날 점수 (TQQQ / SOXL)</th><th>원칙</th><th>메모</th><th></th>' +
          '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
          : '<div class="empty">' + (journalOnlyBad ? '원칙을 통과하지 못한 매매가 없습니다.' : '아직 기록이 없습니다. 위에서 첫 매매를 남겨 보세요.') + '</div>') +
      '</div>' +

      '<section class="panel g-sec" id="verifySec">' +
        '<button class="g-sechead" type="button" id="vToggle" aria-expanded="' + (verifyOpen ? 'true' : 'false') + '">' +
          '<span class="t">검증 기록 (과거 대입)' +
            '<span class="badge ' + (vStat.no ? 'red' : 'grey') + '" style="margin-left:6px">적중 ' + vStat.ok + ' · 빗나감 ' + vStat.no + ' · 대기 ' + vStat.wait + '</span>' +
            '<span class="mark">' + (verifyOpen ? '접기 ▴' : '펼치기 ▾') + '</span></span>' +
          '<span class="s">사례별 가장 닮은 하루 · 확증편향 짝 · 같은 경과일 · 산점도 · 내 기록의 닮은 날과 채점. 눌러서 폅니다.</span>' +
        '</button>' +
        '<div class="g-secbody" id="verifyBody"' + (verifyOpen ? '' : ' hidden') + '>' +
          (verifyOpen ? '' : '<div class="loading">펼치면 계산합니다.</div>') +
        '</div>' +
      '</section>';

    /* 원칙 체크 상태 — 저장할 때 읽는다 */
    function checkedIds() {
      return els(view, '[data-prin]').filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-prin'); });
    }

    el('#jForm', view).addEventListener('submit', function (e) {
      e.preventDefault();
      var date = el('#jDate', view).value;
      var sym = el('#jSym', view).value.trim().toUpperCase();
      var qty = numOrNull(el('#jQty', view).value);
      var price = numOrNull(el('#jPrice', view).value);
      if (!date || !sym || !qty || !price) { toast('날짜·티커·수량·가격을 채워 주세요.'); return; }
      var ids = checkedIds();
      var snapRaw = Data.scoreOn(date);
      var rec = {
        id: editRec ? editRec.id : uid(),
        date: date, sym: sym, side: el('#jSide', view).value,
        qty: qty, price: price, memo: el('#jMemo', view).value.trim(),
        snap: snapRaw ? { date: snapRaw.date, ndx: snapRaw.ndx, sox: snapRaw.sox, ndxDd: snapRaw.ndxDd, soxDd: snapRaw.soxDd, exact: snapRaw.exact } : null,
        principles: { checked: ids.length, total: pr.length, pass: ids.length === pr.length && pr.length > 0, checkedList: ids }
      };
      var arr = journal();
      if (editRec) {
        for (var i = 0; i < arr.length; i++) if (arr[i].id === rec.id) arr[i] = rec;
        journalEditId = null;
      } else {
        arr.push(rec);
      }
      S.set(JOURNAL_KEY, arr);
      V.journal(liveView());
      if (!rec.principles.pass) {
        toast('저장했습니다 — 원칙 ' + ids.length + '/' + pr.length + '만 체크되어 미통과로 남았습니다.');
      } else {
        toast(editRec ? '기록을 고쳤습니다.' : '기록을 남겼습니다.');
      }
    });

    if (editRec) {
      el('#jCancel', view).addEventListener('click', function () {
        journalEditId = null;
        V.journal(liveView());
      });
    }

    el('#badFilter', view).addEventListener('click', function () {
      journalOnlyBad = !journalOnlyBad;
      V.journal(liveView(), 'journal');
    });

    /* 검증 기록 접기/펴기 — 펼 때 처음 계산한다(무거운 산점도) */
    var vToggle = el('#vToggle', view);
    if (vToggle) vToggle.addEventListener('click', function () {
      var body = el('#verifyBody', view);
      var open = body.hasAttribute('hidden');
      if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
      vToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      var mark = vToggle.querySelector('.mark');
      if (mark) mark.textContent = open ? '접기 ▴' : '펼치기 ▾';
      if (open) V.verify(body, { embedded: true });
    });

    /* 매매 하나 → 그 매매의 닮은 날·채점으로 */
    on(view, 'click', '[data-vjump]', function (e, t) {
      var id = t.getAttribute('data-vjump');
      journalFocus = id;
      verifyTradeFocus = id;
      var body = el('#verifyBody', view);
      if (body && body.hasAttribute('hidden')) {
        body.removeAttribute('hidden');
        var vt = el('#vToggle', view);
        if (vt) { vt.setAttribute('aria-expanded', 'true'); var mk = vt.querySelector('.mark'); if (mk) mk.textContent = '접기 ▴'; }
      }
      V.verify(body, { embedded: true });
      var row = body.querySelector('[data-trade="' + id + '"]');
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });

    if (verifyOpen) {
      V.verify(el('#verifyBody', view), { embedded: true });
      setTimeout(function () {
        var sec = el('#verifySec', view);
        if (sec) sec.scrollIntoView({ block: 'start' });
      }, 60);
    }

    el('#prinAdd', view).addEventListener('click', function () {
      var arr = principles();
      arr.push({ id: 'p' + uid(), text: '새 원칙' });
      S.set(PRIN_KEY, arr);
      V.journal(liveView());
      toast('원칙을 추가했습니다. 문구를 고쳐 주세요.');
    });

    on(view, 'input', '[data-prin-text]', function (e, t) {
      var arr = principles();
      var id = t.getAttribute('data-prin-text');
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) arr[i].text = t.value;
      S.set(PRIN_KEY, arr);
    });

    on(view, 'click', '[data-prin-del]', function (e, t) {
      var id = t.getAttribute('data-prin-del');
      confirmBox({ title: '이 원칙을 지울까요?', body: '이미 저장한 기록의 체크 결과는 그대로 남습니다.', ok: '지운다' }, function () {
        S.set(PRIN_KEY, principles().filter(function (p) { return p.id !== id; }));
        V.journal(liveView());
        toast('원칙을 지웠습니다.');
      });
    });

    on(view, 'click', '[data-edit]', function (e, t) {
      journalEditId = t.getAttribute('data-edit');
      V.journal(liveView());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    on(view, 'click', '[data-rm]', function (e, t) {
      var id = t.getAttribute('data-rm');
      confirmBox({ title: '이 기록을 지울까요?', body: '지운 기록은 되돌릴 수 없습니다.', ok: '지운다' }, function () {
        S.set(JOURNAL_KEY, journal().filter(function (r) { return r.id !== id; }));
        if (journalEditId === id) journalEditId = null;
        V.journal(liveView());
        toast('기록을 지웠습니다.');
      });
    });
  };

  /* ------------------------------------------------------------ 검증 기록(과거 대입) */
  V.verify = function (view, opts) {
    opts = opts || {};
    function render() { V.verify(view, opts); }
    var now = Data.now();
    var all = Data.analog.points;
    var cases = Data.crashes.cases;
    var matches = Data.crashes.matches || [];
    var contrast = Data.crashes.contrast;

    /* 기준 낙폭 — 매수 지표·증시와 같은 기준(확정 종가 / 실시간)을 따른다.
       실시간을 골라 두고 live.json 값이 없으면 확정 종가로 두고 화면에 그렇게 밝힌다. */
    var basis = basisMode();
    var lq = ndxLive();
    var base = (basis === 'live' && lq)
      ? { mode: 'live', dd: lq.dd, price: lq.price, at: lq.at, session: lq.session, live: lq, missing: false }
      : { mode: 'close', dd: now.dd, price: now.close, at: now.as_of, session: null, live: lq, missing: basis === 'live' };
    var focusDd = analogFocus === null ? base.dd : analogFocus;

    /* 사례별 가장 가까운 하루 — 원본 Crash.matches */
    var matchRows = matches.map(function (m, i) {
      return '<tr>' +
        '<td class="mono">' + (i + 1) + '</td>' +
        '<td><span style="color:' + m.color + '">■</span> <b>' + esc(m.short) + '</b>' +
          '<div class="dim small">' + esc(m.name) + '</div></td>' +
        '<td class="mono">' + F.day(m.date) + '</td>' +
        '<td class="mono"><b>+' + m.day + '</b><div class="dim small">거래일</div></td>' +
        '<td class="mono">' + F.pct(m.dd, 2) + '</td>' +
        '<td class="mono">' + F.pct(m.gap, 1) + '</td>' +
        '<td class="mono">' + F.num(m.rsi, 1) + '</td>' +
        '<td class="mono">' + (m.vix === null ? '<span class="dim">—</span>' : F.num(m.vix, 2)) + '</td>' +
        '<td class="mono"><b>' + F.num(m.distance, 2) + '</b>' +
          (m.metricsUsed < 4 ? '<div class="dim small">' + m.metricsUsed + '지표</div>' : '') + '</td>' +
        '<td class="mono ' + (m.fwd30 < 0 ? 'neg' : 'pos') + '">' + F.pct(m.fwd30, 1) + '</td>' +
        '<td class="mono">' + F.pct(m.fwd90, 1) + '</td>' +
        '<td class="mono">' + F.pct(m.fwd180, 1) + '</td>' +
        '</tr>';
    }).join('');

    /* 확증편향 방지 짝 (Crash.contrast) */
    var contrastHtml = '';
    /* 그 사례 경로(252거래일)에 있는 가장 먼 지평을 적는다 — 없는 값을 '180거래일 —'로 두지 않는다 */
    function fwdFar(m) {
      if (m.fwd180 !== null && m.fwd180 !== undefined) return '180거래일 ' + F.pct(m.fwd180, 1);
      if (m.fwd90 !== null && m.fwd90 !== undefined) return '90거래일 ' + F.pct(m.fwd90, 1);
      return '30거래일 ' + F.pct(m.fwd30, 1);
    }
    if (contrast) {
      var cd = contrast.deep, cf = contrast.fast;
      contrastHtml =
        '<div class="grid g2">' +
          '<div class="panel tight"><div class="panel-h"><h3 style="margin:0;font-size:14px">깊게 빠진 쪽</h3>' +
            '<span class="badge blue">' + esc(cd.short) + '</span></div>' +
            '<p class="sub-line">' + esc(cd.name) + ' · 최대 ' + F.pct(cd.caseDd, 1) + '</p>' +
            '<p class="sub-line dim small">' + F.day(cd.date) + ' (고점 +' + cd.day + '일) · 거리 ' + F.num(cd.distance, 2) +
            ' → ' + fwdFar(cd) + '</p></div>' +
          '<div class="panel tight"><div class="panel-h"><h3 style="margin:0;font-size:14px">빨리 회복한 쪽</h3>' +
            '<span class="badge good">' + esc(cf.short) + '</span></div>' +
            '<p class="sub-line">' + esc(cf.name) + ' · 저점까지 ' + cf.caseDaysToTrough + ' · 회복 ' + cf.caseDaysToRecovery + '거래일</p>' +
            '<p class="sub-line dim small">' + F.day(cf.date) + ' (고점 +' + cf.day + '일) · 거리 ' + F.num(cf.distance, 2) +
            ' → ' + fwdFar(cf) + '</p></div>' +
        '</div>' +
        '<p class="note">닮은 정도는 ' + F.num(cd.distance, 2) + ' 대 ' + F.num(cf.distance, 2) +
        '입니다. 사례 경로가 252거래일까지만 있어 뒤를 오래 볼 수 있는 쪽과 없는 쪽이 갈리므로, 있는 값 중 가장 먼 지평을 적었습니다. ' +
        '한쪽만 보면 확증편향이 생깁니다.</p>';
    }

    /* 같은 경과일(+N) 비교 */
    var sameRows = cases.map(function (c) {
      return '<tr>' +
        '<td><span style="color:' + c.color + '">■</span> ' + esc(c.short) +
          ' <span class="dim small">' + esc(c.name) + '</span></td>' +
        '<td class="mono">' + (c.sameDay === null || c.sameDay === undefined ? '—' : F.pct(c.sameDay, 1)) + '</td>' +
        '<td class="mono">' + (c.now_match ? '+' + c.now_match.day + '일 · ' + F.pct(c.now_match.dd, 1) : '—') + '</td>' +
        '</tr>';
    }).join('');

    var pts = [];
    all.forEach(function (p) {
      if (analogFilter !== 'all' && p[0] !== analogFilter) return;
      var y = analogHorizon === 30 ? p[3] : analogHorizon === 90 ? p[4] : p[5];
      if (y === null || y === undefined) return;
      pts.push({
        x: p[2], y: y, color: Data.caseColor(p[0]),
        title: Data.caseName(p[0]) + ' · 고점+' + p[1] + '일 · 낙폭 ' + p[2].toFixed(1) + '% · ' + analogHorizon + '일 뒤 ' + y.toFixed(1) + '%'
      });
    });

    /* 기준 ±3%p 구간의 점들 — 사례 필터·지평이 이미 반영된 pts 에서 고른다.
       평균은 실제 점의 세로값에서만 낸다(없는 값을 지어내지 않는다). */
    var bandPts = pts.filter(function (p) { return Math.abs(p.x - focusDd) <= AVG_BAND + 1e-9; });
    var bandN = bandPts.length;
    var bandAvg = null;
    if (bandN) {
      var bsum = 0;
      bandPts.forEach(function (p) { bsum += p.y; });
      bandAvg = bsum / bandN;
    }
    var showAvg = bandAvg !== null && bandN >= AVG_MIN_N;

    /* 기준·평균 뱃지 — 390px 에서도 잘리지 않게 차트 위 줄에 둔다 */
    var baseBadge =
      '<span class="badge ' + (base.mode === 'live' ? 'live' : 'grey') + '" id="scatterBase" title="' +
        esc(base.mode === 'live'
          ? 'live.json ^NDX ' + idxNum(base.price) + ' · ' + (base.session || '') + ' ' + (base.at || '') +
            ' · 고점 ' + idxNum(base.live.peak) + ' 대비'
          : '^NDX 확정 종가 ' + idxNum(base.price) + ' · ' + F.day(now.as_of) + ' 종가 · 고점 ' + idxNum(now.peak_close) + ' 대비') + '">' +
        (base.mode === 'live' ? '실시간' : (base.missing ? '확정 종가 기준' : '확정 종가')) + ' ' + idxNum(base.price) + ' · 낙폭 ' + F.pct(base.dd, 1) + '</span>';
    if (base.missing) baseBadge += '<span class="dim small">실시간 값 없음</span>';
    var avgBadge = showAvg
      ? '<span class="badge" id="scatterAvg" data-n="' + bandN + '" data-avg="' + bandAvg.toFixed(2) +
          '" data-focus="' + focusDd + '" data-band="' + AVG_BAND + '" data-hor="' + analogHorizon + '"' +
          ' style="color:' + AVG_COLOR + ';border-color:#2f6f68;background:#17322f">' +
          '기준 ±' + AVG_BAND + '%p 평균 <b>' + F.pct(bandAvg, 1) + '</b> <span class="dim">(' + bandN + '일)</span></span>'
      : '<span class="badge grey" id="scatterAvg" data-n="' + bandN + '" data-focus="' + focusDd +
          '" data-band="' + AVG_BAND + '" data-hor="' + analogHorizon + '">기준 ±' + AVG_BAND + '%p 표본 부족(' + bandN + ')</span>';

    var allTrades = journal();
    var badTrades = allTrades.filter(function (r) { return r.principles && r.principles.pass === false; });
    var useTrades = verifyOnlyBad ? badTrades : allTrades;

    var trades = useTrades.map(function (r) {
      var ix = Data.indexOn(r.date);
      if (!ix) return null;
      var fw = Data.indexForward(r.date, 30);
      return { r: r, dd: ix.dd, ret: fw ? fw.ret : null, fw: fw };
    }).filter(Boolean);

    var markers = trades.filter(function (t) { return t.ret !== null; }).map(function (t) {
      return { x: t.dd, y: t.ret, color: '#e8ecf4', label: t.r.sym + ' ' + F.day(t.r.date).slice(5), r: 4 };
    });

    var near = Data.analogNear(focusDd, 6);
    var nearRows = near.map(function (p) {
      return '<tr>' +
        '<td><span style="color:' + Data.caseColor(p.id) + '">■</span> ' + esc(Data.caseName(p.id)) + '</td>' +
        '<td class="mono">+' + p.day + '</td>' +
        '<td class="mono">' + F.pct(p.dd, 1) + '</td>' +
        '<td class="mono">' + F.num(p.dist, 1) + '</td>' +
        '<td class="mono ' + (p.fwd30 < 0 ? 'neg' : 'pos') + '">' + F.pct(p.fwd30, 1) + '</td>' +
        '<td class="mono">' + F.pct(p.fwd90, 1) + '</td>' +
        '<td class="mono">' + F.pct(p.fwd180, 1) + '</td>' +
        '</tr>';
    }).join('');

    var tradeMatch = trades.map(function (t) {
      var n = Data.analogNear(t.dd, 1)[0];
      var bad = t.r.principles && t.r.principles.pass === false;
      return '<tr data-trade="' + t.r.id + '"' + (verifyTradeFocus === t.r.id ? ' class="focus"' : '') + '>' +
        '<td class="mono">' + F.day(t.r.date) + '</td>' +
        '<td><b>' + esc(t.r.sym) + '</b> <span class="badge ' + (t.r.side === '매수' ? 'blue' : 'amber') + '">' + esc(t.r.side) + '</span>' +
          (bad ? ' <span class="badge red">원칙 미통과</span>' : '') + '</td>' +
        '<td class="mono">' + F.pct(t.dd, 1) + '</td>' +
        '<td class="mono">' + (t.ret === null ? '<span class="dim">대기</span>' : F.pct(t.ret, 1)) + '</td>' +
        '<td>' + (n ? esc(Data.caseName(n.id)) + ' <span class="dim small">+' + n.day + '일 · 30일 뒤 ' + F.pct(n.fwd30, 1) + '</span>' : '—') + '</td>' +
        '<td>' + (t.ret === null ? '<span class="badge grey">대기 중</span>' : gradeBadge(t.r.side, t.ret)) +
          ' <button class="linkbtn" type="button" data-back="' + t.r.id + '">일지로</button></td>' +
        '</tr>';
    }).join('');

    var vrows = verifyRows();
    var ok = vrows.filter(function (v) { return v.grade === 'ok'; }).length;
    var no = vrows.filter(function (v) { return v.grade === 'no'; }).length;
    var wait = vrows.filter(function (v) { return v.grade === 'wait'; }).length;
    var rate = (ok + no) > 0 ? (ok / (ok + no) * 100) : null;

    var vHtml = vrows.map(function (v) {
      return '<tr>' +
        '<td class="mono">' + F.day(v.r.date) + '</td>' +
        '<td><span class="badge ' + (v.r.call === '매수' ? 'blue' : v.r.call === '매도' ? 'amber' : 'grey') + '">' + esc(v.r.call) + '</span></td>' +
        '<td class="wrap">' + esc(v.r.note || '—') + '</td>' +
        '<td class="mono">' + (v.ret === null ? '—' : F.pct(v.ret, 1)) + '</td>' +
        '<td>' + (v.f ? '<span class="dim small">' + F.day(v.f.from) + '→' + F.day(v.f.to) + '</span>' : '<span class="dim small">30거래일 뒤 자료 없음</span>') + '</td>' +
        '<td>' + gradeBadge(v.r.call, v.ret) + '</td>' +
        '<td><button class="linkbtn del" data-vdel="' + v.r.id + '" type="button">지운다</button></td>' +
        '</tr>';
    }).join('');

    view.innerHTML =
      (opts.embedded ? '' : '<section class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/journal">기록</a> / 검증 기록</div>' +
        '<h1>검증 기록</h1>' +
        '<p><b>나스닥 ^NDX 기준</b>입니다 — 사례마다 지금과 가장 닮은 하루를 찾아 그 뒤를 봅니다. 같은 낙폭으로도, 같은 경과일로도 값이 다르니 두 눈금을 같이 보세요. (반도체 SOX 8사례는 <a href="#/gauge">매수 지표</a>에서 반도체 SOXL을 고르면 나옵니다.)</p>' +
        '<p class="byline">글 · Verdictjang</p></section>') +

      '<div class="panel">' +
        '<div class="panel-h"><h2>사례별 가장 가까운 하루</h2>' +
          '<span class="note">원본 방식 — 네 지표 차이를 각 10눈금으로 나눈 평균이 가장 작은 날</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>순위</th><th>사례</th><th>매칭일</th><th>고점 후</th><th>그날 낙폭</th><th>200일선</th><th>RSI</th><th>VIX</th><th>거리</th>' +
          '<th>30일 뒤</th><th>90일 뒤</th><th>180일 뒤</th>' +
        '</tr></thead><tbody>' + matchRows + '</tbody></table></div>' +
        '<div class="notice" style="margin-top:10px">' +
          '<b>닮은 지점은 \'그때 이랬다\'만 알려줍니다.</b> \'그래서 그다음에 왜 그렇게 됐는지\'는 알려주지 않습니다.' +
          '<div class="dim small" style="margin-top:6px">지금: 고점 후 +' + now.offset + '거래일 · 낙폭 ' + F.pct(now.dd, 1) +
          ' · 200일선 ' + F.pct(now.gap, 1) + ' · RSI ' + F.num(now.rsi, 1) + ' · VIX ' + F.num(now.vix, 2) + ' (' + F.day(now.as_of) + ')</div>' +
          '<div class="dim small">1929·1987은 원본 자료에 VIX가 없어 <b>세 지표로만</b> 거리를 쟀습니다(VIX 칸 —, 거리에 \'3지표\' 표시). ' +
          '그래서 이 두 사례의 매칭일은 폭락 도중이 아니라 <b>폭락 뒤 반등 구간</b>(1988-03-25, 1930-05-01)일 수 있습니다 — 위 \'고점 후\'를 꼭 같이 보세요.</div>' +
        '</div>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>확증편향 방지 짝</h2><span class="note">깊게 빠진 쪽과 빨리 회복한 쪽을 함께</span></div>' +
        contrastHtml +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>같은 경과일로 맞추면</h2><span class="note">지금은 고점 후 +' + now.offset + '거래일</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>사례</th><th>그 사례의 +' + now.offset + '거래일 낙폭</th><th>그 사례에서 가장 닮은 날</th>' +
        '</tr></thead><tbody>' +
          '<tr><td><b>지금</b> <span class="dim small">^NDX</span></td><td class="mono"><b>' + F.pct(now.dd, 1) + '</b></td><td class="mono dim">—</td></tr>' +
          sameRows +
        '</tbody></table></div>' +
        '<p class="note">경과일이 같아도 낙폭은 사례마다 다릅니다. 원본 방식은 경과일이 아니라 지표 거리로 맞추므로, ' +
          '경과일을 같이 봐야 \'지금이 그때보다 더 빠졌는지\'가 드러납니다.</p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>과거 대입 산점도</h2>' +
          '<div class="tabs" style="margin-left:auto">' +
            [30, 90, 180].map(function (h) {
              return '<button class="chip ' + (analogHorizon === h ? 'on' : '') + '" data-hor="' + h + '">' + h + '일 뒤</button>';
            }).join('') +
          '</div></div>' +
        '<div class="pill-row" style="margin-bottom:10px">' +
          '<button class="chip ' + (analogFilter === 'all' ? 'on' : '') + '" data-case="all"><span class="dot" style="background:#9aa5b6"></span>전체</button>' +
          cases.map(function (c) {
            return '<button class="chip ' + (analogFilter === c.id ? 'on' : '') + '" data-case="' + c.id + '"><span class="dot" style="background:' + c.color + '"></span>' + esc(c.short) + '</button>';
          }).join('') +
        '</div>' +
        (analogFocus !== null ?
          '<div class="row" style="margin-bottom:8px"><span class="badge blue">닮은 날 기준 낙폭 ' + F.pct(analogFocus, 1) + '</span>' +
          '<span class="dim small">' + (analogFocusNote || '') + '</span>' +
          '<button class="linkbtn" type="button" id="focusReset">지금 낙폭으로 →</button></div>' : '') +
        '<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">' +
          '<button class="chip ' + (basis === 'close' ? 'on' : '') + '" type="button" data-bs="close">확정 종가</button>' +
          '<button class="chip ' + (basis === 'live' ? 'on' : '') + '" type="button" data-bs="live">실시간</button>' +
          baseBadge + avgBadge +
        '</div>' +
        '<div class="chart-box" id="scatter"></div>' +
        '<p class="note">가로축 고점 대비 낙폭(%), 세로축 ' + analogHorizon + '거래일 뒤 수익률(%). 점 하나가 사례의 하루입니다. ' +
          '흰 세로선이 기준 낙폭(' + F.pct(focusDd, 1) + '), 흰 마름모가 내 기록입니다. ' +
          '청록 가로선은 기준 낙폭 ±' + AVG_BAND + '%p 구간에 있던 과거 날들의 평균 수익률입니다' +
          (showAvg ? ' (' + bandN + '일)' : '') + ' — 구간 점이 ' + AVG_MIN_N + '개 미만이면 긋지 않습니다. ' +
          '기준은 매수 지표의 정규장/프리마켓 토글과 같은 설정입니다 — 실시간 값이 없으면 확정 종가로 둡니다.' +
          (base.mode === 'live' ? ' 지금 기준은 live.json ^NDX ' + idxNum(base.price) + ' · ' + (base.session || '') + ' ' + (base.at || '') + ' 값입니다.' : '') + '</p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>' + (analogFocus !== null ? '닮은 날' : '낙폭으로 찾은 날') + '</h2><span class="note">산점도 기준 · 낙폭 ' + F.pct(focusDd, 1) + '에 가까운 순</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>사례</th><th>고점 +경과일</th><th>낙폭</th><th>낙폭 차이(%p)</th><th>30일 뒤</th><th>90일 뒤</th><th>180일 뒤</th>' +
        '</tr></thead><tbody>' + nearRows + '</tbody></table></div>' +
        '<p class="note">같은 낙폭이라도 그 뒤는 갈렸습니다. 숫자는 그 사례 경로에서 계산한 실제 값입니다.</p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>내 기록의 닮은 날</h2>' +
          '<span class="spacer"></span>' +
          '<button class="chip ' + (verifyOnlyBad ? 'on' : '') + '" type="button" id="vBadFilter">원칙 위반 매매만 보기' + (badTrades.length ? ' (' + badTrades.length + ')' : '') + '</button>' +
        '</div>' +
        (trades.length ?
          '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
            '<th>내 기록</th><th>종목·구분</th><th>그날 지수 낙폭</th><th>30거래일 뒤</th><th>가장 닮은 날</th><th>채점</th>' +
          '</tr></thead><tbody>' + tradeMatch + '</tbody></table></div>'
          : '<div class="empty">' + (verifyOnlyBad ? '원칙을 통과하지 못한 매매가 없습니다.' : '매매일지에 기록이 있으면 여기에 겹쳐 보여 줍니다.') +
            ' <a href="#/journal">기록 남기기 →</a></div>') +
        '<p class="note">내 기록의 세로값은 ^NDX 30거래일 수익률입니다. 기록 날짜가 자료 범위(2024-11~) 밖이면 표시하지 않습니다.</p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>판단 남기기</h2><span class="note">30거래일 뒤 자동 채점</span></div>' +
        '<form id="vForm" class="form-grid">' +
          '<div class="field span2"><label for="vDate">날짜</label><input type="date" id="vDate" value="' + F.today() + '" required></div>' +
          '<div class="field"><label for="vCall">판단</label><select id="vCall">' +
            CALLS.map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</select></div>' +
          '<div class="field span3"><label for="vNote">근거 (한 줄)</label><input id="vNote" placeholder="예: 점수 98, VIX 36 — 계획의 25%만"></div>' +
          '<div class="field span2"><label>&nbsp;</label><button class="btn primary" type="submit">남기기</button></div>' +
        '</form>' +
        '<p class="note">채점 규칙 — 30거래일 뒤 ^NDX 수익률로 봅니다. 매수는 +면 ○, 매도는 −면 ○, 관망은 |수익률| 3% 안이면 ○. 30거래일이 아직 지나지 않았으면 대기 중입니다.</p>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>검증 기록</h2>' +
          '<span class="badge good">적중 ' + ok + '</span><span class="badge red">빗나감 ' + no + '</span>' +
          '<span class="badge grey">대기 ' + wait + '</span>' +
          (rate === null ? '' : '<span class="badge blue">적중률 ' + F.num(rate, 0) + '%</span>') + '</div>' +
        (vrows.length ?
          '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
            '<th>날짜</th><th>판단</th><th>근거</th><th>30거래일 수익률</th><th>구간</th><th>채점</th><th></th>' +
          '</tr></thead><tbody>' + vHtml + '</tbody></table></div>'
          : '<div class="empty">아직 남긴 판단이 없습니다.</div>') +
      '</div>';

    Charts.scatter(el('#scatter', view), {
      height: 360,
      points: pts,
      xMin: -95, xMax: 5,
      yMin: -45, yMax: 45,
      yTicks: [-40, -30, -20, -10, 0, 10, 20, 30, 40],
      xTicks: [-90, -80, -70, -60, -50, -40, -30, -20, -10, 0],
      xLabel: '고점 대비 낙폭 (%)',
      yLabel: analogHorizon + '일 뒤 수익률 (%)',
      markers: markers,
      bands: [{ x0: focusDd - AVG_BAND, x1: focusDd + AVG_BAND, color: 'rgba(63,208,192,0.09)' }],
      vlines: [{ x: focusDd, color: '#e8ecf4', label: '기준 ' + F.pct(focusDd, 1), dash: '4 4' }],
      hlines: [{ y: 0, color: '#5f7396' }].concat(showAvg
        ? [{ y: bandAvg, color: AVG_COLOR, width: 1.8, label: '평균 ' + F.pct(bandAvg, 1) + ' (' + bandN + '일)' }]
        : [])
    });

    on(view, 'click', '[data-bs]', function (e, t) {
      var want = t.getAttribute('data-bs');
      if (want === basis) return;
      setBasisMode(want);
      render();
    });

    on(view, 'click', '[data-hor]', function (e, t) {
      analogHorizon = Number(t.getAttribute('data-hor'));
      render();
    });
    on(view, 'click', '[data-case]', function (e, t) {
      analogFilter = t.getAttribute('data-case');
      render();
    });

    var fr = el('#focusReset', view);
    if (fr) fr.addEventListener('click', function () {
      analogFocus = null; analogFocusNote = ''; analogFilter = 'all';
      render();
    });

    el('#vBadFilter', view).addEventListener('click', function () {
      verifyOnlyBad = !verifyOnlyBad;
      render();
    });

    el('#vForm', view).addEventListener('submit', function (e) {
      e.preventDefault();
      var rec = {
        id: uid(),
        date: el('#vDate', view).value,
        call: el('#vCall', view).value,
        note: el('#vNote', view).value.trim()
      };
      if (!rec.date) { toast('날짜를 넣어 주세요.'); return; }
      var arr = verifyList();
      arr.push(rec);
      S.set(VERIFY_KEY, arr);
      render();
      toast('판단을 남겼습니다. 30거래일 뒤에 채점됩니다.');
    });

    on(view, 'click', '[data-vdel]', function (e, t) {
      var id = t.getAttribute('data-vdel');
      confirmBox({ title: '이 판단을 지울까요?', body: '지운 기록은 되돌릴 수 없습니다.', ok: '지운다' }, function () {
        S.set(VERIFY_KEY, verifyList().filter(function (r) { return r.id !== id; }));
        render();
        toast('지웠습니다.');
      });
    });

    /* 검증 → 일지: 그 매매를 일지에서 강조해 보여 준다(두 섹션이 서로 이어짐) */
    on(view, 'click', '[data-back]', function (e, t) {
      journalFocus = t.getAttribute('data-back');
      location.hash = '#/journal';
    });
  };

  /* ------------------------------------------------------------ 글 */
  V.readings = function (view) {
    var arts = Data.readings.articles;
    view.innerHTML =
      '<section class="hero"><div class="crumb"><a href="#/">홈</a> / 글</div>' +
        '<h1>글</h1><p>점수·사례·운용에 대해 남긴 글. 수치는 모두 이 사이트 자료에서 계산했습니다.</p>' +
        '<p class="byline">글 · Verdictjang</p></section>' +
      '<div class="read-grid">' + arts.map(function (a) {
        return '<a class="read-card" href="#/read/' + a.id + '">' +
          '<span class="tag">' + esc(a.tag) + ' · ' + F.day(a.date) + '</span>' +
          '<h3>' + esc(a.title) + '</h3><p>' + esc(a.summary) + '</p></a>';
      }).join('') + '</div>';
  };

  V.article = function (view, id) {
    var a = Data.readings.articles.filter(function (x) { return x.id === id; })[0];
    if (!a) { view.innerHTML = '<div class="empty">없는 글입니다. <a href="#/readings">글 목록으로</a></div>'; return; }
    view.innerHTML =
      '<article>' +
        '<section class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/readings">글</a></div>' +
          '<h1>' + esc(a.title) + '</h1>' +
          '<p class="byline">글 · ' + esc(a.author) + ' · ' + F.day(a.date) + ' · ' + esc(a.tag) + '</p></section>' +
        '<div class="panel article-body">' + a.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>' +
        '<div class="row"><a class="btn ghost" href="#/readings">← 글 목록</a><a class="btn ghost" href="#/">홈</a></div>' +
      '</article>';
  };

  V.notFound = function (view) {
    view.innerHTML = '<div class="empty" style="padding:60px 10px">' +
      '<p>없는 주소입니다.</p><p><a class="btn ghost" href="#/">홈으로</a></p></div>';
  };

  w.Views = V;
})(window);
