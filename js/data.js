/* 자료 불러오기와 조회 도구 */
(function (w) {
  'use strict';

  var D = {
    scores: null, crashes: null, crashesSox: null, analog: null, readings: null, ready: false
  };

  function getJSON(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    });
  }

  D.load = function () {
    return Promise.all([
      getJSON('data/scores.json'),
      getJSON('data/crashes.json'),
      getJSON('data/analog.json'),
      getJSON('data/readings.json'),
      getJSON('data/crashes_sox.json').catch(function () { return null; })
    ]).then(function (a) {
      D.scores = a[0]; D.crashes = a[1]; D.analog = a[2]; D.readings = a[3]; D.crashesSox = a[4];
      D.ready = true;
      return D;
    });
  };

  D.asOf = function () { return D.scores.as_of; };

  D.target = function (key) { return D.scores.targets[key]; };

  /* 그 날(또는 그 전 마지막 거래일)의 점수·낙폭 */
  D.scoreOn = function (date) {
    var daily = D.scores.history.daily, weekly = D.scores.history.weekly;
    var best = null, exact = false;
    for (var i = 0; i < daily.length; i++) {
      if (daily[i][0] <= date) { best = daily[i]; exact = (daily[i][0] === date); } else break;
    }
    if (best) return { date: best[0], ndx: best[1], sox: best[2], ndxDd: best[3], soxDd: best[4], exact: exact, source: 'daily' };
    for (var j = 0; j < weekly.length; j++) {
      if (weekly[j][0] <= date) { best = weekly[j]; exact = (weekly[j][0] === date); } else break;
    }
    if (best) return { date: best[0], ndx: best[1], sox: best[2], ndxDd: null, soxDd: null, exact: exact, source: 'weekly' };
    return null;
  };

  /* 지수(^NDX) 종가·낙폭 — 그 날 또는 그 전 마지막 거래일 */
  D.indexOn = function (date) {
    var s = D.scores.index, best = null, exact = false;
    for (var i = 0; i < s.length; i++) {
      if (s[i][0] <= date) { best = s[i]; exact = (s[i][0] === date); } else break;
    }
    if (!best) return null;
    return { date: best[0], close: best[1], dd: best[2], exact: exact };
  };

  /* 지수 기준 n거래일 뒤 수익률(%). 그 날이 없으면 null */
  D.indexForward = function (date, n) {
    var s = D.scores.index;
    var i0 = -1, i1 = -1;
    for (var i = 0; i < s.length; i++) if (s[i][0] <= date) i0 = i;
    if (i0 < 0) return null;
    i1 = i0 + n;
    if (i1 >= s.length) return null;
    return {
      from: s[i0][0], to: s[i1][0],
      start: s[i0][1], end: s[i1][1],
      ret: Math.round(((s[i1][1] / s[i0][1]) - 1) * 10000) / 100
    };
  };

  /* '지금' 지표 — 나스닥(^NDX) 기준 */
  D.now = function () { return D.crashes.now; };

  /* 폭락 자료 한 벌 — 대상에 따라 나스닥(6사례·^NDX) / 반도체(8사례·SOX).
     화면은 이 함수만 거쳐 대상을 바꾸므로, 두 벌의 틀(표·카드·차트)이 같다. */
  D.crashSet = function (t) {
    if (t === 'sox' && D.crashesSox) return D.crashesSox;
    return D.crashes;
  };

  /* 지금 지표 — 대상별(나스닥 ^NDX / 반도체 ^SOX). 필드 이름은 두 벌이 같다. */
  D.nowFor = function (t) {
    if (t === 'sox' && D.crashesSox) {
      var n = D.crashesSox.now, m = D.crashesSox.cur_metrics || {};
      return {
        as_of: n.as_of, source: '야후 ^SOX 일봉 종가', index: 'SOX', close: n.close,
        dd: n.dd_now, peak_date: n.peak, peak_close: n.peak_close,
        trough: n.trough, trough_close: n.trough_close,
        dd_trough: n.dd, days_since_trough: n.days_since_trough, months: n.months_since_peak,
        above_trough: n.above_trough,
        offset: n.days_since_peak || (n.lastI - n.peakI),
        gap: m.gap, rsi: m.rsi, vix: m.vix,
        vix_ratio: m.vix_ratio, vix_pct: m.vix_pct,
        window_note: '^SOX 일봉 종가(야후 파이낸스)로 계산했습니다. 고점 ' + n.peak + ' → ' + n.as_of + '까지 ' +
          (n.lastI - n.peakI) + '거래일 · 저점 ' + n.trough + '(고점 대비 ' + (n.dd) + '%)'
      };
    }
    return D.crashes.now;
  };

  /* 2단계 업황·금리 브레이크 — 반도체에만 있다(나스닥은 null) */
  D.brake = function (t) {
    return (t === 'sox' && D.crashesSox) ? D.crashesSox.brake : null;
  };

  /* 90점 단독 vs 2단계 필터 백테스트 — 반도체에만 */
  D.backtest = function (t) {
    return (t === 'sox' && D.crashesSox) ? D.crashesSox.backtest : null;
  };

  D.caseById = function (id) {
    var sets = [D.crashes.cases, (D.crashesSox && D.crashesSox.cases) || []];
    for (var s = 0; s < sets.length; s++) {
      for (var i = 0; i < sets[s].length; i++) if (sets[s][i].id === id) return sets[s][i];
    }
    return null;
  };

  /* 그 사례가 어느 벌(나스닥/반도체)인지 — 상세 페이지의 이전·다음·목록 주소가 이걸 따른다 */
  D.caseSet = function (id) {
    if (D.crashesSox) {
      for (var i = 0; i < D.crashesSox.cases.length; i++) if (D.crashesSox.cases[i].id === id) return D.crashesSox;
    }
    return D.crashes;
  };
  D.caseTarget = function (id) { return D.caseSet(id) === D.crashesSox ? 'sox' : 'ndx'; };

  /* 지금 낙폭과 가장 닮은 사례(전 사례 중 거리 최소) */
  D.closestCase = function () {
    var cases = D.crashes.cases.filter(function (c) { return c.now_match; });
    if (!cases.length) return null;
    cases.sort(function (a, b) { return a.now_match.distance - b.now_match.distance; });
    return cases[0];
  };

  /* 낙폭 하나로 사례별 '가장 닮은 날' (검증 기록 산점도용) */
  D.analogNear = function (dd, n) {
    var pts = D.analog.points, out = [];
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][3] === null || pts[i][3] === undefined) continue;
      out.push({ id: pts[i][0], day: pts[i][1], dd: pts[i][2], fwd30: pts[i][3], fwd90: pts[i][4], fwd180: pts[i][5], dist: Math.abs(pts[i][2] - dd) });
    }
    out.sort(function (a, b) { return a.dist - b.dist; });
    if (n) out = out.slice(0, n);
    return out;
  };

  D.caseName = function (id) {
    var c = D.caseById(id);
    return c ? c.short + ' ' + c.name : id;
  };

  D.caseColor = function (id) {
    var c = D.caseById(id);
    return c ? c.color : '#6a9ae0';
  };

  w.Data = D;
})(window);
