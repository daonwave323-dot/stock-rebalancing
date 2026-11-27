/* 증시 자료 — 정적 스냅샷(data/market.json) + 5분 갱신(data/live.json) 읽기.
   원본 앱(v2.7.0) MarketScreen.kt 의 규칙을 따른다:
     · 자료를 받지 못하면 실패를 표시하고 이전 값을 지우지 않는다.
     · 없는 값은 null 로 두고 화면에서 '—' 로 보여 준다(0으로 바꾸지 않는다).
     · [정규장] = 정규장 값(정규장 밖이면 직전 종가), [프리마켓] = 정규장 밖 모든 세션의 최근 체결.
   시세를 지어내지 않는다. 값마다 출처와 기준 시각을 함께 돌려준다. */
(function (w) {
  'use strict';

  var M = {
    ready: false, snap: null, live: null, liveAt: 0, liveErr: '',
    candles: null, candlesLoading: false,
    err: '', triedAt: 0
  };

  var KEY_US = 'watch.us', KEY_KR = 'watch.kr';
  var DEFAULT_WATCH = {
    us: [{ sym: 'TQQQ', name: '나스닥 3배' }, { sym: 'SOXL', name: '반도체 3배' }],
    kr: []
  };

  function getJSON(path, optional) {
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    }).catch(function (e) {
      if (optional) return null;
      throw e;
    });
  }

  M.load = function () {
    if (M.ready) return Promise.resolve(M);
    M.triedAt = Date.now();
    return Promise.all([
      getJSON('data/market.json'),
      getJSON('data/live.json', true)
    ]).then(function (a) {
      M.snap = a[0];
      // 자리표시(updatedAt 없음)는 '없는 것'으로 본다 — 값을 지어내지 않는다.
      M.live = (a[1] && a[1].updatedAt) ? a[1] : null;
      M.liveAt = M.live ? Date.parse(M.live.updatedAt) : 0;
      M.ready = true;
      M.err = '';
      return M;
    }).catch(function (e) {
      M.err = String((e && e.message) || e);
      throw e;
    });
  };

  /* 5분 파이프라인이 아직 안 돌았거나 새 값이 있으면 다시 읽는다(값이 있으면 지우지 않는다). */
  M.refreshLive = function () {
    return getJSON('data/live.json', true).then(function (js) {
      if (js && js.updatedAt) {
        M.live = js;
        M.liveAt = Date.parse(js.updatedAt);
        M.liveErr = '';
      }
      return js;
    }).catch(function (e) {
      M.liveErr = String((e && e.message) || e);
      return null;
    });
  };

  M.loadCandles = function () {
    if (M.candles) return Promise.resolve(M.candles);
    if (M.candlesLoading) return M._candlePromise;
    M.candlesLoading = true;
    M._candlePromise = getJSON('data/candles.json').then(function (js) {
      M.candles = js;
      M.candlesLoading = false;
      return js;
    }).catch(function (e) {
      M.candlesLoading = false;
      M.candlesErr = String((e && e.message) || e);
      return { symbols: {} };
    });
    return M._candlePromise;
  };

  /* ------------------------------------------------------------ 시장·심볼 */
  M.marketOf = function (sym) {
    if (/^\d{6}$/.test(String(sym || ''))) return 'kr';
    var s = M.sym(sym);
    if (s && s.market) return s.market;
    return 'us';
  };

  M.sym = function (sym) {
    if (!sym) return null;
    return (M.snap && M.snap.symbols && M.snap.symbols[sym]) || null;
  };

  M.liveSym = function (sym) {
    if (!M.live || !M.live.symbols) return null;
    var S2 = M.live.symbols;
    return S2[sym] || S2[sym + '.KS'] || S2[sym + '.KQ'] ||
      (String(sym).indexOf('.') > 0 ? S2[String(sym).split('.')[0]] : null) || null;
  };

  /* 스냅샷 + 실시간을 합친 한 종목. 실시간이 있으면 그 값을 우선한다. */
  M.quote = function (sym) {
    var s = M.sym(sym), l = M.liveSym(sym);
    if (!s && !l) return null;
    var out = {
      sym: sym,
      name: (s && (s.name || s.desc)) || (l && l.name) || sym,
      desc: (s && s.desc) || '',
      market: (s && s.market) || (/^\d{6}$/.test(sym) ? 'kr' : 'us'),
      cur: (s && s.cur) || (l && l.currency) || 'USD',
      exch: (s && (s.exch || s.board)) || '',
      sector: (s && s.sector) || '',
      industry: (s && s.industry) || '',
      // 정규장 기준값 — 5분 갱신(live.json)이 있으면 그 값이 더 새 값이다.
      regPrice: (l && l.regularClose != null) ? l.regularClose
        : ((l && l.last != null) ? l.last : (s ? s.price : null)),
      regChg: (l && l.changePct != null) ? l.changePct : (s ? s.chg : null),
      vol: (l && l.volume != null) ? l.volume : (s ? s.vol : null),
      val: (s && s.val) != null ? s.val : null,
      mcap: (l && l.marketCap != null) ? l.marketCap : (s ? s.mcap : null),
      mcapAt: (s && s.mcap != null) ? (M.snap.generatedAt || '') : (l ? l.marketCapAsOf : null),
      mcapKrw: null,
      snapAt: M.snap ? M.snap.generatedAt : '',
      src: (s && s.src) || (l && l.source) || '',
      live: l || null,
      raw: s || null
    };
    if (out.mcapKrw == null && out.mcap != null) {
      out.mcapKrw = out.cur === 'KRW' ? out.mcap : (l && l.marketCapKrw) || (M.fx() ? out.mcap * M.fx() : null);
    }
    return out;
  };

  M.fx = function () {
    if (M.live && M.live.fx && M.live.fx.usdkrw) return M.live.fx.usdkrw;
    if (M.snap && M.snap.fx && M.snap.fx.usdkrw) return M.snap.fx.usdkrw;
    return null;
  };

  /* 기준(정규장/프리마켓)에 따른 지금 값. 원본 MarketBoard.BASIS_* 규칙. */
  M.look = function (sym, basis) {
    var q = M.quote(sym);
    if (!q) return null;
    var l = q.live;
    if (basis !== 'after') {
      return {
        price: q.regPrice, chg: q.regChg, at: (l && l.regularCloseTime) || q.snapAt,
        session: 'regular', note: '정규장', src: q.src, vol: q.vol
      };
    }
    // [프리마켓] = 정규장 밖 모든 세션의 최근 체결. 장외 체결이 없으면 값을 만들지 않는다.
    if (l && (l.session === 'pre' || l.session === 'post')) {
      return {
        price: l.sessionPrice != null ? l.sessionPrice : l.last,
        chg: l.sessionChangePct != null ? l.sessionChangePct : l.changePct,
        at: l.sessionTime || l.lastTime, session: l.session,
        note: l.sessionLabel || (l.session === 'pre' ? '프리마켓' : '애프터마켓'),
        src: l.source, vol: l.volume
      };
    }
    if (l && l.session === 'regular') {
      return { price: q.regPrice, chg: q.regChg, at: l.lastTime || l.regularCloseTime, session: 'regular',
        note: '정규장', src: q.src, vol: q.vol };
    }
    if (l && l.session === 'closed') {
      return { price: q.regPrice, chg: q.regChg, at: l.regularCloseTime || l.lastTime, session: 'closed',
        note: '장 마감 · 장외 체결 없음', src: q.src, vol: q.vol };
    }
    return { price: null, chg: null, at: null, session: '', note: '장외 시세 없음(5분 갱신 전)', src: q.src, vol: null };
  };

  M.sessionOf = function (market) {
    if (market === 'kr') return { label: '국내', note: '국내 정규장 09:00~15:30 KST · 값은 네이버 지연 시세' };
    var l = M.live && M.live.market;
    if (l) return { label: l.sessionLabel || l.session || '', note: (l.et || '') + ' · ' + (l.note || '') };
    return { label: '미국', note: '미 동부 정규장 09:30~16:00 · 값은 트레이딩뷰 지연 시세' };
  };

  M.liveText = function () {
    if (!M.live) return M.liveErr ? '5분 갱신 파일 없음(' + M.liveErr.slice(0, 40) + ') — 스냅샷으로 표시' : '5분 갱신 파일 없음 — 스냅샷으로 표시';
    var kst = M.live.updatedAtKst || '';
    var ses = M.live.market ? (M.live.market.sessionLabel || '') : '';
    return '5분 갱신 ' + (kst || '시각 없음') + (ses ? ' · ' + ses : '') + ' · 지연될 수 있음';
  };

  /* ------------------------------------------------------------ 관심 종목 */
  function readWatch(market) {
    var key = market === 'kr' ? KEY_KR : KEY_US;
    var v = w.S ? S.get(key, null) : null;
    if (!v) return DEFAULT_WATCH[market].slice();
    return Array.isArray(v) ? v : [];
  }
  M.watch = function (market) { return readWatch(market); };
  M.setWatch = function (market, list) {
    var key = market === 'kr' ? KEY_KR : KEY_US;
    S.set(key, list.map(function (x) { return { sym: x.sym, name: x.name || x.sym }; }));
  };
  M.inWatch = function (market, sym) {
    return readWatch(market).some(function (x) { return String(x.sym).toUpperCase() === String(sym).toUpperCase(); });
  };
  M.addWatch = function (market, sym, name) {
    var list = readWatch(market);
    if (list.some(function (x) { return String(x.sym).toUpperCase() === String(sym).toUpperCase(); })) return false;
    list.push({ sym: sym, name: name || sym });
    M.setWatch(market, list);
    return true;
  };
  M.removeWatch = function (market, sym) {
    M.setWatch(market, readWatch(market).filter(function (x) {
      return String(x.sym).toUpperCase() !== String(sym).toUpperCase();
    }));
  };
  M.moveWatch = function (market, sym, delta) {
    var list = readWatch(market);
    var i = list.findIndex(function (x) { return x.sym === sym; });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return false;
    var t = list[i]; list[i] = list[j]; list[j] = t;
    M.setWatch(market, list);
    return true;
  };

  /* ------------------------------------------------------------ 검색 */
  M.all = function (market) {
    var out = [];
    var seen = {};
    if (M.snap && M.snap.symbols) {
      Object.keys(M.snap.symbols).forEach(function (k) {
        var r = M.snap.symbols[k];
        if (market && r.market !== market) return;
        if (seen[k]) return;
        seen[k] = 1;
        out.push({ sym: k, name: r.name || r.desc || k, desc: r.desc || '', market: r.market,
          exch: r.exch || r.board || '', mcap: r.mcap });
      });
    }
    if (M.live && M.live.symbols) {
      Object.keys(M.live.symbols).forEach(function (k) {
        var l = M.live.symbols[k];
        var mk = /^\d{6}$/.test(k) ? 'kr' : 'us';
        if (market && mk !== market) return;
        if (seen[k]) return;
        seen[k] = 1;
        out.push({ sym: k, name: l.name || k, desc: '', market: mk, exch: '', mcap: l.marketCap });
      });
    }
    return out;
  };

  M.search = function (q, market, limit) {
    var t = String(q || '').trim();
    if (!t) return [];
    var up = t.toUpperCase();
    var pool = M.all(market);
    var hits = [];
    for (var i = 0; i < pool.length; i++) {
      var x = pool[i];
      var s = String(x.sym).toUpperCase(), n = String(x.name || ''), d = String(x.desc || '');
      var score = 0;
      if (s === up) score = 100;
      else if (s.indexOf(up) === 0) score = 80;
      else if (n.toUpperCase().indexOf(up) === 0) score = 70;
      else if (n.toUpperCase().indexOf(up) > 0) score = 55;
      else if (d.toUpperCase().indexOf(up) >= 0) score = 40;
      if (!score) continue;
      hits.push({ sym: x.sym, name: x.name, desc: x.desc, market: x.market, exch: x.exch,
        mcap: x.mcap, score: score + (x.mcap ? Math.min(9, Math.log10(x.mcap + 1)) : 0) });
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, limit || 8);
  };

  /* 스냅샷·live 에 없는 티커 — 공개 소스를 브라우저가 직접 받아 본다.
     CORS 로 막히면 그 사실을 그대로 돌려준다(값을 지어내지 않는다). */
  M.probe = function (sym) {
    var s = String(sym || '').trim().toUpperCase();
    if (!s) return Promise.resolve({ ok: false, reason: '티커가 비었습니다' });
    var q = M.quote(s);
    if (q) return Promise.resolve({ ok: true, quote: q, via: 'snapshot/live' });
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s) + '?range=5d&interval=1d';
    var ctl = w.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    return fetch(url, { mode: 'cors', signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (js) {
        var res = js && js.chart && js.chart.result && js.chart.result[0];
        if (!res) throw new Error('응답에 값이 없습니다');
        var meta = res.meta || {};
        var px = meta.regularMarketPrice;
        if (px == null) throw new Error('가격이 없습니다');
        return { ok: true, via: 'direct', quote: {
          sym: s, name: meta.shortName || s, desc: '', market: /^\d{6}$/.test(s) ? 'kr' : 'us',
          cur: meta.currency || 'USD', exch: meta.exchangeName || '', sector: '', industry: '',
          regPrice: px, regChg: (meta.previousClose ? (px / meta.previousClose - 1) * 100 : null),
          vol: meta.regularMarketVolume, val: null, mcap: null, mcapKrw: null, mcapAt: null,
          snapAt: new Date().toISOString(), src: 'yahoo direct', live: null, raw: null
        } };
      })
      .catch(function (e) {
        clearTimeout(timer);
        var msg = String(e && (e.message || e));
        if (e && e.name === 'AbortError') msg = '시간 초과(6초)';
        var cors = /Failed to fetch|NetworkError|Load failed/i.test(msg);
        return { ok: false, reason: cors ? '브라우저 직접 조회 차단(CORS 또는 네트워크)' : msg };
      });
  };

  /* ------------------------------------------------------------ 표기 */
  var CUR = { USD: '$', KRW: '₩' };

  M.price = function (v, cur) {
    if (v == null || isNaN(v)) return '—';
    var d = (cur === 'KRW') ? 0 : (v >= 1000 ? 2 : (v >= 1 ? 2 : 4));
    return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  M.cur = function (v, cur) {
    var p = M.price(v, cur);
    return p === '—' ? '—' : (CUR[cur] || '') + p;
  };
  M.pct = function (v) {
    if (v == null || isNaN(v)) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  };
  M.pct1 = function (v) {
    if (v == null || isNaN(v)) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  };

  /* 시가총액 — 원화는 조·억, 달러는 조 달러·억 달러(원 환산 병기). */
  M.cap = function (v, cur, fx) {
    if (v == null || isNaN(v) || v <= 0) return '—';
    if (cur === 'KRW') {
      if (v >= 1e12) return (v / 1e12).toFixed(v >= 1e13 ? 0 : 2).replace(/\.00$/, '') + '조원';
      if (v >= 1e8) return Math.round(v / 1e8).toLocaleString('ko-KR') + '억원';
      return Math.round(v).toLocaleString('ko-KR') + '원';
    }
    var t = v / 1e12;
    var head = t >= 1 ? (t >= 100 ? t.toFixed(0) : t.toFixed(2).replace(/\.?0+$/, '')) + '조 달러'
      : (v / 1e8 >= 1 ? Math.round(v / 1e8).toLocaleString('ko-KR') + '억 달러'
        : Math.round(v).toLocaleString('ko-KR') + '달러');
    if (fx && v >= 1e10) head += ' (약 ' + Math.round(v * fx / 1e12).toLocaleString('ko-KR') + '조원)';
    return head;
  };

  M.vol = function (v) {
    if (v == null || isNaN(v)) return '—';
    var n = Number(v);
    if (n >= 1e8) return (n / 1e8).toFixed(1) + '억주';
    if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만주';
    return Math.round(n).toLocaleString('ko-KR');
  };

  M.money = function (v, cur) {
    if (v == null || isNaN(v)) return '—';
    if (cur === 'KRW') return M.cap(v, 'KRW');
    if (v >= 1e12) return (v / 1e12).toFixed(2) + '조 달러';
    if (v >= 1e8) return (v / 1e8).toFixed(0) + '억 달러';
    if (v >= 1e4) return (v / 1e4).toFixed(0) + '만 달러';
    return '$' + Math.round(v).toLocaleString('ko-KR');
  };

  M.time = function (iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    if (isNaN(t)) return '—';
    var d = new Date(t);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  /* 등락 색 — 국내식(상승 빨강·하락 파랑) / 미국식(상승 초록·하락 빨강).
     가격 숫자(.px)는 늘 연두색이고, 등락에만 이 색을 쓴다. */
  M.tone = function (v, market) {
    if (v == null || isNaN(v) || Number(v) === 0) return 'flat';
    var up = Number(v) > 0;
    if (market === 'kr') return up ? 'up kr' : 'dn kr';
    // 원본 SettingsScreen 의 '숫자 색' 설정 — 미국 화면에만 적용(국내는 늘 국내식).
    var pref = (w.S ? S.get('look', null) : null) || {};
    if (pref.numColors === 'kr') return up ? 'up kr' : 'dn kr';
    return up ? 'up us' : 'dn us';
  };

  /* ------------------------------------------------------------ 정렬·집계 */
  M.sortRows = function (rows, key, dir) {
    var d = dir === 'asc' ? 1 : -1;
    var pick = {
      cap: function (r) { return r.mcap; },
      value: function (r) { return r.val; },
      gain: function (r) { return r.chg; },
      loss: function (r) { return r.chg; },
      price: function (r) { return r.price; },
      vol: function (r) { return r.vol; },
      name: function (r) { return null; }
    }[key] || function (r) { return r.mcap; };
    return rows.slice().sort(function (a, b) {
      if (key === 'name') return String(a.name || a.sym).localeCompare(String(b.name || b.sym), 'ko') * d;
      if (key === 'loss') return ((a.chg == null ? 1e9 : a.chg) - (b.chg == null ? 1e9 : b.chg)) * -d * -1;
      var va = pick(a), vb = pick(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * d;
    });
  };

  /* 섹터 묶음 — 원본 SectorAgg.group: 시가총액 상위 250, 시총 가중 평균 등락률. */
  M.sectorCells = function (market, basis) {
    var rows = M.rows(market, basis).filter(function (r) {
      return r.mcap > 0 && r.chg != null && r.sector;
    }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 250);
    var by = {};
    rows.forEach(function (r) {
      var k = w.NameKo ? NameKo.gic(r.sector) : r.sector;
      if (!by[k]) by[k] = { name: k, sectorEn: r.sector, mcap: 0, count: 0, wsum: 0 };
      by[k].mcap += r.mcap; by[k].count++; by[k].wsum += r.mcap * r.chg;
    });
    var out = Object.keys(by).map(function (k) {
      var c = by[k];
      return { name: c.name, sectorEn: c.sectorEn, mcap: c.mcap,
        chg: c.mcap > 0 ? c.wsum / c.mcap : null, count: c.count };
    });
    out.sort(function (a, b) { return b.mcap - a.mcap; });
    return out;
  };

  M.industryCells = function (market, sectorEn, basis) {
    var rows = M.rows(market, basis).filter(function (r) {
      return r.sector === sectorEn || (w.NameKo && NameKo.gic(r.sector) === sectorEn);
    });
    var by = {};
    rows.forEach(function (r) {
      var k = r.industry || '업종 미분류';
      if (!by[k]) by[k] = { name: k, industryEn: r.industry, mcap: 0, count: 0, wsum: 0, up: 0, down: 0 };
      by[k].mcap += r.mcap || 0; by[k].count++;
      if (r.chg != null) { by[k].wsum += (r.mcap || 0) * r.chg; if (r.chg > 0) by[k].up++; else if (r.chg < 0) by[k].down++; }
    });
    var out = Object.keys(by).map(function (k) {
      var c = by[k];
      return { name: k, industryEn: c.industryEn, mcap: c.mcap, count: c.count,
        chg: c.mcap > 0 ? c.wsum / c.mcap : null, up: c.up, down: c.down };
    });
    out.sort(function (a, b) { return b.mcap - a.mcap; });
    return out;
  };

  /* 시장의 종목 줄(기준 적용). 마켓맵·순위·업종이 같은 자료를 쓴다. */
  M.rows = function (market, basis) {
    var list = M.all(market);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var q = M.quote(list[i].sym);
      if (!q) continue;
      var lk = M.look(list[i].sym, basis);
      if (!lk) continue;
      out.push({
        sym: q.sym, name: q.name, desc: q.desc, market: q.market, exch: q.exch,
        cur: q.cur, sector: q.sector, industry: q.industry,
        price: lk.price, chg: lk.chg, vol: lk.vol, at: lk.at,
        regPrice: q.regPrice, regChg: q.regChg,
        val: (lk.price != null && lk.vol != null) ? lk.price * lk.vol : q.val,
        mcap: q.mcap, mcapKrw: q.mcapKrw, src: lk.src, note: lk.note, session: lk.session,
        raw: q.raw
      });
    }
    return out;
  };

  /* 지수 — 스냅샷의 지수 칸 값. live 에 ^NDX/^VIX 가 있으면 같이 보여 준다. */
  M.indices = function (market, basis) {
    var mk = (M.snap && M.snap.markets && M.snap.markets[market]) || {};
    var out = (mk.indices || []).map(function (x) {
      var live = market === 'us' ? M.liveSym(x.sym) : null;
      var price = x.price, chg = x.chg, at = M.snap.generatedAt, note = '스냅샷';
      if (live) {
        var lk = basis === 'after'
          ? ((live.session === 'pre' || live.session === 'post') ? live.sessionPrice : null)
          : live.regularClose;
        if (lk != null) { price = lk; at = live.sessionTime || live.regularCloseTime; note = live.sessionLabel || '5분 갱신'; }
        if (live.changePct != null) chg = live.changePct;
      }
      return { sym: x.sym, name: x.name, proxy: x.proxy, price: price, chg: chg, at: at, note: note };
    });
    if (market === 'us') {
      [['^NDX', '나스닥 종합지수'], ['^VIX', 'VIX 변동성']].forEach(function (p) {
        var l = M.liveSym(p[0]);
        if (!l) return;
        out.push({ sym: p[0], name: p[1], proxy: '5분 갱신', price: l.last, chg: l.changePct,
          at: l.lastTime, note: l.sessionLabel || '' });
      });
    }
    return out;
  };

  w.Mkt = M;
})(window);
