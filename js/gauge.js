/* 매수 지표 탭 — 원본 앱 GaugeScreen(밸류게이지) 을 웹으로 옮긴 화면.
 *
 * 원본 구성(위에서 아래로): 대상 칩·가격 → 기준 줄 → 값 직접 입력(접힘) → 밸류게이지 카드 →
 * 지표 추적(접힘) → 문턱 통계 → 육각 레이더 → 최근 한 달 두 차트 → 전체 흐름 → 폭락 비교(접힘).
 *
 * 계산은 원본 core/Singularity.kt 와 같은 식이다(가중치·경계·클램프 그대로). 값이 없는 지표는
 * 빼고 남은 가중치 합으로 나눈다. 과거 통계·일봉·주별 이력은 data/gauge.json 에 미리 계산해 두었다.
 */
(function (w) {
  'use strict';

  var V = w.Views;
  if (!V) return;

  /* 여섯 지표 — 원본 Singularity.INDICATORS 그대로 */
  var IND = [
    { key: 'dd', name: '고점 대비 낙폭', w: 0.30, min: 0, max: 95, step: 0.5, unit: '%' },
    { key: 'wrsi', name: '주간 RSI(14주)', w: 0.20, min: 10, max: 90, step: 0.5, unit: '' },
    { key: 'vixr', name: 'VIX / 50일 평균', w: 0.15, min: 0.5, max: 3, step: 0.01, unit: 'x' },
    { key: 'gap', name: '200일선 이격', w: 0.15, min: -95, max: 20, step: 0.5, unit: '%' },
    { key: 'drsi', name: '일간 RSI(14)', w: 0.10, min: 10, max: 90, step: 0.5, unit: '' },
    { key: 'vixp', name: '공포 백분위', w: 0.10, min: 0, max: 100, step: 1, unit: '' }
  ];
  var AXES = [['dd', '연중낙폭'], ['wrsi', '주간RSI'], ['drsi', '일간RSI'], ['vixr', 'VIX이격'], ['gap', '200일선'], ['vixp', '심리']];
  var SHORT = { dd: '낙폭', wrsi: '주간RSI', drsi: '일간RSI', vixr: 'VIX이격', gap: '200일선', vixp: '심리' };
  var BUY = 90;

  /* 라우터가 화면을 다시 그리면 #view 노드가 바뀐다 — 콜백 안에서는 잡아 둔 노드 대신 이걸 쓴다 */
  function liveView() { return document.getElementById('view'); }

  var ST = { target: 'ndx', mode: 'auto', manual: {}, open: {}, edited: false };
  /* 화면 값 한 벌의 캐시 — 대상·기준(정규장/프리마켓)·모드(자동/수동)가 바뀌면 새로 만든다 */
  var CUR = { key: null, values: null };
  var crashScale = 'peak';

  /* ------------------------------------------------------------ 계산(원본과 같은 식) */

  function clamp(x) { return isNaN(x) ? 0 : Math.max(0, Math.min(100, x)); }

  function convert(key, v, target) {
    if (key === 'dd') return clamp(v / (target === 'ndx' ? 12 : 20) * 100);
    if (key === 'wrsi') return clamp((70 - v) / 40 * 100);
    if (key === 'vixr') return clamp((v - 1) / 0.4 * 100);
    if (key === 'gap') return clamp(-v / 30 * 100);
    if (key === 'drsi') return clamp((50 - v) / 20 * 100);
    if (key === 'vixp') return clamp(v);
    return 0;
  }

  function scoreOf(values, target) {
    var ws = 0, sum = 0, rows = [];
    IND.forEach(function (spec) {
      var v = values[spec.key];
      var has = (v !== null && v !== undefined && !isNaN(v));
      var conv = has ? convert(spec.key, v, target) : null;
      if (has) { ws += spec.w; sum += conv * spec.w; }
      rows.push({
        key: spec.key, name: spec.name, w: spec.w, unit: spec.unit,
        value: has ? v : null, converted: conv, contribution: has ? conv * spec.w : null
      });
    });
    var raw = ws > 0 ? sum / ws : 0;
    return { raw: raw, score: Math.round(raw * 10) / 10, rows: rows, weightSum: ws, sum: sum };
  }

  /* 원본 Singularity.verdict — 경계 90·80·70·50, 문구 그대로 */
  function verdictOf(s) {
    if (s >= 90) return { label: '계획의 50% 투입', sub: '1년에 한 번 수준으로 오는 자리입니다', tone: 'good', level: 90 };
    if (s >= 80) return { label: '계획의 25% 투입', sub: '1차 진입 자리입니다', tone: 'blue', level: 80 };
    if (s >= 70) return { label: '계획의 25% 투입', sub: '바닥의 시작 구간입니다', tone: 'purple', level: 70 };
    if (s >= 50) return { label: '관망', sub: '조정은 맞지만 아직 아닙니다', tone: 'amber', level: 50 };
    return { label: '신규 매수 아님', sub: '아직 바닥 자리가 아닙니다', tone: 'grey', level: 0 };
  }

  function badgeOf(s) { return s >= BUY ? '매수' : (s >= 50 ? '관망' : '신규 매수 아님'); }

  function trim1(v) {
    var s = Number(v).toFixed(1);
    return s.replace(/\.0$/, '');
  }

  function fmtVal(key, v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (key === 'vixr') return Number(v).toFixed(2);
    if (key === 'dd') return '-' + Number(v).toFixed(1);
    return trim1(v);
  }

  function axesOf(values, target) {
    return AXES.map(function (a) {
      var raw = values[a[0]];
      return {
        key: a[0], name: a[1], raw: raw,
        score: (raw === null || raw === undefined || isNaN(raw)) ? null : convert(a[0], raw, target)
      };
    });
  }

  function shortNames(list) { return list.map(function (x) { return SHORT[x] || x; }).join('·'); }

  function contribText(result) {
    var rows = result.rows.filter(function (r) { return r.converted !== null; });
    if (!rows.length) return '지표 값을 받지 못했습니다';
    var max = Math.max.apply(null, rows.map(function (r) { return r.converted; }));
    var min = Math.min.apply(null, rows.map(function (r) { return r.converted; }));
    var strong = rows.filter(function (r) { return r.converted >= max - 0.5; }).map(function (r) { return SHORT[r.key]; });
    var weak = rows.filter(function (r) { return r.converted === min; }).map(function (r) { return SHORT[r.key]; });
    return '가장 강한 ' + strong.join('·') + ' ' + Math.round(max) + ' · 가장 약한 ' + weak.join('·') + ' ' + Math.round(min);
  }

  function stateHtml(axes, score) {
    var scored = axes.filter(function (a) { return a.score !== null; });
    var full = scored.filter(function (a) { return a.score >= 95; });
    var weak = null;
    scored.forEach(function (a) { if (!weak || a.score < weak.score) weak = a; });
    var above = score >= BUY;
    var verdict = score >= 90 ? '공포 우위' : (score >= 70 ? '중립' : '위험 선호');
    var cls = score >= 90 ? 'good' : (score >= 70 ? 'mid' : 'bad');
    var out = '<b>' + trim1(score) + '</b>점 · 만점 <b>' + full.length + '</b>축';
    if (full.length) out += '(' + shortNames(full.map(function (x) { return x.key; })) + ')';
    if (weak) out += ' · 최약 ' + SHORT[weak.key] + ' <b>' + Math.round(weak.score) + '</b>';
    out += ' · 문턱 <b>' + BUY + '</b> ' + (above ? '위' : '아래') + ' → <span class="' + cls + '">' + verdict + '</span>';
    return out;
  }

  /* ------------------------------------------------------------ 상태 */
  function loadState() {
    var s = S.get('gauge', {}) || {};
    ST.target = s.target === 'sox' ? 'sox' : 'ndx';
    ST.mode = s.mode === 'manual' ? 'manual' : 'auto';
    ST.manual = s.manual || {};
    ST.open = s.open || {};
    CUR = { key: null, values: null };
  }
  function saveState() {
    S.set('gauge', { target: ST.target, mode: ST.mode, manual: ST.manual, open: ST.open });
  }

  /* 화면의 '지금' 값 — live.js 가 Data.scores 를 더 새 값으로 갈아 끼웠으면 그것을 따른다
     (홈과 매수 지표가 같은 날짜·같은 숫자를 쓰게). 통계·일봉은 gauge.json(원본 자산) 그대로. */
  function latest(t) {
    var T = Data.gauge.targets[t];
    var base = Data.gauge.as_of;
    /* 확정(종가) 값은 5분 파이프라인이 live.json 에 매일 새로 넣는다(마지막 완료 정규장).
       gauge.json 보다 새로우면 그것을 먼저 쓴다 — 화면마다 확정 날짜가 어긋나지 않게. */
    var c = (w.Basis && Basis.confirmed) ? Basis.confirmed(t) : null;
    if (c && c.asOf && base && c.asOf > base) {
      var cdet = Object.assign({}, T.detail);
      if (c.close !== null && c.close !== undefined) cdet.close = c.close;
      if (c.peak) cdet.peak = c.peak;
      if (c.ma200) cdet.ma200 = c.ma200;
      if (c.vix !== null && c.vix !== undefined) cdet.vix = c.vix;
      if (c.ma50_vix !== null && c.ma50_vix !== undefined) cdet.ma50_vix = c.ma50_vix;
      if (c.vix_samples) cdet.vix_samples = c.vix_samples;
      return { rows: c.rows, as_of: c.asOf, detail: cdet, score: c.score };
    }
    var sc = Data.scores && Data.scores.targets ? Data.scores.targets[t] : null;
    if (sc && sc.rows && sc.rows.length && sc.as_of && base && sc.as_of > base) {
      var det = sc.detail || T.detail;
      if (det && det.vix === undefined && T.detail) det = Object.assign({}, T.detail, det);
      return { rows: sc.rows, as_of: sc.as_of, detail: det, score: sc.score };
    }
    return { rows: T.rows, as_of: base, detail: T.detail, score: T.score };
  }

  function autoValues(t) {
    var src = latest(t), o = {};
    src.rows.forEach(function (r) {
      if (r.raw === null || r.raw === undefined) { o[r.key] = null; return; }
      o[r.key] = r.key === 'dd' ? Math.abs(r.raw) : r.raw;
    });
    return o;
  }

  /* 지금 화면이 쓰는 값 한 벌.
     · 수동 — 내가 넣은 값이 최우선(실시간·확정이 덮어쓰지 않는다).
     · 자동 + 프리마켓 — live.json 의 지금 값으로 다시 낸 여섯 지표(없으면 확정 종가).
     · 자동 + 정규장 — 마지막 확정 종가의 여섯 지표. */
  function curValues(t, basis, pair) {
    var key = t + '|' + basis + '|' + ST.mode;
    if (CUR.key === key && CUR.values) return CUR.values;
    var v;
    if (ST.mode === 'manual' && ST.manual[t]) {
      v = autoValues(t);
      IND.forEach(function (spec) {
        var x = ST.manual[t][spec.key];
        if (x !== null && x !== undefined && !isNaN(x)) v[spec.key] = Number(x);
      });
    } else if (basis === 'live' && pair && pair.values) {
      v = {};
      IND.forEach(function (spec) {
        var x = pair.values[spec.key];
        v[spec.key] = (x === null || x === undefined || isNaN(x)) ? null : Number(x);
      });
    } else {
      v = autoValues(t);
    }
    CUR = { key: key, values: v };
    return v;
  }

  function valuesRef(t) {
    var basis = w.Basis ? Basis.get() : 'close';
    var pair = (basis === 'live' && w.Basis && Basis.liveFor) ? Basis.liveFor(t) : null;
    return curValues(t, basis, pair);
  }

  function dropValues() { CUR = { key: null, values: null }; }

  /* 점수·막대·판정 문구·레이더·기여도·오늘 선이 모두 이 한 벌에서 나온다(값을 섞지 않는다).
     반올림 규칙은 홈과 같다 — live.json 이 계산해 둔 점수(확정 score / 추정 scoreLive)를 먼저 쓰고,
     없거나 손으로 만졌을 때만 여기서 다시 낸다. */
  function snapshot(t) {
    var L = latest(t);
    var basis = w.Basis ? Basis.get() : 'close';
    var pair = (basis === 'live' && w.Basis && Basis.liveFor) ? Basis.liveFor(t) : null;
    var values = curValues(t, basis, pair);
    var calc = scoreOf(values, t);
    var shown;
    if (ST.mode === 'manual' || ST.edited) {
      shown = calc.score;
    } else if (basis === 'live' && pair && pair.score !== null && pair.score !== undefined) {
      shown = pair.score;
    } else if (L.score !== null && L.score !== undefined) {
      shown = L.score;
    } else {
      shown = calc.score;
    }
    var result = { raw: calc.raw, score: shown, rows: calc.rows, weightSum: calc.weightSum, sum: calc.sum };
    return {
      t: t, L: L, basis: basis, pair: pair, values: values, result: result,
      verdict: verdictOf(shown), axes: axesOf(values, t), manual: ST.mode === 'manual'
    };
  }

  /* live.json 의 지표 추적용 정보 — 점수·값·시각·세션·화면 갱신 시각 */
  function liveInfo(t) {
    if (!w.Basis || !Basis.meta) return null;
    return Basis.meta(t);
  }

  function etPart(meta) {
    if (!meta) return '';
    return (meta.atEt || '') + (meta.sessionLabel ? ' · ' + meta.sessionLabel : '');
  }

  /* 가격 — 고른 모드·기준에 따라 확정 종가 / 실시간 체결가 / 지표에서 역산한 값.
     역산은 낙폭(price = 5년 최고 × (1 − dd/100))과 200일선 이격(price = 200일선 × (1 + gap/100))
     두 지표에서만 된다(RSI·VIX는 과거 시계열이 있어야 해서 가격으로 되돌릴 수 없다).
     둘 다 유효할 때는 마지막으로 손댄 지표를 기준으로 삼는다(ST.priceSrc). */
  function priceInfo(snap) {
    var T = Data.gauge.targets[snap.t];
    var d = (snap.L && snap.L.detail) || T.detail || {};
    var v = snap.values || {};
    var peak = Number(d.peak), ma200 = Number(d.ma200);
    var dd = v.dd, gap = v.gap;
    var pDd = (peak > 0 && dd !== null && dd !== undefined && !isNaN(dd)) ? peak * (1 - Math.abs(dd) / 100) : null;
    var pGap = (ma200 > 0 && gap !== null && gap !== undefined && !isNaN(gap)) ? ma200 * (1 + gap / 100) : null;
    var src = (ST.priceSrc && ST.priceSrc.t === snap.t) ? ST.priceSrc.key : null;
    var touched = snap.manual || ST.edited || !!src;
    var px = null, kind = 'close';
    if (touched) {
      if (src === 'gap' && pGap) { px = pGap; kind = 'gap'; }
      else if (src === 'dd' && pDd) { px = pDd; kind = 'dd'; }
      else if (src === 'price' && ST.priceVal) { px = ST.priceVal; kind = 'price'; }
      else if (pDd) { px = pDd; kind = 'dd'; }
      else if (pGap) { px = pGap; kind = 'gap'; }
      else if (ST.priceVal) { px = ST.priceVal; kind = 'price'; }
      else { px = Number(d.close); kind = 'close'; }
    } else if (snap.basis === 'live' && snap.pair && snap.pair.price) {
      px = Number(snap.pair.price); kind = 'live';
    } else {
      px = Number(d.close); kind = 'close';
    }
    var tag = { dd: '역산 · 낙폭', gap: '역산 · 200일선', price: '직접 입력', live: '실시간 체결', close: '확정 종가' }[kind];
    var cls = { dd: 'amber', gap: 'amber', price: 'blue', live: 'live', close: 'grey' }[kind];
    return { price: px, kind: kind, tag: tag, badgeCls: cls, ddPrice: pDd, gapPrice: pGap, peak: peak, ma200: ma200, close: Number(d.close) };
  }

  function priceNoteHtml(snap, info) {
    var v = snap.values || {};
    var ddTxt = (v.dd === null || v.dd === undefined) ? '—' : F.signed(-Math.abs(v.dd), 1) + '%';
    var gapTxt = (v.gap === null || v.gap === undefined) ? '—' : F.signed(v.gap, 1) + '%';
    var head;
    if (info.kind === 'dd') {
      head = '가격은 낙폭 ' + ddTxt + '에서 역산' +
        (info.gapPrice ? ' · 200일선 이격 ' + gapTxt + '로 세우면 $' + F.fixed(info.gapPrice, 2) : '');
    } else if (info.kind === 'gap') {
      head = '가격은 200일선 이격 ' + gapTxt + '에서 역산' +
        (info.ddPrice ? ' · 낙폭 ' + ddTxt + '로 세우면 $' + F.fixed(info.ddPrice, 2) : '');
    } else if (info.kind === 'price') {
      head = '내가 넣은 가격' + (info.ddPrice ? ' · 낙폭 ' + ddTxt : '') + (info.gapPrice ? ' · 200일선 이격 ' + gapTxt : '');
    } else if (info.kind === 'live') {
      head = '실시간 체결가 · 5분마다 data/live.json 이 갱신';
    } else {
      head = '확정 종가 · ' + F.day(snap.L.as_of);
    }
    var tail = info.kind === 'close' ? ''
      : ' · 확정 종가 $' + F.fixed(info.close, 2) + (snap.L.as_of ? '(' + F.day(snap.L.as_of) + ')' : '');
    var cant = ST.edited || snap.manual
      ? '<br><span class="g-noinv">가격 역산은 낙폭·200일선 이격 두 지표에서만 됩니다(RSI·VIX는 과거 시계열이 필요해 가격으로 되돌릴 수 없습니다).</span>'
      : '';
    return esc(head + tail) + cant;
  }

  function duoHtml(snap, meta) {
    var L = snap.L;
    var out = '<span class="pair ' + (snap.basis === 'close' && !snap.manual ? 'on' : '') + '">' +
      '<span>확정</span><b>' + (L.score === null || L.score === undefined ? '—' : trim1(L.score)) + '</b>' +
      '<i>' + F.day(L.as_of) + ' 종가' + (snap.basis === 'close' && !snap.manual ? ' · 지금 화면' : '') + '</i></span>';
    if (meta) {
      out += '<span class="pair ' + (snap.basis === 'live' && !snap.manual ? 'on' : '') + '">' +
        '<span>실시간(추정)</span><b>' + (meta.score === null || meta.score === undefined ? '—' : trim1(meta.score)) + '</b>' +
        '<i>' + esc(etPart(meta) || '값 없음') + (snap.basis === 'live' && !snap.manual ? ' · 지금 화면' : '') + '</i></span>';
    }
    if (snap.manual) {
      out += '<span class="pair on"><span>직접 입력</span><b>' + trim1(snap.result.score) + '</b><i>내가 넣은 값 · 지금 화면</i></span>';
    }
    return '<div class="g-duo" id="gDuo">' + out + '</div>';
  }

  function srcNoteHtml(meta) {
    if (!meta) return 'data/live.json 을 아직 받지 못했습니다 — 확정 종가로만 계산합니다.';
    var stale = '';
    if (meta.ageMin !== null && meta.ageMin > 30) {
      stale = ' <span class="warn">· ' + meta.ageMin + '분째 그대로 — 자동 갱신이 멈췄을 수 있습니다</span>';
    }
    return 'data/live.json · 5분마다 갱신(GitHub Actions) · 마지막 갱신 ' + esc(meta.updatedAtKst || '—') + ' KST' + stale;
  }

  function modeSegHtml() {
    return '<span class="g-seg" role="group" aria-label="입력 모드">' +
      '<button type="button" data-mode="auto" class="' + (ST.mode === 'auto' ? 'on' : '') + '">자동</button>' +
      '<button type="button" data-mode="manual" class="' + (ST.mode === 'manual' ? 'on' : '') + '">수동</button>' +
    '</span>';
  }

  function basisSegHtml(snap) {
    var b = snap.basis;
    return '<span class="g-seg" role="group" aria-label="시세 기준">' +
      '<button type="button" data-basis="close" class="' + (b === 'close' ? 'on' : '') + '">확정 종가</button>' +
      '<button type="button" data-basis="live" class="' + (b === 'live' ? 'on' : '') + '">실시간(프리마켓)</button>' +
    '</span>';
  }

  function basisBadgeHtml(snap, meta) {
    /* snap.manual 이면 기준 전환은 참고용 — 값은 내가 넣은 값 그대로 */
    var on = snap.manual ? '직접 입력값'
      : (snap.basis === 'live'
        ? (snap.pair ? '실시간(추정) · ' + (etPart(meta) || '시각 없음') : '실시간 값 없음 — 확정 종가')
        : '확정 종가 · ' + F.day(snap.L.as_of));
    var cls = snap.manual ? 'blue' : (snap.basis === 'live' && snap.pair ? 'live' : 'grey');
    return '<span class="badge ' + cls + '">' + esc(on) + '</span>';
  }

  /* ------------------------------------------------------------ 그리기 도구 */
  function radarSvg(axes) {
    var W = 340, H = 300, cx = W / 2, cy = H / 2 + 6, R = 100;
    var n = axes.length;
    function pt(i, frac) {
      var a = Math.PI * (-0.5 + 2 * i / n);
      return [cx + R * frac * Math.cos(a), cy + R * frac * Math.sin(a)];
    }
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="밸류게이지 육각 레이더 — 여섯 지표">'];
    /* 격자 — 원본은 네 겹 */
    for (var ring = 1; ring <= 4; ring++) {
      var pts = [];
      for (var i = 0; i < n; i++) { var p = pt(i, ring / 4); pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      s.push('<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--line)" stroke-width="1"/>');
    }
    for (var j = 0; j < n; j++) {
      var e = pt(j, 1);
      s.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>');
    }
    /* 값 다각형 */
    var vpts = [];
    for (var k = 0; k < n; k++) {
      var v = (axes[k].score === null ? 0 : Math.max(0, Math.min(100, axes[k].score))) / 100;
      var q = pt(k, v);
      vpts.push(q[0].toFixed(1) + ',' + q[1].toFixed(1));
    }
    s.push('<polygon points="' + vpts.join(' ') + '" fill="var(--green)" fill-opacity="0.16" stroke="var(--green)" stroke-width="1.8" stroke-linejoin="round"/>');
    for (var m = 0; m < n; m++) {
      var vv = (axes[m].score === null ? 0 : Math.max(0, Math.min(100, axes[m].score))) / 100;
      var p2 = pt(m, vv);
      s.push('<circle cx="' + p2[0].toFixed(1) + '" cy="' + p2[1].toFixed(1) + '" r="3" fill="var(--green)"/>');
    }
    /* 이름·값 — 도형 바깥 */
    for (var t = 0; t < n; t++) {
      var a2 = Math.PI * (-0.5 + 2 * t / n);
      var cos = Math.cos(a2), sin = Math.sin(a2);
      var lx = cx + (R + 8) * cos, ly = cy + (R + 8) * sin;
      var anchor = cos > 0.3 ? 'start' : (cos < -0.3 ? 'end' : 'middle');
      var ny = sin < -0.3 ? ly - 13 : (sin > 0.3 ? ly + 4 : ly - 2);
      var vy = sin < -0.3 ? ly + 1 : ny + 13;
      s.push('<text x="' + lx.toFixed(1) + '" y="' + ny.toFixed(1) + '" text-anchor="' + anchor +
        '" font-size="11" fill="var(--dim)">' + esc(axes[t].name) + '</text>');
      var sc = axes[t].score;
      var col = sc === null ? 'var(--dim)' : (sc >= BUY ? 'var(--green)' : 'var(--tx)');
      s.push('<text x="' + lx.toFixed(1) + '" y="' + vy.toFixed(1) + '" text-anchor="' + anchor +
        '" font-size="12" font-weight="700" fill="' + col + '">' + (sc === null ? '—' : Math.round(sc)) + '</text>');
    }
    s.push('</svg>');
    return s.join('');
  }

  function candleSvg(bars, liveDate, nowPx, nowTag) {
    if (!bars || !bars.length) return '<div class="empty">일봉 자료 없음</div>';
    var W = 720, H = 170, pad = { l: 44, r: 10, t: 14, b: 22 };
    var lo = Math.min.apply(null, bars.map(function (b) { return b[3]; }));
    var hi = Math.max.apply(null, bars.map(function (b) { return b[2]; }));
    if (hi === lo) hi = lo + 1;
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var bw = Math.max(2, Math.min(12, iw / bars.length * 0.62));
    var x = function (i) { return pad.l + (i + 0.5) * (iw / bars.length); };
    var y = function (v) { return pad.t + ih - (v - lo) / (hi - lo) * ih; };
    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="주가 최근 한 달 일봉 ' + bars.length + '일치">'];
    var ticks = [lo, (lo + hi) / 2, hi];
    ticks.forEach(function (v) {
      s.push('<line x1="' + pad.l + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y(v).toFixed(1) + '" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/>');
      s.push('<text x="' + (pad.l - 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--dim)">' + Number(v).toFixed(2) + '</text>');
    });
    /* 이 구간 최저가 점선 */
    s.push('<line x1="' + pad.l + '" y1="' + y(lo).toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y(lo).toFixed(1) + '" stroke="var(--amber)" stroke-width="1" stroke-dasharray="4 4"/>');
    var liveIdx = -1;
    bars.forEach(function (b, i) {
      var up = b[4] >= b[1];
      var col = up ? 'var(--green)' : 'var(--red)';
      var isLive = liveDate && b[0] === liveDate;
      if (isLive) { liveIdx = i; col = 'var(--amber)'; }
      s.push('<line x1="' + x(i).toFixed(1) + '" y1="' + y(b[2]).toFixed(1) + '" x2="' + x(i).toFixed(1) + '" y2="' + y(b[3]).toFixed(1) + '" stroke="' + col + '" stroke-width="1"' + (isLive ? ' stroke-dasharray="3 2" stroke-opacity="0.75"' : '') + '/>');
      var y0 = y(Math.max(b[1], b[4])), y1 = y(Math.min(b[1], b[4]));
      s.push('<rect x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, y1 - y0).toFixed(1) + '" fill="' + col + '"' + (isLive ? ' fill-opacity="0.45" stroke="' + col + '" stroke-dasharray="3 2"' : '') + '/>');
    });
    if (liveIdx >= 0) {
      var bl = bars[liveIdx];
      s.push('<circle cx="' + x(liveIdx).toFixed(1) + '" cy="' + y(bl[4]).toFixed(1) + '" r="3.5" fill="var(--amber)"/>');
    }
    /* 지금 가격 — 지표를 손대면 낙폭·200일선 이격에서 역산한 값이 여기로 움직인다 */
    if (nowPx && nowPx > 0 && nowPx >= lo * 0.9 && nowPx <= hi * 1.1) {
      var yNow = y(nowPx);
      s.push('<line x1="' + pad.l + '" y1="' + yNow.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + yNow.toFixed(1) + '" stroke="var(--amber)" stroke-width="1" stroke-dasharray="5 4" stroke-opacity="0.8"/>');
      s.push('<text x="' + (W - pad.r - 2) + '" y="' + (yNow - 6).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="var(--amber)">지금 $' + Number(nowPx).toFixed(2) + (nowTag ? ' · ' + nowTag : '') + '</text>');
    }
    s.push('</svg>');
    return s.join('');
  }

  /* 최근 한 달 봉 — live.json 의 dayBars(5분 파이프라인이 5년 일봉에서 잘라 쓴 것)를 먼저,
     없으면 gauge.json 의 한 달 봉을 쓴다. */
  function monthBars(t) {
    var e = (w.Basis && Basis.dayBars) ? Basis.dayBars(t) : null;
    return (e && e.length) ? e : ((Data.gauge.candles || {})[t] || []);
  }

  function barSummary(bars, liveDate) {
    if (!bars || !bars.length) return '일봉 자료가 없습니다.';
    var cs = bars.map(function (b) { return b[4]; });
    var hi = Math.max.apply(null, bars.map(function (b) { return b[2]; }));
    var lo = Math.min.apply(null, bars.map(function (b) { return b[3]; }));
    return bars[0][0] + '~' + bars[bars.length - 1][0] + ' · ' + bars.length + '일치 · 시작 $' + Number(cs[0]).toFixed(2) +
      ' → 끝 $' + Number(cs[cs.length - 1]).toFixed(2) + ' · 최고 $' + Number(hi).toFixed(2) + ' · 최저 $' + Number(lo).toFixed(2) +
      (liveDate && bars[bars.length - 1][0] === liveDate ? ' · 마지막 봉은 장중(점선)' : '');
  }

  /* 최근 한 달 점수 선 — 자료(gauge.json month) 끝에 지금 점수(같은 여섯 값)를 이어 붙인다 */
  function monthScorePts(t, snap) {
    var pts = (Data.gauge.month || []).map(function (p) {
      return [p[0], t === 'ndx' ? p[1] : p[2]];
    }).filter(function (p) { return p[1] > 0; });
    var last = snap.L.as_of, sc = snap.result.score;
    if (last && sc !== null && sc !== undefined) {
      if (!pts.length || last > pts[pts.length - 1][0]) pts.push([last, sc]);
      else if (last === pts[pts.length - 1][0]) pts[pts.length - 1][1] = sc;
    }
    return pts;
  }

  function section(key, title, subtitle, body, forcedOpen) {
    var open = forcedOpen || !!ST.open[key];
    return '<section class="panel g-sec" data-sec="' + key + '">' +
      '<button class="g-sechead" type="button" data-toggle="' + key + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="t">' + esc(title) + '<span class="mark">' + (open ? '접기 ▴' : '펼치기 ▾') + '</span></span>' +
        (subtitle ? '<span class="s">' + subtitle + '</span>' : '') +
      '</button>' +
      '<div class="g-secbody"' + (open ? '' : ' hidden') + '>' + body + '</div>' +
    '</section>';
  }

  /* ------------------------------------------------------------ 화면 */

  V.gauge = function (view, detailId) {
    if (ST.target === undefined) loadState();
    var G = Data.gauge;
    if (!G) { view.innerHTML = '<div class="loading">매수 지표 자료를 불러오는 중…</div>'; return; }
    if (detailId) { gaugeCaseView(view, detailId); return; }
    if (!G.axes) G.axes = AXES;

    var t = ST.target, T = G.targets[t];
    var snap = snapshot(t);
    var L = snap.L, values = snap.values, result = snap.result, v = snap.verdict, axes = snap.axes;
    var D = L.detail, S_ = T.stat;
    var meta = liveInfo(t);
    var info = priceInfo(snap);

    var chips = '<button type="button" class="g-chip-target ' + (t === 'ndx' ? 'on' : '') + '" data-target="ndx">나스닥 TQQQ</button>' +
      '<button type="button" class="g-chip-target ' + (t === 'sox' ? 'on' : '') + '" data-target="sox">반도체 SOXL</button>';

    /* 1) 대상·가격·기준 — 가격은 고른 모드·기준에 따라 확정 종가 / 실시간 체결가 / 역산값 */
    var head =
      '<div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:2px">' +
        '<div class="row">' + chips + '</div>' +
        '<div class="g-price"><span id="gPrice">$' + F.fixed(info.price, 2) + '</span> ' +
          '<span class="badge ' + info.badgeCls + '" id="gPriceTag">' + esc(info.tag) + '</span></div>' +
      '</div>' +
      '<p class="g-basis" id="gPriceNote">' + priceNoteHtml(snap, info) + '</p>' +
      duoHtml(snap, meta) +
      '<p class="g-src" id="gSrc">' + srcNoteHtml(meta) + '</p>';

    /* 3) 밸류게이지 카드 */
    var topPanel = gaugeTopHtml(snap, T, G);

    var rar = rarityOf(t);
    var gaugeCard =
      '<article class="panel g-card">' +
        '<div class="g-head"><h2>매수지표 · 밸류게이지</h2><span class="note">(높을수록 저평가·공포)</span>' +
          '<span class="spacer"></span><span class="badge ' + (result.score >= BUY ? 'good' : 'grey') + '" id="gBadge">' + badgeOf(result.score) + '</span></div>' +
        '<div class="g-score"><b id="gScore">' + trim1(result.score) + '</b><span>/ ' + BUY + ' 이상 매수</span></div>' +
        '<div class="g-verdict g-tone-' + v.tone + '" id="gVerdict">' + esc(v.label) + '</div>' +
        '<div class="g-verdict-sub" id="gVerdictSub">' + esc(v.sub) + '</div>' +
        '<div class="g-bar"><i id="gBar" style="width:' + Math.max(0, Math.min(100, result.score)) + '%"></i><em></em></div>' +
        '<div class="g-scale"><span>0</span><span>50</span><span>' + BUY + '</span><span>100</span></div>' +
        '<div class="g-hint" id="gHint">' + (result.score >= BUY
          ? '지금 매수 구간(' + BUY + ' 이상)입니다'
          : '매수 구간(' + BUY + ')까지 ' + trim1(BUY - result.score) + '점 남았습니다') + '</div>' +
        '<div class="g-rarity" id="gRarity">🎯 ' + esc(rar ? rar.text : '기록 없음') + '</div>' +
        '<div class="g-contrib" id="gContrib">' + esc(contribText(result)) + '</div>' +
      '</article>' +
      '<p class="note" id="gRarityNote">' + rarityNoteHtml(rar, t) + '</p>';

    /* 4) 문턱 통계 */
    var statBlock =
      '<div class="g-stat">📄 최근 1년간 이 수준(≥' + BUY + ')까지 온 하락 <b class="num">' + S_.yearHits + '번</b></div>' +
      '<div class="g-stat up">📈 그 수준 첫 진입일 샀다면 1년 뒤 표본 <b class="num">' + S_.samples + '번</b> 중 <b class="num">' + S_.ups + '번</b> 상승 · 중앙 수익률 ' +
        (S_.median === null ? '—' : '<b class="num">' + F.pct(S_.median, 1) + '</b>') + '</div>' +
      '<p class="note">표본 ' + S_.samples + '번' + (S_.missing ? '(1년 뒤 자료 없음 ' + S_.missing + '번 제외)' : '') +
        ' · 희소성 = 전 구간 ' + BUY + ' 첫 진입일 사이 평균 간격(연속일은 세지 않음)' +
        ' · 1년 뒤 = 1년 뒤 가장 가까운 거래일 종가 · 일봉 ' + F.day(S_.from) + '~' + F.day(S_.to) +
        (S_.samples <= 4 ? ' · 표본이 적어 참고만 하세요' : '') +
        ' <a class="linkbtn" href="#/score/' + t + '">원본 앱 값과 대조·점수 상세 →</a></p>';

    /* 5) 육각 레이더 */
    var radarCard =
      '<article class="panel">' +
        '<div class="g-sub">밸류에이션 · 여섯 지표</div>' +
        '<div class="g-cap">바깥으로 갈수록 저평가·공포(100).</div>' +
        '<div class="g-radar" id="gRadar">' + radarSvg(axes) + '</div>' +
        '<p class="g-state" id="gState">' + stateHtml(axes, result.score) + '</p>' +
      '</article>';

    /* 6) 최근 한 달 두 차트 — 일봉(마지막 봉·지금 점)과 점수 선 */
    var candles = monthBars(t);
    var liveD = meta && meta.barLive ? meta.barLive : null;
    var monthPts = monthScorePts(t, snap);
    var mMin = monthPts.length ? Math.min.apply(null, monthPts.map(function (p) { return p[1]; })) : 0;
    var mMax = monthPts.length ? Math.max.apply(null, monthPts.map(function (p) { return p[1]; })) : 0;
    var summary = barSummary(candles, liveD);

    var chartsCard =
      '<article class="panel">' +
        '<div class="g-sub">주가 · 최근 한 달 일봉</div>' +
        '<div class="g-cap">' + (liveD ? '실선 = 확정 봉, 점선·연한 봉 = 장중(지금). ' : '실선 = 확정 봉. ') +
          '점선 = 이 구간 최저가 · 가로 점선 = 지금 가격</div>' +
        '<div class="chart-box" id="gBars">' + candleSvg(candles, liveD, info.price, info.tag) + '</div>' +
        '<p class="g-cap" id="gBarsSum">' + esc(summary) + '</p>' +
        '<div class="g-sub mt">밸류게이지 · 최근 한 달</div>' +
        '<div class="g-cap">' + (monthPts.length >= 2
          ? '일별 · 이 구간 ' + Math.round(mMin) + '~' + Math.round(mMax) + ' · 점선 ' + BUY + ' · 오른쪽 끝 = 지금 점수'
          : '이력이 쌓이는 중 ' + monthPts.length + '일치') + '</div>' +
        '<div class="chart-box" id="gMonth"></div>' +
      '</article>';

    /* 7) 전체 흐름 */
    var weekly = (G.weekly[t] || []);
    var flowCard =
      '<article class="panel">' +
        '<div class="g-sub">밸류게이지 전체 흐름 (주별 최고값 · ● 오늘)</div>' +
        '<div class="g-cap">' + (weekly.length >= 3
          ? '주별 최고값 · 주 ' + weekly.length + '개 · 세로축 30~100 · ' + F.day(weekly[0][0]) + ' ~ ' + F.day(weekly[weekly.length - 1][0]) + ' · 점선 = 매수 ' + BUY
          : '이력이 쌓이는 중 — ' + weekly.length + '주치') + '</div>' +
        '<div class="chart-box" id="gFlow"></div>' +
        '<p class="note">' + (G.events[t] || []).map(function (e) {
          var label = { dotcom: '닷컴', lehman: '리먼', covid: '코로나', tariff: '관세', today: '오늘' }[e.id] || e.id;
          var sc = e.id === 'today' ? result.score : e.score;
          return label + ' ' + (e.id === 'today' ? F.day(L.as_of) : e.date.slice(0, 4)) + ' ' + trim1(sc);
        }).join(' · ') + '</p>' +
        '<p class="note">점수는 그날까지의 자료만으로 계산했습니다(미래 자료가 섞이지 않게). 2002·2008은 이 사이트의 주별 이력(2011~) 밖이라 그래프가 아니라 위 글줄에만 적었습니다.</p>' +
      '</article>';

    /* 8) 지표 기록·버블·산식 (접힘, 밸류게이지 카드 바로 아래) — 입력부는 위 topPanel 하나뿐 */
    var track = trackingHtml(t, values, result, snap);
    /* 9) 폭락 비교 (접힘) */
    var crashHtml = crashSectionHtml(detailId);

    var crashOpen = !!ST.open.crash || isCrashPath();
    view.innerHTML =
      '<section class="hero g-hero"><div class="crumb"><a href="#/">홈</a> / 매수 지표</div>' +
        '<h1>매수 지표</h1>' +
        '<p>여섯 지표를 0~100으로 환산해 가중 평균한 <b>밸류게이지</b>입니다. 높을수록 저평가·공포이고, ' + BUY + ' 이상이면 계획한 투입 구간입니다.</p>' +
      '</section>' +
      topPanel +
      head +
      gaugeCard +
      section('track', '지표 기록 · 버블 · 산식', '과거 점수 기록, 버블 체크, 무엇이 실시간인가, 매매 기준·산식. 눌러서 폅니다.', track) +
      statBlock +
      radarCard +
      chartsCard +
      flowCard +
      section('crash', '폭락 비교', '저점 전후 1년 비교 · 여섯 사례. 눌러서 폅니다.', crashHtml, crashOpen);

    bind(view, t, detailId);
    drawCharts(view, t, monthPts, result.score);
    if (crashOpen) drawOverlap(view, Data.crashes.cases);
    if (detailId) {
      var c = Data.caseById(detailId);
      if (c) drawCrashChart(view, c);
    }
    afterRenderScroll(view, null);
  };

  /* ------------------------------------------------------------ 폭락 사례 — 자기 페이지
   * #/gauge/crash/<id> 는 매수 지표 본문을 그리지 않고 이 화면만 그린다.
   * 구성: 이동줄·제목·기간·핵심 수치 → 상세 차트 → 닮은 날·비교 표 → 이전/목록/다음.
   */
  var CASE_SCROLLED = null;

  function gaugeCaseView(view, id) {
    var c = Data.caseById(id);
    CRASH_SCROLLED = false;   /* 사례 페이지에서 목록으로 돌아올 때 폭락 비교 자리로 가도록 */
    var crumb = '<div class="crumb"><a href="#/">홈</a> / <a href="#/gauge">매수 지표</a> / <a href="#/gauge/crash">폭락 비교</a>' +
      (c ? ' / ' + esc(c.name) : '') + '</div>';
    if (!c) {
      view.innerHTML = '<section class="hero g-hero">' + crumb + '<h1>폭락 사례</h1>' +
        '<p>없는 사례입니다.</p></section>' +
        '<article class="panel"><a class="btn ghost sm" href="#/gauge/crash">폭락 비교 목록으로</a></article>';
      return;
    }
    view.innerHTML =
      '<section class="hero g-hero">' + crumb +
        '<h1>' + esc(c.name) + '</h1>' +
        '<p>' + esc(c.tag) + ' · ' + esc(c.index) + ' 기준 · 고점 ' + F.day(c.peak) + ' → 저점 ' + F.day(c.trough) +
          ' · 최대 낙폭 <b>' + F.pct(c.dd, 1) + '</b> · ' + F.int(c.days_to_trough) + '거래일</p>' +
      '</section>' +
      crashDetailHtml(c);
    bindCase(view, c);
    drawCrashChart(view, c);
    if (CASE_SCROLLED !== id) {
      CASE_SCROLLED = id;
      try { w.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { w.scrollTo(0, 0); }
    }
  }

  /* 사례 페이지 이벤트 — 고점/저점 기준만 붙인다(다른 화면 이벤트는 붙이지 않는다) */
  function bindCase(view, c) {
    els(view, '[data-scale]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-scale') === crashScale);
      b.addEventListener('click', function () {
        crashScale = b.getAttribute('data-scale');
        els(view, '[data-scale]').forEach(function (x) { x.classList.toggle('on', x === b); });
        drawCrashChart(view, c);
      });
    });
  }

  /* 주소가 폭락 비교 목록(#/gauge/crash)인가 — 그 주소로 들어오면 섹션을 펴고 차트도 그린다 */
  function isCrashPath() { return /^#\/gauge\/crash\/?$/.test(String(location.hash || '')); }

  /* 매수 지표 본문으로 돌아온 화면에서 폭락 비교 자리로 — 주소가 폭락 비교일 때만,
     한 번만 스크롤한다(다시 그릴 때 또 튀지 않게). */
  var CRASH_SCROLLED = false;
  function afterRenderScroll(view, detailId) {
    if (detailId) return;
    if (!isCrashPath()) { CRASH_SCROLLED = false; return; }
    if (CRASH_SCROLLED) return;
    CRASH_SCROLLED = true;
    var sec = el('.g-sec[data-sec="crash"]', view);
    if (!sec) return;
    w.setTimeout(function () {
      var top = sec.getBoundingClientRect().top + (w.pageYOffset || 0) - 10;
      try { w.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch (e) { w.scrollTo(0, Math.max(0, top)); }
    }, 40);
  }

  /* ------------------------------------------------------------ 매수 지표 입력(맨 위) */

  /* 희귀도 — 실제 주봉 점수 기록(2011~, Data.gauge.weekly)만으로 센다.
     문턱 이상인 주를 21일 이내 연속으로 묶어 회차를 내고, 기간으로 나눠 '몇 년에 1회'를 낸다.
     자료에 미리 적힌 stat.rarity(1995년 합성 구간이 섞인 값)는 쓰지 않는다. */
  function rarityOf(t) {
    var w = (Data.gauge.weekly && Data.gauge.weekly[t]) || [];
    if (w.length < 10) return null;
    var eps = [], cur = null;
    w.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || p[1] < BUY) return;
      var ms = Date.parse(p[0]);
      if (cur && (ms - cur.endMs) / 86400000 <= 21) {
        cur.endMs = ms; cur.end = p[0]; cur.max = Math.max(cur.max, p[1]); cur.weeks += 1;
      } else {
        if (cur) eps.push(cur);
        cur = { start: p[0], end: p[0], max: p[1], weeks: 1, endMs: ms };
      }
    });
    if (cur) eps.push(cur);
    if (!eps.length) return null;
    var span = (Date.parse(w[w.length - 1][0]) - Date.parse(w[0][0])) / 86400000 / 365.25;
    var per = span / eps.length;
    var perYear = eps.length / span;
    var label = perYear >= 2 ? '자주 오는 구간' : (perYear >= 0.75 ? '1년에 한 번 수준' : (perYear >= 0.4 ? '2~3년에 한 번' : '드문 구간'));
    var hits = w.filter(function (p) { return p[1] >= BUY; }).length;
    return {
      text: (per >= 0.95 ? per.toFixed(1) : per.toFixed(2)) + '년에 1회 · ' + Math.round(span) + '년간 ' + eps.length + '회',
      label: label, perYear: perYear, yearsPer: per, episodes: eps.length,
      weeks: w.length, hits: hits, from: w[0][0], to: w[w.length - 1][0], span: span
    };
  }

  function rarityNoteHtml(r, t) {
    if (!r) return '희귀도 — 주봉 점수 기록이 모자라 계산하지 못했습니다.';
    return '희귀도 = 주봉 점수 기록 ' + F.day(r.from) + '~' + F.day(r.to) + ' ' + r.weeks + '주 중 ' + BUY +
      '점 이상 ' + r.hits + '주를 21일 이내 연속으로 묶어 ' + r.episodes + '회. ' +
      Math.round(r.span) + '년에 ' + r.episodes + '회 → ' + r.label + ' (1995년 합성 구간은 쓰지 않습니다).';
  }

  function sixLine(values) {
    return IND.map(function (spec) {
      var v = values[spec.key];
      var x = (v === null || v === undefined) ? '—'
        : (spec.key === 'dd' ? '-' + Number(v).toFixed(1)
          : spec.key === 'vixr' ? Number(v).toFixed(2) + 'x'
            : Number(v).toFixed(1));
      return SHORT[spec.key] + ' <b>' + x + '</b>';
    }).join(' · ');
  }

  function modeNote(snap) {
    if (snap.manual) {
      return '수동 — 내가 넣은 값이 우선입니다. 기준을 바꿔도 값은 그대로이고, <b>자동</b>으로 돌리면 고른 기준(확정/실시간)의 값으로 돌아옵니다.';
    }
    return '자동 — ' + (snap.basis === 'live'
      ? 'data/live.json 의 실시간 값(프리마켓·애프터 포함)'
      : '마지막 확정 종가') + '입니다. 기준을 바꾸면 여섯 값·가격·레이더가 그 기준으로 채워집니다.';
  }

  /* 매수 지표 탭 맨 위 — 지표 추적(여섯 지표 조작)이 곧 입력부다.
     가격을 따로 넣는 칸은 두지 않는다: 실시간 모드면 live.json 값, 손댔으면 낙폭·200일선 이격 역산값. */
  function gaugeTopHtml(snap, T, G) {
    var t = snap.t, values = snap.values, result = snap.result;
    var meta = liveInfo(t);
    var open = ST.open.inds === undefined ? (w.innerWidth || 390) >= 900 : !!ST.open.inds;
    return '<article class="panel" id="gTop">' +
      '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<div class="g-sub" style="margin:0">매수 지표 입력 · 지표 추적</div>' + modeSegHtml() +
      '</div>' +
      '<div class="g-ctl">' + basisSegHtml(snap) + basisBadgeHtml(snap, meta) +
        '<button class="btn ghost sm" type="button" id="gLiveRefresh">실시간 새로고침</button></div>' +
      '<p class="g-cap" id="gModeNote">' + modeNote(snap) + '</p>' +
      '<p class="g-six" id="gSix">' + sixLine(values) + '</p>' +
      '<button class="btn ghost sm" type="button" id="gIndsBtn" aria-expanded="' + (open ? 'true' : 'false') + '" style="margin-top:2px">여섯 지표 직접 조작 <span class="mark">' + (open ? '접기 ▴' : '펼치기 ▾') + '</span></button>' +
      '<div id="gInds"' + (open ? '' : ' hidden') + '>' + indsHtml(values) + indsTableHtml(result) + '</div>' +
      '<p class="note">슬라이더·숫자로 값을 바꾸면 점수·막대·판정·레이더·오늘 선이 같은 값으로 바로 따라오고, 낙폭·200일선 이격은 위 가격을 거꾸로 다시 계산합니다. RSI·VIX는 과거 시계열이 필요해 가격으로 되돌릴 수 없습니다.</p>' +
    '</article>';
  }

  function indsHtml(values) {
    return IND.map(function (spec) {
      var v = values[spec.key];
      var steps = Math.round((spec.max - spec.min) / spec.step);
      var prog = v === null || v === undefined ? 0 : Math.round((v - spec.min) / spec.step);
      prog = Math.max(0, Math.min(steps, prog));
      return '<div class="g-ind">' +
        '<div class="top"><b>' + esc(spec.name) + '</b><span class="w">가중 ' + Math.round(spec.w * 100) + '%</span><span class="sp"></span>' +
          '<input type="number" data-num="' + spec.key + '" step="' + spec.step + '" value="' +
            (v === null || v === undefined ? '' : (spec.key === 'vixr' ? Number(v).toFixed(2) : Number(v).toFixed(1))) + '" aria-label="' + esc(spec.name) + ' 값">' +
          '<span class="g-mini">' + esc(spec.unit || '') + '</span></div>' +
        (v === null || v === undefined
          ? '<div class="g-mini" style="color:var(--amber)">이 시점 자료가 없어 계산에서 뺐습니다</div>'
          : '<input type="range" min="' + spec.min + '" max="' + spec.max + '" step="' + spec.step + '" value="' + (spec.min + prog * spec.step) + '" data-slider="' + spec.key + '" aria-label="' + esc(spec.name) + ' 슬라이더">' +
            '<div class="ends"><span>' + fmtEnd(spec, spec.min) + '</span><span>' + fmtEnd(spec, spec.max) + '</span></div>') +
      '</div>';
    }).join('');
  }

  function indsTableHtml(result) {
    return '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>지표</th><th>값</th><th>환산</th><th>기여</th></tr></thead><tbody id="gTrackTable">' +
      result.rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="mono">' + (r.value === null ? '—' : fmtVal(r.key, r.value) + esc(r.unit || '')) +
          '</td><td class="mono">' + (r.converted === null ? '—' : F.num(r.converted)) +
          '</td><td class="mono">' + (r.contribution === null ? '—' : F.signed(r.contribution, 1)) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p class="note" id="gTrackSum">값이 없는 지표는 빼고 남은 가중치 합(' + F.fixed(result.weightSum, 2) + ')으로 나눕니다. 기여도 합 ÷ 가중치 합 = ' + F.num(result.score) + '점.</p>';
  }

  /* ------------------------------------------------------------ 지표 기록 · 버블 · 산식 */

  function trackingHtml(t, values, result, snap) {
    var T = Data.gauge.targets[t];
    var records = S.get('gaugeTrack', []);
    var mine = records.filter(function (r) { return r.target === t; });
    var last5 = mine.slice(-5);
    var trackList = mine.length
      ? mine.slice(-6).reverse().map(function (r, i2, arr) {
          var prev = arr[i2 + 1];
          var d = prev ? (r.score - prev.score) : null;
          return '<div class="g-track"><span class="nm">' + esc(r.at) + '</span>' +
            '<b class="mono">' + F.num(r.score) + '</b>' +
            '<span class="df" style="color:' + (d === null ? 'var(--dim)' : (d > 0 ? 'var(--green)' : (d < 0 ? 'var(--red)' : 'var(--dim)'))) + '">' +
            (d === null ? '' : F.signed(d, 1)) + '</span></div>';
        }).join('')
      : '<p class="g-cap">아직 기록이 없습니다. 이 화면을 열 때마다 그 시각의 여섯 값과 점수를 이 브라우저에 남깁니다.</p>';

    var b = Data.gauge.bubble || {};
    function sig(kind, val, lv) {
      if (val === null || val === undefined) return { tone: 'var(--dim)', label: '자료 없음' };
      if (kind === 'price') return val >= 80 ? { tone: 'var(--red)', label: '위험' } : (val >= 70 ? { tone: 'var(--amber)', label: '주의' } : { tone: 'var(--green)', label: '정상' });
      if (kind === 'money') return val >= 4.0 ? { tone: 'var(--red)', label: '위험' } : (val >= 3.5 ? { tone: 'var(--amber)', label: '주의' } : { tone: 'var(--green)', label: '정상' });
      return val > 5 ? { tone: 'var(--amber)', label: '주의' } : { tone: 'var(--green)', label: '정상' };
    }
    var sPrice = sig('price', b.sox_rsi_month), sMoney = sig('money', b.hy_spread), sPhys = sig('physical', b.dc_vacancy);
    var level = (sPrice.label === '위험' || sMoney.label === '위험' || sPhys.label === '위험') ? '위험 신호 있음'
      : (sPrice.label === '주의' || sMoney.label === '주의' || sPhys.label === '주의') ? '주의 신호 있음' : '신호 없음';

    var bubble =
      '<article class="panel">' +
        '<div class="row" style="justify-content:space-between"><div class="g-sub" style="margin:0">버블 체크</div>' +
        '<span class="badge ' + (level === '위험 신호 있음' ? 'red' : (level === '주의 신호 있음' ? 'amber' : 'grey')) + '">판정 · ' + level + '</span></div>' +
        '<p class="g-cap">가격·자금·실물 세 스위치. 기준일 ' + F.day(b.as_of) + '</p>' +
        '<div class="g-tiles">' +
          '<div class="g-tile"><div class="lab">가격</div><div class="val"><span class="dot" style="background:' + sPrice.tone + '"></span><span style="color:' + sPrice.tone + '">' + sPrice.label + '</span></div>' +
            '<div class="det">반도체지수 월봉 RSI ' + (b.sox_rsi_month === null ? '—' : F.num(b.sox_rsi_month, 1)) + '</div></div>' +
          '<div class="g-tile"><div class="lab">자금</div><div class="val"><span class="dot" style="background:' + sMoney.tone + '"></span><span style="color:' + sMoney.tone + '">' + sMoney.label + '</span></div>' +
            '<div class="det">하이일드 OAS ' + (b.hy_spread === null ? '—' : F.fixed(b.hy_spread, 2) + '%p') + ' · ' + F.day(b.hy_date) + '</div></div>' +
          '<div class="g-tile"><div class="lab">실물</div><div class="val"><span class="dot" style="background:' + sPhys.tone + '"></span><span style="color:' + sPhys.tone + '">' + sPhys.label + '</span></div>' +
            '<div class="det">데이터센터 공실률 ' + (b.dc_vacancy === null ? '—' : F.num(b.dc_vacancy, 1) + '%') + '</div></div>' +
        '</div>' +
        '<p class="note">신호 기준 — 가격: 반도체지수 월봉 RSI 70↑ 주의·80↑ 위험 / 자금: 하이일드 OAS 3.5%p↑ 주의·4.0%p↑ 위험 / 실물: 데이터센터 공실률 5% 초과 주의. ' +
          '값이 없는 칸은 원본 자료에 그 값이 없는 것입니다(지어내지 않습니다).</p>' +
      '</article>';

    var meta = liveInfo(t);
    var info = priceInfo(snap);
    var nowWhat = snap.manual ? '내가 넣은 여섯 값(수동)'
      : (snap.basis === 'live' ? '실시간(추정) 값 · ' + (etPart(meta) || '시각 없음') : '확정 종가 값 · ' + F.day(snap.L.as_of));
    var prov =
      '<article class="panel">' +
        '<div class="g-sub" style="margin:0">무엇이 실시간이고 무엇이 종가인가</div>' +
        '<p class="note" style="margin-top:6px">확정(종가) = 마지막 정규장 봉. 실시간(추정) = data/live.json 의 지금 값(프리마켓·애프터 포함)을 진행 중인 봉으로 얹어 같은 식으로 다시 계산한 값.</p>' +
        '<p class="note" style="margin-top:4px">생성 배포지만 GitHub Actions 가 5분마다 data/live.json 을 다시 만듭니다(마지막 갱신 ' + esc(meta && meta.updatedAtKst || '—') + ' KST). 이 화면의 점수·가격·레이더는 <b>' + esc(nowWhat) + '</b>입니다.</p>' +
        '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>값</th><th>값</th><th>출처</th></tr></thead><tbody>' +
          '<tr><td>지금 화면 가격</td><td class="mono">$' + F.fixed(info.price, 2) + '</td><td>' + esc(info.tag) + '</td></tr>' +
          '<tr><td>' + esc(T.symbol) + ' 종가</td><td class="mono">' + F.fixed(T.detail.close, 2) + '</td><td>일봉 종가</td></tr>' +
          '<tr><td>5년 최고 종가</td><td class="mono">' + F.fixed(T.detail.peak, 2) + '</td><td>' + F.day(T.detail.peak_date) + '</td></tr>' +
          '<tr><td>200일선</td><td class="mono">' + F.fixed(T.detail.ma200, 2) + '</td><td>200거래일 평균</td></tr>' +
          '<tr><td>VIX · 50일 평균</td><td class="mono">' + F.fixed(T.detail.vix, 2) + ' · ' + F.fixed(T.detail.ma50_vix, 2) + '</td><td>1년 ' + T.detail.vix_samples + '거래일</td></tr>' +
        '</tbody></table></div>' +
      '</article>';

    var rules = [
      ['90+', '계획의 50% 투입', '코로나·관세급. 여기까지 왔으면 아껴 둘 이유가 거의 없습니다.', 'var(--green)'],
      ['80~90', '계획의 25% 투입', '2022 저점급. 1차 진입 자리입니다.', 'var(--blue)'],
      ['70~80', '계획의 25% 투입', '바닥의 시작 구간입니다.', 'var(--purple)'],
      ['50~70', '관망', '조정은 맞지만 자리가 아닙니다.', 'var(--amber)'],
      ['50 미만', '신규 매수 아님', '고점 가까이에 있고 공포도 안 실렸습니다.', 'var(--tx2)'],
      ['중단', 'VIX 1.8배 + 200일선 -25%', '두 개가 같이 가면 2008년형입니다. 점수와 무관하게 신규 매수를 멈춥니다.', 'var(--red)'],
      ['매도', '주간 RSI 72 이상 또는 200일선 +15%', '점수가 아니라 이 두 개로 익절을 시작합니다.', 'var(--red)']
    ];
    var ruleHtml = rules.map(function (r) {
      return '<div class="g-rule"><span class="tag" style="color:' + r[3] + ';border-color:' + r[3] + '">' + esc(r[0]) + '</span>' +
        '<span class="tx">' + esc(r[1]) + '<span class="ds">' + esc(r[2]) + '</span></span></div>';
    }).join('');

    var gloss = [
      ['고점 대비 낙폭', '.30', 'TQQQ·SOXL이 최근 5년 최고점에서 얼마나 빠졌나. TQQQ -12%, SOXL -20%면 만점입니다.',
        '100 × 절대낙폭 / 기준낙폭 (TQQQ 12%, SOXL 20%)', '일봉 종가(5년)'],
      ['주간 RSI(14주)', '.20', '주봉 기준 과매도 정도. 일봉보다 거짓 신호가 적어 바닥다운 바닥을 골라냅니다.',
        '(70 - 주간RSI) / 40 × 100 → RSI 30이면 100점, 70이면 0점', '일봉 종가를 주 단위로 묶어 와일더 14주 RSI'],
      ['VIX / 50일 평균', '.15', '공포지수가 자기 평균보다 얼마나 높은지. 절대 수치보다 평소 대비가 의미 있습니다.',
        '(비율 - 1) / 0.4 × 100 → 50일 평균의 1.4배면 100점', 'VIX 일별 종가(야후 ^VIX)'],
      ['200일선 이격', '.15', 'TQQQ·SOXL이 200일선에서 얼마나 아래에 있는지. -30%면 만점.',
        '-1 × (200일 대비 이격 %) / 30 × 100', '일봉 종가 200일 이동평균'],
      ['일간 RSI(14)', '.10', '단기 과매도. 주간 RSI와 같이 보면 빠졌지만 아직 안 꺾인 자리를 걸러냅니다.',
        '(50 - 일간RSI) / 20 × 100 → RSI 30이면 100점', '일봉 종가로 와일더 14 RSI'],
      ['공포 백분위', '.10', '지금 VIX가 지난 1년 중 몇 번째로 높은지.',
        '1년 252거래일 중 현재값 이하인 날의 비율', 'VIX 1년 일별']
    ];
    var glossHtml = gloss.map(function (g) {
      return '<dt>' + esc(g[0]) + ' <span class="k">가중 ' + esc(g[1]) + '</span></dt><dd>' + esc(g[2]) +
        '<br><span class="k">산식</span> ' + esc(g[3]) + '<br><span class="k">출처</span> ' + esc(g[4]) + '</dd>';
    }).join('');

    var ref =
      '<article class="panel">' +
        '<div class="g-sub" style="margin:0">매매 기준 · 지표 설명 · 산식</div>' +
        '<p class="g-cap">사다리는 ' + BUY + '점부터 겁니다. 과거 바닥은 85~100점에서 나왔습니다.</p>' +
        ruleHtml +
        '<dl class="g-gloss">' + glossHtml + '</dl>' +
      '</article>';

    return '<article class="panel">' +
        '<div class="g-sub" style="margin:0">지표 추적 기록</div>' +
        '<p class="g-cap">이 화면을 열 때마다 그 시각의 점수를 이 브라우저에 남깁니다(최근 60개).</p>' +
        trackList +
        (last5.length > 1 ? '<p class="note">최근 ' + last5.length + '회 점수  ' + last5.map(function (r) { return F.num(r.score); }).join('  ') + '</p>' : '') +
        '<button class="btn ghost sm" type="button" id="gTrackNow" style="margin-top:10px">지금 값 기록</button>' +
      '</article>' +
      bubble + prov + ref;
  }

  function fmtEnd(spec, v) {
    if (spec.key === 'dd') return trim1(v) + '%';
    if (spec.key === 'vixr') return Number(v).toFixed(2) + 'x';
    return trim1(v) + (spec.unit || '');
  }

  /* ------------------------------------------------------------ 일곱 시점 겹쳐 보기(원본 CrashChartView)
   *
  /* 폭락 비교 — 보기 눈금은 '저점=100 · 로그' · '고점=100 · 로그' · '낙폭 %'(기본) 셋.
     '날짜' 보기는 껐다(무아 님 2026-11-28). drawDateOverlap·ovDate* 함수는 지우지 않고
     호출 경로(drawOverlap 의 분기)만 끊어 두었다 — 되살릴 때 그 한 줄만 돌리면 된다. */
  var OV = { scale: 'pct', win: 1 };
  var OV_OFF = [];   /* 사례 칩 — 처음엔 전부 켜진다. 끄기는 이 화면에서만(저장하지 않음).
                        '현재'(id 'today')만 예외로 켜고 끈 상태를 브라우저에 남긴다. */

  /* 저점 기준 보이는 기간 — 6개월 단위 6단계. 거래일은 1년=252 기준(0.5년=126, 1.5년=378). */
  var OV_WINS = [0.5, 1, 1.5, 2, 2.5, 3];
  function ovWinText(v) {
    var m = Math.round(Number(v) * 12);
    if (!m || isNaN(m)) return '—';
    var y = Math.floor(m / 12), r = m % 12;
    return y ? (y + '년' + (r ? ' ' + r + '개월' : '')) : (r + '개월');
  }
  function ovTodayOn() { return OV_OFF.indexOf('today') < 0; }
  function ovSetToday(on) {
    var i = OV_OFF.indexOf('today');
    if (on && i >= 0) OV_OFF.splice(i, 1);
    if (!on && i < 0) OV_OFF.push('today');
    S.set('crashTodayOff', !on);
  }
  function ovAllOn(cases) {
    if (!ovTodayOn()) return false;
    return (cases || []).every(function (c) { return OV_OFF.indexOf(c.id) < 0; });
  }

  function ovCasePath(c, scale) {
    var src;
    if (scale === 'trough') src = c.troughPath || [];
    else if (scale === 'peak') src = (c.prePath || []).concat(c.path || []);
    else src = (c.prePath || []).concat(c.path || []);
    var lim = 252 * (OV.win || 1);
    return src.map(function (p) {
      var v;
      if (scale === 'pct') v = p[1];
      else v = 100 * (1 + p[1] / 100);
      return [p[0], v];
    }).filter(function (p) { return p[0] >= -lim && p[0] <= lim && (scale === 'pct' || p[1] > 0); });
  }

  /* '현재' 값 — 사례 선과 같은 계열(^NDX 지수 낙폭). 대상(TQQQ·SOXL) 낙폭은 쓰지 않는다.
     live.json 의 ^NDX 시세가 확정 종가와 다르면 그 값(프리마켓·정규장)으로, 같으면 확정 NDX 낙폭으로 둔다.
     기준(정규장/프리마켓) 설정과 상관없이 늘 최신 값을 본다 — 5분 갱신이 이 값을 따라온다. */
  function ovNowPoint() {
    var now = Data.now();
    var ddNow = now.dd, src = 'close';
    var label = '확정 종가 · ' + F.day(now.as_of);
    var q = (w.Basis && Basis.quote) ? (Basis.quote('^NDX') || Basis.quote('NDX')) : null;
    if (q && q.price !== null && q.price !== undefined && now.peak_close > 0) {
      var ddLive = (q.price / now.peak_close - 1) * 100;
      if (Math.abs(ddLive - now.dd) > 0.005) {
        ddNow = ddLive; src = 'live';
        label = '실시간 추정 · ' + (q.at ? F.day(String(q.at).slice(0, 10)) + ' ' : '') + (q.hhmm || '시각 없음') + (q.session ? ' (' + q.session + ')' : '') + ' · ^NDX ' + F.fixed(q.price, 2);
      }
    }
    return { dd: ddNow, src: src, label: label };
  }

  /* 현재 경로 — ^NDX 일봉에서 고점 이후 하루씩. 값이 실제로 움직였을 때만 한 점을 더 붙인다. */
  /*
   * 현재 경로 — 사례(crashes.json)와 '똑같은 규격'으로 만든다(무아 님 2026-11-28 지시).
   *   prePath : 고점 앞 252거래일(^NDX 종가로 고점 대비 낙폭 재계산)
   *   path    : 고점(10/06) → 지금
   *   trough  : 저점 기준 ±252거래일 — 저점은 고점 이후 최저점(지금 2026-11-20), 값은 저점 종가 = 100 기준 %.
   * 좌표 규칙도 사례와 같다: 고점 계열 x=0 이 고점, 저점 계열 x=0 이 저점.
   * 그래서 6개월~3년 창에서 사례들과 같은 밀도로 퍼지고, 현재 선은 지금 점에서 끝난다.
   */
  function ovToday() {
    var now = Data.now();
    var idx = Data.scores.index || [];
    if (!idx.length || !(now.peak_close > 0)) return null;

    var pi = -1;
    for (var i = 0; i < idx.length; i++) if (idx[i][0] <= now.peak_date) pi = i;
    if (pi < 0) return null;

    var prePath = [], path = [], dates = [];
    for (var a = Math.max(0, pi - 252); a < pi; a++) {
      prePath.push([a - pi, (idx[a][1] / now.peak_close - 1) * 100]);
    }
    for (var b = pi; b < idx.length; b++) {
      path.push([b - pi, (idx[b][1] / now.peak_close - 1) * 100]);
      dates.push(idx[b][0]);
    }
    if (!path.length) return null;
    var lastConfirmed = dates[dates.length - 1];

    var np = ovNowPoint();
    var ddNow = np.dd, src = np.src, label = np.label;
    var lastDd = path[path.length - 1][1];

    /* 선을 지금까지 잇는다 — 값이 실제로 움직였을 때만 한 점을 더 붙인다.
       확정 종가와 사실상 같은 값이면 점을 붙이지 않아 선이 마지막 확정 점에서 평평하게 끝난다. */
    var extended = (src !== 'close' && Math.abs(ddNow - lastDd) >= 0.005);

    /* 저점 — 고점 이후 최저점. 지금 값이 더 낮으면 지금이 저점이다. */
    var ti = 0, best = 1e9;
    path.forEach(function (p, k) { if (p[1] < best) { best = p[1]; ti = k; } });
    if (extended && ddNow < best) { best = ddNow; ti = path.length; }
    var tiAbs = pi + ti;
    var troughClose = now.peak_close * (1 + best / 100);

    var troughPath = [];
    if (troughClose > 0) {
      for (var c = Math.max(0, tiAbs - 252); c < idx.length; c++) {
        troughPath.push([c - tiAbs, (idx[c][1] / troughClose - 1) * 100]);
      }
      if (extended) {
        troughPath.push([idx.length - tiAbs, ((1 + ddNow / 100) / (1 + best / 100) - 1) * 100]);
      }
    }

    var offset = extended ? path.length : path.length - 1;
    var troughOffset = offset - ti;
    return {
      dd: ddNow, src: src, label: label,
      peak: prePath.concat(extended ? path.concat([[path.length, ddNow]]) : path),
      trough: troughPath,
      offset: offset,
      confOffset: path.length - 1,
      troughOffset: troughOffset,
      troughConf: (path.length - 1) - ti,
      firstDate: dates[0], lastDate: extended ? F.today() : lastConfirmed, lastConfirmed: lastConfirmed,
      liveDate: extended ? F.today() : null, n: offset + 1,
      troughDate: idx[tiAbs] ? idx[tiAbs][0] : null
    };
  }

  function ovScaleLabel(s) {
    return s === 'trough' ? '저점=100 · 로그'
      : (s === 'peak' ? '고점=100 · 로그' : (s === 'date' ? '날짜' : '낙폭 %'));
  }

  var OV_SCALES = ['trough', 'peak', 'pct'];   /* '날짜' 보기는 뺐다(함수는 남기고 이 목록에서만 제외) */

  /* 겹쳐 보기 칩줄 — [전체] 1929 → 2025 [현재]. 사례는 고점 연도 시간 순. */
  function ovChipCases(cases) {
    return (cases || []).slice().sort(function (a, b) {
      return Number(String(a.peak).slice(0, 4)) - Number(String(b.peak).slice(0, 4));
    });
  }

  function ovChipsSync(view, cases) {
    els(view, '[data-ovcase]').forEach(function (b) {
      b.classList.toggle('on', OV_OFF.indexOf(b.getAttribute('data-ovcase')) < 0);
    });
    els(view, '[data-ovtoday]').forEach(function (b) { b.classList.toggle('on', ovTodayOn()); });
    els(view, '[data-ovall]').forEach(function (b) { b.classList.toggle('on', ovAllOn(cases)); });
  }

  function overlapCard(cases) {
    var saved = S.get('crashOv', null);
    if (saved === 'date') { OV.scale = 'pct'; S.set('crashOv', 'pct'); }   /* 옛 '날짜' 보기 → 낙폭 % */
    else if (OV_SCALES.indexOf(saved) >= 0) OV.scale = saved;
    if (OV_SCALES.indexOf(OV.scale) < 0) OV.scale = 'pct';
    var savedWin = Number(S.get('crashWin', 1));
    OV.win = OV_WINS.indexOf(savedWin) >= 0 ? savedWin : 1;
    /* '현재' 켜고 끈 상태는 저장값을 따른다(사례 칩은 이 화면에서만 유지) */
    if (S.get('crashTodayOff', false) && ovTodayOn()) OV_OFF.push('today');

    var chips = ovChipCases(cases).map(function (c) {
      var on = OV_OFF.indexOf(c.id) < 0;
      return '<button class="chip ' + (on ? 'on' : '') + '" type="button" data-ovcase="' + c.id + '">' +
        '<span class="dot" style="background:' + c.color + '"></span>' + esc(c.short) + '</button>';
    }).join('');
    var nC = (cases || []).length || 1;
    var allColors = (cases || []).map(function (c, i) {
      return c.color + ' ' + (i * 100 / nC).toFixed(1) + '% ' + ((i + 1) * 100 / nC).toFixed(1) + '%';
    }).join(',');
    var allChip = '<button class="chip ' + (ovAllOn(cases) ? 'on' : '') + '" type="button" data-ovall="1">' +
      '<span class="dot" style="background:conic-gradient(' + allColors + ')"></span>전체</button>';
    var todayChip = '<button class="chip ' + (ovTodayOn() ? 'on' : '') + '" type="button" data-ovtoday="today">' +
      '<span class="dot" style="background:var(--blue)"></span>현재</button>';
    return '<article class="panel">' +
      '<div class="row" style="justify-content:space-between;align-items:center">' +
        '<div class="g-sub" style="margin:0">' + cases.length + '개 시점 겹쳐 보기</div>' +
        '<span class="g-seg" id="ovScale">' +
          OV_SCALES.map(function (s) {
            return '<button type="button" data-ovscale="' + s + '" class="' + (OV.scale === s ? 'on' : '') + '">' + ovScaleLabel(s) + '</button>';
          }).join('') +
        '</span>' +
      '</div>' +
      '<div class="pill-row" id="ovChips" style="margin:8px 0 2px">' + allChip + chips + todayChip + '</div>' +
      '<div class="g-win"><div class="row" style="justify-content:space-between"><span class="g-cap" style="margin:0">저점 기준 보이는 기간 <b id="ovWinLab">' + ovWinText(OV.win) + '</b></span>' +
        '<span class="g-cap" style="margin:0">6개월 · 1년 · 1년 6개월 · 2년 · 2년 6개월 · 3년</span></div>' +
        '<input type="range" id="ovWin" min="0.5" max="3" step="0.5" value="' + OV.win + '" aria-label="저점 기준 보이는 기간(6개월 단위)"></div>' +
      '<p class="note" style="margin:0 0 4px">처음에는 전부 켜져 있습니다. 사례 칩의 끄기는 이 화면에서만 유지되고, 현재 칩의 상태는 저장됩니다.</p>' +
      '<div class="row" id="ovNowBig" style="justify-content:space-between;align-items:baseline;margin:2px 0 2px">' +
        '<div class="g-stat" style="margin:0">현재 낙폭 <b class="num neg" id="ovNowDd" style="font-size:21px">—</b></div>' +
        '<span class="g-cap" style="margin:0;font-size:11.5px" id="ovNowSrc">—</span>' +
      '</div>' +
      '<div class="chart-box" id="ovChart" style="touch-action:pan-y"></div>' +
      '<p class="note" id="ovReadout"></p>' +
      '<p class="note" id="ovCaption"></p>' +
      '<p class="note" id="ovBasis"></p>' +
    '</article>';
  }

  function ovCaptionText(scale) {
    var nd = Math.round(252 * (OV.win || 1));
    var span = '−' + ovWinText(OV.win) + '~+' + ovWinText(OV.win);
    var shortEnd = OV.win > 1 ? ' 넓힌 구간의 끝은 사례 자료가 고점 ±1년까지만 있어 선이 짧게 끝납니다.' : '';
    if (scale === 'trough') {
      return '각 사례의 **저점 = 100**, 세로는 로그 눈금. 저점 0일 기준 ' + span + '(' + nd + '거래일, 슬라이더) 구간이라 선이 저점에서 만납니다. ' +
        '현재 선은 지금까지의 잠정 저점을 100으로 두고 같은 방식으로 옮겼습니다(최종 저점이 아니라 잠정값).' + shortEnd;
    }
    if (scale === 'peak') {
      return '각 사례의 **고점 = 100**, 세로는 로그 눈금. 고점 0일 기준 ' + span + '.' + shortEnd;
    }
    if (scale === 'date') {
      return '각 사례를 **실제 날짜** 위치에 놓고 세로는 낙폭 %로. 1929·1987·2000·2008·2020·2025가 시간 순서로 어디에 앉는지 보입니다. ' +
        '가로 위치는 고점 날짜에 거래일(주말 제외)을 더해 잡은 근사값입니다 — 고점·저점 날짜는 자료 그대로입니다.';
    }
    return '같은 구간을 **낙폭 %** 선형 눈금으로. 사례·현재 모두 ^NDX 지수 낙폭이라 같은 눈금에서 겹쳐집니다. 로그 보기와 달리 깊은 낙폭이 더 크게 보입니다.' + shortEnd;
  }

  /* ------------------------------------------------------------ 날짜 축 보기
   * 자료에는 각 점의 날짜가 없다(고점 기준 거래일 오프셋만 있다). 그래서 고점 날짜에
   * 거래일(주말 제외)을 더해 날짜를 잡는다. 고점·저점 날짜 자체는 자료값 그대로다.
   * 없는 값을 지어내지 않기 위해, 근사임을 화면 각주에 적는다. */
  function addTradingDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d.getTime())) return null;
    var step = n >= 0 ? 1 : -1, left = Math.abs(n);
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + step);
      var wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) left--;
    }
    return d.getTime();
  }

  function ovDateSeries(c) {
    var pts = [];
    var lim = 252 * (OV.win || 1);          /* 고점 기준 ±창(1~3년)만 그린다(자료가 고점 ±1년까지) */
    (c.prePath || []).concat(c.path || []).forEach(function (p) {
      if (p[0] < -lim || p[0] > lim) return;
      var ms = addTradingDays(c.peak, p[0]);
      if (ms !== null && p[1] !== null) pts.push([ms, p[1]]);
    });
    return pts;
  }

  function ovDateToday(tSnap) {
    var meta = liveInfo(tSnap.t);
    var live = ST.mode === 'manual' || ST.edited || (w.Basis && Basis.get() === 'live');
    /* 확정 모드면 확정 종가 날짜, 실시간·수동이면 지금 날짜 — 라벨과 값이 같은 쪽에서 나온다 */
    var iso = live ? ((meta && meta.barLive) || F.today()) : (tSnap.L.as_of || F.today());
    var ms = Date.parse(String(iso) + 'T00:00:00Z');
    var dd = -Math.abs(tSnap.values && tSnap.values.dd !== null && tSnap.values.dd !== undefined
      ? tSnap.values.dd : Data.now().dd);
    var lab = ST.mode === 'manual' ? '직접 입력' : (ST.edited ? '지표에서 역산' : (live ? '지금(' + ((meta && meta.sessionLabel) || '장중') + ')' : '확정 종가'));
    return { ms: ms, dd: dd, iso: String(iso), label: lab + ' ' + String(iso) };
  }

  function ovDateReadout(ms, series, today) {
    function nearest(pts) {
      var best = null;
      pts.forEach(function (p) {
        var gap = Math.abs(p[0] - ms);
        if (gap <= 12 * 86400000 && (!best || gap < best.gap)) best = { v: p[1], gap: gap };
      });
      return best ? best.v : null;
    }
    var parts = [];
    series.forEach(function (se) {
      var v = nearest(se.pts);
      if (v !== null) parts.push({ k: se.short, v: v, c: se.color });
    });
    var iso = new Date(ms).toISOString().slice(0, 10);
    if (!parts.length) return iso + ' — 이 날짜에 그린 사례가 없습니다.';
    parts.sort(function (a, b) { return a.v - b.v; });
    var txt = iso + ' — ' + parts.map(function (p) {
      return '<span style="color:' + p.c + '">' + esc(p.k) + '</span> ' + F.pct(p.v, 1);
    }).join(' · ');
    if (parts.length >= 2) {
      txt += ' · 격차 ' + F.pct(parts[0].v - parts[parts.length - 1].v, 1).replace('+', '') +
        'p (' + esc(parts[0].k) + ' ' + F.pct(parts[0].v, 1) + ' ↔ ' + esc(parts[parts.length - 1].k) + ' ' + F.pct(parts[parts.length - 1].v, 1) + ')';
    }
    return txt + (today && Math.abs(today.ms - ms) < 12 * 86400000 ? ' · 오늘 ' + F.pct(today.dd, 1) : '');
  }

  /* 날짜 축의 오늘 선 — 사례들과 같은 방식(낙폭 % 선, 날짜 x)으로 그린다. */
  function ovTodayDatePts() {
    var now = Data.now(), idx = Data.scores.index || [];
    var pts = [], seen = false;
    idx.forEach(function (r) {
      if (!seen && r[0] >= now.peak_date) seen = true;
      if (seen) {
        var ms = Date.parse(r[0] + 'T00:00:00Z');
        if (!isNaN(ms) && r[2] !== null) pts.push([ms, r[2]]);
      }
    });
    if (!pts.length) return [];
    var snap = snapshot(ST.target);
    var meta = liveInfo(ST.target);
    var live = ST.mode === 'manual' || ST.edited || (w.Basis && Basis.get() === 'live');
    if (live) {
      var iso = (meta && meta.barLive) || F.today();
      var ms2 = Date.parse(iso + 'T00:00:00Z');
      var dd = -Math.abs(snap.values && snap.values.dd !== null && snap.values.dd !== undefined
        ? snap.values.dd : now.dd);
      if (!isNaN(ms2)) pts.push([ms2, dd]);
    }
    return pts;
  }

  function drawDateOverlap(view, cases) {
    var host = el('#ovChart', view);
    if (!host) return;
    var tSnap = snapshot(ST.target);
    var today = ovDateToday(tSnap);
    var on = cases.filter(function (c) { return OV_OFF.indexOf(c.id) < 0; });
    var series = on.map(function (c) {
      return { id: c.id, short: c.short, color: c.color, pts: ovDateSeries(c) };
    }).filter(function (s) { return s.pts.length > 1; });
    var tpts = ovTodayDatePts();
    if (tpts.length > 1) series.push({ id: 'today', short: '오늘', color: '#5b8fe8', pts: tpts, isToday: true });
    var all = [];
    series.forEach(function (s) { all = all.concat(s.pts); });
    all.push([today.ms, today.dd]);
    if (!all.length) { host.innerHTML = '<div class="empty">그릴 값이 없습니다.</div>'; return; }
    var xs = all.map(function (p) { return p[0]; });
    var ys = all.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs.concat([today.ms]));
    var yLo = Math.min.apply(null, ys), yHi = Math.max.apply(null, ys.concat([0]));
    yLo = Math.floor(yLo / 10) * 10; yHi = Math.ceil(yHi / 10) * 10;
    if (yHi === yLo) yHi = yLo + 10;

    var W = 760, H = 330, pad = { l: 48, r: 20, t: 16, b: 30 };
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var sx = function (ms) { return pad.l + (ms - x0) / (x1 - x0) * iw; };
    var sy = function (v) { return pad.t + ih - (v - yLo) / (yHi - yLo) * ih; };

    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="폭락 사례 날짜 축 — ' + series.length + '개 사례, 세로 낙폭 퍼센트">'];
    /* 연 단위 세로 눈금 — 좁은 화면은 10년 간격 */
    var spanY = (x1 - x0) / 31557600000;
    var step = (w.innerWidth || 390) < 600 ? (spanY > 40 ? 10 : 5) : (spanY > 40 ? 10 : (spanY > 18 ? 5 : 2));
    var y = new Date(x0).getUTCFullYear();
    if (y % step !== 0) y -= y % step;
    for (; y <= new Date(x1).getUTCFullYear(); y += step) {
      var ms = Date.UTC(y, 0, 1);
      if (ms < x0 || ms > x1) continue;
      var x = sx(ms);
      s.push('<line x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (pad.t + ih) + '" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/>');
      s.push('<text x="' + x.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="var(--dim)">' + y + '</text>');
    }
    /* 가로 눈금 — 낙폭 % */
    [0, -20, -40, -60, -80, -100].forEach(function (v) {
      if (v < yLo - 0.001 || v > yHi + 0.001) return;
      s.push('<line x1="' + pad.l + '" y1="' + sy(v).toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + sy(v).toFixed(1) + '" stroke="var(--line)" stroke-width="1"' + (v === 0 ? '' : ' stroke-dasharray="2 4"') + '/>');
      s.push('<text x="' + (pad.l - 6) + '" y="' + (sy(v) + 3.2).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--dim)">' + v + '%</text>');
    });

    series.forEach(function (se) {
      var d = se.pts.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join('');
      if (d) s.push('<path d="' + d + '" fill="none" stroke="' + se.color + '" stroke-width="' + (se.isToday ? 2.6 : 1.5) + '" stroke-opacity="0.9" stroke-linejoin="round"/>');
      var lastP = se.pts[se.pts.length - 1];
      s.push('<text x="' + (sx(lastP[0]) + 4).toFixed(1) + '" y="' + (sy(lastP[1]) - 6).toFixed(1) + '" font-size="10" fill="' + se.color + '">' + esc(se.short) + '</text>');
    });
    /* 오늘 */
    var tx = sx(today.ms);
    s.push('<line x1="' + tx.toFixed(1) + '" y1="' + pad.t + '" x2="' + tx.toFixed(1) + '" y2="' + (pad.t + ih) + '" stroke="var(--blue)" stroke-width="1.2" stroke-dasharray="4 3"/>');
    s.push('<circle cx="' + tx.toFixed(1) + '" cy="' + sy(today.dd).toFixed(1) + '" r="4" fill="var(--blue)"/>');
    s.push('<text x="' + (tx + 5).toFixed(1) + '" y="' + (sy(today.dd) - 7).toFixed(1) + '" font-size="10.5" fill="var(--blue)">오늘 ' + F.pct(today.dd, 1) + '</text>');
    s.push('</svg>');
    host.innerHTML = s.join('');
    host.__ov = { kind: 'date', series: series, today: today, sx: sx, x0: x0, x1: x1, pad: pad, W: W };

    var readout = el('#ovReadout', view);
    if (readout) readout.innerHTML = ovDateReadout(today.ms, series, today);
    var cap = el('#ovCaption', view);
    if (cap) cap.innerHTML = ovCaptionText('date').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    var basis = el('#ovBasis', view);
    if (basis) {
      var tSnap2 = snapshot(ST.target);
      var offNow = tSnap2.L ? (Date.parse(String(today.iso) + 'T00:00:00Z') - Date.parse('2026-01-01T00:00:00Z')) / 86400000 : null;
      basis.textContent = '오늘 기준 — ' + today.label + ' 낙폭 ' + F.pct(today.dd, 1) +
        ' · 창 = 저점 기준 ±' + OV.win + '년(자료는 고점 ±1년까지) · 세로는 낙폭 % · 가로 위치는 고점 + 거래일 근사';
    }
  }

  function drawOverlap(view, cases) {
    var host = el('#ovChart', view);
    if (!host) return;
    var scale = OV.scale;
    /* '날짜' 보기는 껐다 — 되살리려면 아래 한 줄을 살리고 OV_SCALES 에 'date' 를 넣는다. */
    /* if (scale === 'date') { drawDateOverlap(view, cases); return; } */
    var today = ovToday();
    var showToday = ovTodayOn();
    ovNowBadge(view, showToday, today);   /* 차트를 못 그려도 숫자는 맞춰 둔다 */
    var on = cases.filter(function (c) { return OV_OFF.indexOf(c.id) < 0; });
    var series = on.map(function (c) { return { id: c.id, short: c.short, color: c.color, pts: ovCasePath(c, scale) }; });
    /* 현재 선도 사례와 같은 변환(ovCasePath)을 탄다 — 같은 축·같은 밀도로 퍼지고 지금 점에서 끝난다 */
    var todayPts = (today && showToday) ? ovCasePath({
      prePath: (today.peak || []).filter(function (p) { return p[0] < 0; }),
      path: (today.peak || []).filter(function (p) { return p[0] >= 0; }),
      troughPath: today.trough || []
    }, scale) : [];

    var W = 760, H = 320, pad = { l: 48, r: 66, t: 16, b: 28 };
    var all = series.reduce(function (a, s) { return a.concat(s.pts); }, []).concat(todayPts);
    if (!all.length) {
      host.innerHTML = '<div class="empty">그릴 값이 없습니다.</div>';
      host.__ov = { series: series, today: today, todayOn: showToday, todayPts: [], scale: scale };
      var ro0 = el('#ovReadout', view);
      if (ro0) ro0.textContent = '켜 둔 사례가 없습니다 — 위 칩에서 사례나 현재를 눌러 켜세요.';
      return;
    }
    var ys = all.map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    if (scale !== 'pct') {
      lo = Math.max(1, lo); hi = Math.max(hi, 1.5);
      var yOf = function (v) { return Math.log(v); };
      var loL = Math.log(lo), hiL = Math.log(hi);
    } else {
      var yOf = function (v) { return v; };
      var loL = lo, hiL = hi;
    }
    if (hiL === loL) hiL = loL + 1;
    var lim = 252 * (OV.win || 1);
    var xMin = -lim, xMax = lim;
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var sx = function (x) { return pad.l + (x - xMin) / (xMax - xMin) * iw; };
    var sy = function (v) { return pad.t + ih - (yOf(v) - loL) / (hiL - loL) * ih; };

    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="폭락 사례 겹쳐 보기 — ' + ovScaleLabel(scale) + '">'];
    /* 가로 눈금 — 저점/고점 기준일과 고른 기간(6개월 단위) */
    [[-lim, '−' + ovWinText(OV.win)], [-Math.round(lim / 2), '−' + ovWinText(OV.win / 2)], [0, '0'], [Math.round(lim / 2), '+' + ovWinText(OV.win / 2)], [lim, '+' + ovWinText(OV.win)]].forEach(function (t) {
      var x = sx(t[0]);
      s.push('<line x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (pad.t + ih) + '" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/>');
      s.push('<text x="' + x.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10.5" fill="var(--dim)">' + t[1] + '</text>');
    });
    s.push('<line x1="' + pad.l + '" y1="' + pad.t + '" x2="' + pad.l + '" y2="' + (pad.t + ih) + '" stroke="var(--line2)"/>');
    s.push('<line x1="' + pad.l + '" y1="' + (pad.t + ih) + '" x2="' + (W - pad.r) + '" y2="' + (pad.t + ih) + '" stroke="var(--line2)"/>');

    /* 세로 눈금 */
    var ticks = scale === 'pct' ? [-90, -60, -30, 0] : [25, 50, 75, 100, 150, 200, 300];
    ticks.forEach(function (v) {
      if (v < lo - 0.001 || v > hi + 0.001) return;
      var y = sy(v);
      if (y < pad.t - 1 || y > pad.t + ih + 1) return;
      s.push('<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="' + (v === 100 || v === 0 ? 'var(--line2)' : 'var(--line)') + '" stroke-width="1"/>');
      s.push('<text x="' + (pad.l - 6) + '" y="' + (y + 3.2).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--dim)">' + v + '</text>');
    });

    /* 사례 선 — 얇게 */
    series.forEach(function (se) {
      var d = se.pts.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join('');
      if (!d) return;
      s.push('<path d="' + d + '" fill="none" stroke="' + se.color + '" stroke-width="1.4" stroke-opacity="0.85" stroke-linejoin="round"/>');
    });

    /* 현재 — 강조색으로 굵게 */
    if (todayPts.length) {
      var dt = todayPts.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join('');
      s.push('<path d="' + dt + '" fill="none" stroke="var(--blue)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>');
      var last = todayPts[todayPts.length - 1];
      s.push('<circle cx="' + sx(last[0]).toFixed(1) + '" cy="' + sy(last[1]).toFixed(1) + '" r="4" fill="var(--blue)"/>');
      s.push('<text x="' + Math.min(W - 2, sx(last[0]) + 6).toFixed(1) + '" y="' + (sy(last[1]) - 8).toFixed(1) + '" font-size="10.5" fill="var(--blue)">현재</text>');
    }

    /* 선 끝 이름표 — 겹치지 않게 위아래로 밀어 **전부** 그린다(원본 labelLayout) */
    var labels = series.map(function (se) {
      var p = se.pts[se.pts.length - 1];
      return p ? { y: sy(p[1]), text: se.short, color: se.color } : null;
    }).filter(Boolean).sort(function (a, b) { return a.y - b.y; });
    var minGap = 13, lastY = -999;
    labels.forEach(function (l) {
      if (l.y - lastY < minGap) l.y = lastY + minGap;
      lastY = l.y;
    });
    labels.forEach(function (l) {
      var y = Math.min(pad.t + ih - 2, Math.max(pad.t + 8, l.y));
      s.push('<text x="' + (W - pad.r + 6) + '" y="' + y.toFixed(1) + '" font-size="10.5" fill="' + l.color + '">' + esc(l.text) + '</text>');
    });
    s.push('</svg>');
    host.innerHTML = s.join('');
    host.__ov = { series: series, today: today, todayOn: showToday, todayPts: todayPts, scale: scale, sx: sx, pad: pad, W: W };

    /* 기본 읽기 줄 — 현재 자리에서 */
    var day = !today ? null
      : (scale === 'trough' ? (showToday ? today.troughOffset : today.troughConf)
        : (showToday ? today.offset : today.confOffset));
    el('#ovReadout', view).innerHTML = ovReadoutText(day, scale, showToday ? today : null, series, view);
    el('#ovCaption', view).innerHTML = ovCaptionText(scale).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    /* 차트 위 현재 낙폭 큰 숫자 — 차트의 '현재' 점·선과 같은 값에서 나온다 */
    ovNowBadge(view, showToday, today);
    el('#ovBasis', view).textContent = (showToday
        ? '현재 — ' + (today ? today.label + ' · ^NDX 낙폭 ' + F.pct(today.dd, 1) : '값 없음(live·확정 모두 없음)')
        : '현재 선을 껐습니다' + (today ? '(' + today.label + ' · ^NDX 낙폭 ' + F.pct(today.dd, 1) + ')' : '')) +
      ' · 창 = ' + (scale === 'trough' ? '저점' : '고점') + ' 기준 ±' + ovWinText(OV.win) +
      (OV.win > 1 ? ' (사례 자료는 고점 ±1년까지라 끝이 짧을 수 있음)' : '');
  }

  /* 차트 위 현재 낙폭 큰 숫자 — '현재' 선과 같은 값·같은 출처. 토글을 끄면 함께 숨긴다. */
  function ovNowBadge(view, showToday, today) {
    var big = el('#ovNowBig', view);
    if (!big) return;
    big.style.display = (showToday && today) ? '' : 'none';
    if (!today) return;
    var bdd = el('#ovNowDd', view);
    if (bdd) {
      bdd.textContent = F.pct(today.dd, 1);
      bdd.className = 'num ' + (today.dd < 0 ? 'neg' : 'pos');
    }
    var bsrc = el('#ovNowSrc', view);
    if (bsrc) bsrc.textContent = today.label;
  }

  function ovValueAt(pts, day, scale) {
    var best = null;
    pts.forEach(function (p) { if (Math.abs(p[0] - day) < 1.2) best = p; });
    if (!best) {
      pts.forEach(function (p) { if (!best || Math.abs(p[0] - day) < Math.abs(best[0] - day)) best = p; });
      if (best && Math.abs(best[0] - day) > 6) best = null;
    }
    if (!best) return null;
    if (scale === 'pct') return best[1];
    return best[1] - 100;  /* 100 기준 대비 % */
  }

  function ovReadoutText(day, scale, today, series, view) {
    if (day === null || day === undefined) return '현재 값이 없어 읽기를 그리지 않습니다.';
    var head = (scale === 'trough' ? '저점 +' : '고점 +') + day + '일' + (scale === 'pct' ? ' 낙폭' : '') + ' — ';
    var parts = [];
    if (today) {
      var tv = scale === 'trough'
        ? ovValueAt(today.trough.map(function (p) { return [p[0], 100 * (1 + p[1] / 100)]; }), day, scale)
        : ovValueAt(today.peak.map(function (p) { return [p[0], scale === 'pct' ? p[1] : 100 * (1 + p[1] / 100)]; }), day, scale);
      parts.push({ k: '현재', v: tv, c: 'var(--blue)' });
    }
    series.forEach(function (se) {
      parts.push({ k: se.short, v: ovValueAt(se.pts, day, scale), c: se.color });
    });
    var vals = parts.filter(function (p) { return p.v !== null; }).sort(function (a, b) { return a.v - b.v; });
    var out = head + vals.map(function (p) {
      return scale === 'pct' ? p.k + ' ' + F.pct(p.v, 1) : p.k + ' ' + F.fixed(100 + p.v, 1);
    }).join(' · ');
    if (vals.length >= 2) {
      out += ' · 격차 ' + F.pct(vals[vals.length - 1].v - vals[0].v, 1).replace('+', '') + 'p (' +
        esc(vals[vals.length - 1].k) + ' ↔ ' + esc(vals[0].k) + ')';
    }
    return out;
  }

  /* ------------------------------------------------------------ 폭락 비교(원본 접힌 섹션) */

  function crashSectionHtml(detailId) {
    var now = Data.now();
    var cases = Data.crashes.cases.slice().sort(function (a, b) {
      var da = a.now_match ? a.now_match.distance : 9e9, db = b.now_match ? b.now_match.distance : 9e9;
      return da - db;
    });
    var rows = cases.map(function (c) {
      var m = c.now_match;
      /* 30·90·180거래일 뒤 수익률 — 자료에 없으면 (null) '—' 로 비운다 */
      function fwd(v) {
        if (v === null || v === undefined) return '<td class="mono dim">—</td>';
        return '<td class="mono ' + (v < 0 ? 'neg' : 'pos') + '">' + F.pct(v, 1) + '</td>';
      }
      return '<tr class="g-crashrow" data-case="' + c.id + '">' +
        '<td><b style="color:' + c.color + '">■</b> ' + esc(c.name) + '<div class="dim small">' + esc(c.tag) + ' · ' + esc(c.index) + '</div></td>' +
        '<td class="mono">' + F.day(c.peak) + '<div class="dim small">' + F.fixed(c.peak_close, 2) + '</div></td>' +
        '<td class="mono">' + F.day(c.trough) + '<div class="dim small">' + F.fixed(c.trough_close, 2) + '</div></td>' +
        '<td class="mono neg">' + F.pct(c.dd, 1) + '</td>' +
        '<td class="mono">' + F.int(c.days_to_trough) + '</td>' +
        '<td class="mono">' + F.int(c.days_to_recovery) + '</td>' +
        '<td class="mono">' + (m ? F.day(m.date) + '<div class="dim small">고점 +' + m.day + '일 · 낙폭 ' + F.pct(m.dd, 1) + '</div>' : '—') + '</td>' +
        '<td class="mono">' + (m ? F.num(m.distance, 2) : '—') + '</td>' +
        fwd(m ? m.fwd30 : null) + fwd(m ? m.fwd90 : null) + fwd(m ? m.fwd180 : null) +
        '</tr>';
    }).join('');

    var cards = cases.map(function (c) {
      var m = c.now_match;
      return '<a class="case-card" href="#/gauge/crash/' + c.id + '" style="border-left-color:' + c.color + '">' +
        '<div class="top"><span class="nm">' + esc(c.short) + '</span><span class="dd">' + F.pct(c.dd, 1) + '</span></div>' +
        '<div class="meta">' + esc(c.name) + ' · 저점까지 ' + F.int(c.days_to_trough) + '거래일</div>' +
        (m ? '<div class="meta">닮은 날 ' + F.day(m.date) + ' (고점 +' + m.day + '일, 거리 ' + F.num(m.distance, 2) + ') → 30일 ' +
          (m.fwd30 === null || m.fwd30 === undefined ? '—' : F.pct(m.fwd30, 1)) + ' · 90일 ' +
          (m.fwd90 === null || m.fwd90 === undefined ? '—' : F.pct(m.fwd90, 1)) + ' · 180일 ' +
          (m.fwd180 === null || m.fwd180 === undefined ? '—' : F.pct(m.fwd180, 1)) + '</div>' : '') +
        '</a>';
    }).join('');

    var html =
      '<article class="panel">' +
        '<div class="row" style="justify-content:space-between"><div class="g-sub" style="margin:0">지금 위치</div>' +
          '<span class="badge live">' + esc(now.source) + ' · ' + F.day(now.as_of) + '</span></div>' +
        '<dl class="kv" style="margin-top:8px">' +
          '<div><dt>지수 종가</dt><dd>' + F.fixed(now.close, 2) + '</dd></div>' +
          '<div><dt>고점 대비 낙폭</dt><dd class="neg">' + F.pct(now.dd, 2) + '</dd></div>' +
          '<div><dt>고점 · 경과</dt><dd>' + F.day(now.peak_date) + ' <small>' + now.offset + '거래일</small></dd></div>' +
          '<div><dt>200일선 이격</dt><dd>' + F.pct(now.gap, 2) + '</dd></div>' +
          '<div><dt>일간 RSI(14)</dt><dd>' + F.num(now.rsi) + '</dd></div>' +
          '<div><dt>VIX / 50일 평균</dt><dd>' + F.fixed(now.vix, 2) + ' <small>' + F.num(now.vix_ratio, 2) + '배 · 1년 ' + F.num(now.vix_pct, 1) + '%</small></dd></div>' +
        '</dl>' +
        '<p class="note">' + esc(now.window_note) + '</p>' +
      '</article>' +
      overlapCard(cases) +
      '<article class="panel">' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>사례</th><th>고점</th><th>저점</th><th>낙폭</th><th>저점까지</th><th>회복까지</th>' +
          '<th>지금과 닮은 날</th><th>거리</th><th>30일</th><th>90일</th><th>180일</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="note">오른쪽 세 열(30·90·180일)은 닮은 날 이후 그만큼 <b>거래일</b>이 지난 뒤의 수익률입니다. 자료에 없는 칸은 —로 비웠습니다. ' +
          '거리 = 네 지표(낙폭·200일선·RSI·VIX)의 차이를 각 10눈금으로 나눈 평균. 작을수록 닮았습니다. VIX가 없던 1929·1987은 세 지표로만 계산합니다. 줄을 누르면 사례 상세가 열립니다.</p>' +
        '<div class="case-grid" style="margin-top:10px">' + cards + '</div>' +
      '</article>';

    if (detailId) {
      var c = Data.caseById(detailId);
      html += c ? crashDetailHtml(c) : '<div class="panel"><div class="empty">없는 사례입니다. <a href="#/gauge">매수 지표로</a></div></div>';
    }
    return html;
  }

  function crashDetailHtml(c) {
    var cases = Data.crashes.cases;
    var idx = cases.indexOf(c);
    var prev = cases[(idx - 1 + cases.length) % cases.length];
    var next = cases[(idx + 1) % cases.length];
    var m = c.now_match;
    function metric(label, val, unit, digits) {
      return '<div><dt>' + label + '</dt><dd>' + (val === null || val === undefined ? '—' : F.fixed(val, digits === undefined ? 2 : digits)) +
        (val === null || val === undefined ? '' : (unit || '')) + '</dd></div>';
    }
    var picks = [0, 5, 10, 22, 30, 45, 60, 90, 120, 180, 252];
    var pointRows = picks.map(function (d) {
      var p = null;
      (c.path || []).forEach(function (q) { if (Math.abs(q[0] - d) <= 1.5) p = q; });
      return '<tr><td class="mono">+' + d + '</td><td class="mono">' + (p ? F.pct(p[1], 2) : '—') + '</td></tr>';
    }).join('');

    return '<article class="panel g-case-detail" id="gCase" data-case-id="' + c.id + '">' +
      '<div class="row" style="justify-content:space-between"><div><div class="g-sub" style="margin:0;color:' + c.color + '">' + esc(c.name) + '</div>' +
        '<div class="g-cap">' + esc(c.tag) + ' · ' + esc(c.index) + ' 기준 · 고점 ' + F.day(c.peak) + ' (' + F.fixed(c.peak_close, 2) + ') → 저점 ' +
          F.day(c.trough) + ' (' + F.fixed(c.trough_close, 2) + ')</div></div>' +
        '<a class="btn ghost sm" href="#/gauge/crash">목록으로</a></div>' +
      '<div class="row" style="justify-content:space-between;margin-top:10px"><div class="g-sub" style="margin:0">경로</div>' +
        '<span class="g-seg"><button type="button" data-scale="peak">고점 기준</button><button type="button" data-scale="trough">저점 기준</button></span></div>' +
      '<div class="chart-box" id="gCaseChart"></div>' +
      '<p class="note" id="gCaseNote"></p>' +
      '<div class="grid g2" style="margin-top:12px">' +
        '<div><div class="g-sub">사례 값</div><dl class="kv">' +
          metric('최대 낙폭', c.dd, '%', 1) +
          metric('저점까지', c.days_to_trough, '거래일', 0) +
          metric('전고점 회복까지', c.days_to_recovery, '거래일', 0) +
          '<div><dt>최악의 하루</dt><dd style="font-size:13px">' + esc(c.worst || '—') + '</dd></div>' +
          '<div><dt>' + BUY + '점 첫 돌파</dt><dd style="font-size:13px">' + esc(c.first90 || '—') + '</dd></div>' +
          metric('고점 당시 점수', c.peak_score, '점', 0) +
          metric('저점 당시 점수', c.trough_score, '점', 0) +
        '</dl></div>' +
        '<div><div class="g-sub">고점 당시 지표</div><dl class="kv">' +
          metric('RSI(14)', c.peak_rsi, '', 1) +
          metric('200일선 이격', c.peak_gap, '%', 1) +
          metric('VIX', c.peak_vix, '', 2) +
          metric('20일 실현변동성', c.peak_vol, '%', 1) +
          metric('CAPE', c.peak_cape, '', 2) +
          metric('미 10년 금리', c.peak_10y, '%', 2) +
        '</dl><p class="note">비어 있는 값(—)은 원본에 그 값이 없는 것입니다. 지어내지 않았습니다.</p></div>' +
      '</div>' +
      (m ? '<div style="margin-top:12px"><div class="row" style="justify-content:space-between"><div class="g-sub" style="margin:0">지금과 닮은 날</div>' +
        '<span class="badge blue">거리 ' + F.num(m.distance, 2) + '</span></div>' +
        '<p class="sub-line">' + F.day(m.date) + ' (고점 +' + m.day + '거래일) · 낙폭 ' + F.pct(m.dd, 1) +
          ' · 200일선 ' + F.pct(m.gap, 1) + ' · RSI ' + F.num(m.rsi) + ' · VIX ' + F.num(m.vix, 2) + '</p>' +
        '<dl class="kv" style="margin-top:10px">' +
          '<div><dt>그 날 이후 30거래일</dt><dd class="' + (m.fwd30 !== null && m.fwd30 < 0 ? 'neg' : 'pos') + '">' + F.pct(m.fwd30, 1) + '</dd></div>' +
          '<div><dt>90거래일</dt><dd class="' + (m.fwd90 !== null && m.fwd90 < 0 ? 'neg' : 'pos') + '">' + F.pct(m.fwd90, 1) + '</dd></div>' +
          '<div><dt>180거래일</dt><dd class="' + (m.fwd180 !== null && m.fwd180 < 0 ? 'neg' : 'pos') + '">' + F.pct(m.fwd180, 1) + '</dd></div>' +
        '</dl>' +
        '<p class="sub-line" style="margin-top:8px">같은 경과일(지금 = 고점 +' + Data.now().offset + '거래일)에서 이 사례의 낙폭은 ' +
          (c.sameDay === null || c.sameDay === undefined ? '—' : F.pct(c.sameDay, 1)) + ' 입니다.</p>' +
        '<div class="notice"><b>닮은 지점은 \'그때 이랬다\'만 알려줍니다.</b> \'그래서 그다음에 왜 그렇게 됐는지\'는 알려주지 않습니다.' +
          (m.metricsUsed < 4 ? '<div class="dim small" style="margin-top:4px">이 사례는 원본 자료에 VIX가 없어 <b>세 지표로만</b> 거리를 쟀습니다.</div>' : '') + '</div>' +
        '<div class="row" style="margin-top:6px"><a class="g-jump" href="#/journal/verify">이 날을 과거 대입에서 보기 →</a></div>' +
        '</div>' : '') +
      '<div class="grid g2" style="margin-top:12px">' +
        '<div><div class="g-sub">고점에서 보였던 것</div><ul class="list">' + (c.seen || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
        '<div><div class="g-sub">끝까지 보이지 않던 것</div><ul class="list">' + (c.unseen || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '</div>' +
      '<div style="margin-top:12px"><div class="g-sub">고점 이후 낙폭표</div>' +
        '<div class="tbl-wrap" style="max-height:300px;overflow-y:auto"><table class="tbl"><thead><tr><th>고점 +경과일</th><th>낙폭</th></tr></thead><tbody>' +
        pointRows + '</tbody></table></div>' +
        (c.ref ? '<p class="note">참고 — 원본 PDF가 지목한 가장 가까운 날: ' + F.day(c.ref.date) + ' (고점 +' + c.ref.d + ', 낙폭 ' + F.pct(c.ref.dd, 1) + ')</p>' : '') +
      '</div>' +
      '<div class="row" style="justify-content:space-between;margin-top:10px">' +
        '<a class="btn ghost sm" href="#/gauge/crash/' + prev.id + '">← ' + esc(prev.short) + '</a>' +
        '<a class="btn ghost sm" href="#/gauge/crash">목록</a>' +
        '<a class="btn ghost sm" href="#/gauge/crash/' + next.id + '">' + esc(next.short) + ' →</a>' +
      '</div>' +
    '</article>';
  }

  /* ------------------------------------------------------------ 차트 그리기 */

  function drawCharts(view, t, monthPts, nowScore) {
    var host = el('#gMonth', view);
    if (host && monthPts.length >= 2) {
      var lo = Math.max(0, Math.min.apply(null, monthPts.map(function (p) { return p[1]; })) - 3);
      var hi = Math.min(100, Math.max.apply(null, monthPts.map(function (p) { return p[1]; })) + 3);
      Charts.line(host, {
        height: 160,
        series: [{ name: '밸류게이지', color: '#6a9ae0', points: monthPts.map(function (p, i) { return [i, p[1]]; }), width: 1.8 }],
        xMin: 0, xMax: monthPts.length - 1, yMin: lo, yMax: hi,
        yTicks: [Math.round(lo), BUY, Math.round(hi)].filter(function (v, i2, arr) { return arr.indexOf(v) === i2; }).sort(function (a, b) { return a - b; }),
        xTicks: [{ x: 0, label: F.day(monthPts[0][0]).slice(5) }, { x: monthPts.length - 1, label: F.day(monthPts[monthPts.length - 1][0]).slice(5) }],
        hlines: [{ y: BUY, color: '#3f8168', label: String(BUY), dash: '4 4' }],
        markers: [{ x: monthPts.length - 1, y: monthPts[monthPts.length - 1][1], color: '#43b795', r: 3.5,
          label: '지금 ' + F.num(monthPts[monthPts.length - 1][1]), anchor: 'end' }]
      });
    } else if (host) {
      host.innerHTML = '<div class="empty">이력이 쌓이는 중입니다.</div>';
    }

    var flow = el('#gFlow', view);
    var weekly = (Data.gauge.weekly[t] || []).map(function (p) { return p.slice(); });
    /* 원본과 같이 마지막 주는 '오늘 값 그대로' — 카드의 점수와 차트 끝점이 어긋나지 않게 */
    if (weekly.length && nowScore !== undefined && nowScore !== null) {
      weekly[weekly.length - 1][1] = nowScore;
    }
    if (flow && weekly.length >= 3) {
      var pts = weekly.map(function (p, i) { return [i, p[1]]; });
      /* 가로 눈금 — 해가 바뀌는 첫 주에 2년 간격으로 */
      var ticks = [];
      var lastYear = '';
      weekly.forEach(function (p, i) {
        var y = p[0].slice(0, 4);
        if (y === lastYear) return;
        lastYear = y;
        if (Number(y) % 2 === 0) ticks.push({ x: i, label: y.slice(2) + '년' });
      });
      if (!ticks.length || ticks[ticks.length - 1].x !== weekly.length - 1) {
        ticks.push({ x: weekly.length - 1, label: weekly[weekly.length - 1][0].slice(2, 4) + '년' });
      }
      Charts.line(flow, {
        height: 180,
        series: [{ name: '밸류게이지', color: '#6a9ae0', points: pts, width: 1.7 }],
        xMin: 0, xMax: weekly.length - 1, yMin: 30, yMax: 100,
        yTicks: [30, 60, 80, 100], xTicks: ticks,
        hlines: [{ y: BUY, color: '#3f8168', label: String(BUY), dash: '4 4' }],
        markers: [{ x: weekly.length - 1, y: weekly[weekly.length - 1][1], color: '#43b795', label: '오늘 ' + F.num(weekly[weekly.length - 1][1]), r: 3.5, anchor: 'end' }]
      });
    } else if (flow) {
      flow.innerHTML = '<div class="empty">이력이 쌓이는 중입니다.</div>';
    }
  }

  function drawCrashChart(view, c) {
    var host = el('#gCaseChart', view);
    if (!host) return;
    if (crashScale === 'trough') {
      var pts = (c.troughPath || []).map(function (p) { return [p[0], p[1]]; });
      if (!pts.length) { host.innerHTML = '<div class="empty">저점 기준 경로가 없습니다.</div>'; return; }
      Charts.line(host, {
        height: 260,
        series: [{ name: '저점 대비', color: c.color, points: pts }],
        xMin: pts[0][0], xMax: pts[pts.length - 1][0],
        xTicks: [pts[0][0], -126, 0, 126, pts[pts.length - 1][0]].map(function (x) { return { x: x, label: (x > 0 ? '+' : '') + x }; }),
        hlines: [{ y: 0, color: '#5d7096', label: '저점 = 0%', dash: '4 4' }],
        markers: [{ x: 0, y: 0, color: c.color, label: '저점', r: 4 }],
        yDigits: 0
      });
      el('#gCaseNote', view).textContent = '저점 종가를 0%로 두고 저점 252거래일 전부터 252거래일 뒤까지. 자료: ' +
        (c.troughFrom || '?') + ' ~ ' + (c.troughTo || '?') + '. 세로축은 저점 대비 %입니다.';
    } else {
      var all = (c.prePath || []).concat(c.path || []).map(function (p) { return [p[0], p[1]]; });
      if (!all.length) { host.innerHTML = '<div class="empty">고점 기준 경로가 없습니다.</div>'; return; }
      var minY = Math.min.apply(null, all.map(function (p) { return p[1]; }));
      var ti = 0;
      all.forEach(function (p, i) { if (p[1] < all[ti][1]) ti = i; });
      Charts.line(host, {
        height: 260,
        series: [{ name: '고점 대비', color: c.color, points: all }],
        xMin: all[0][0], xMax: all[all.length - 1][0],
        xTicks: [{ x: -252, label: '-252' }, { x: 0, label: '고점' }, { x: 126, label: '+126' }, { x: all[all.length - 1][0], label: '+' + all[all.length - 1][0] }],
        yMin: Math.min(0, Math.floor(minY / 10) * 10), yMax: 10,
        hlines: [{ y: 0, color: '#5d7096', label: '고점 = 0%' }],
        vlines: [{ x: 0, color: '#5d7096' }],
        markers: [{ x: all[ti][0], y: all[ti][1], color: '#e8ecf4', label: '최저 ' + F.pct(all[ti][1], 1), r: 4 }],
        yDigits: 0
      });
      el('#gCaseNote', view).textContent = '고점 종가를 0%로 두고 고점 252거래일 전부터 252거래일 뒤까지. 고점 전 자료는 ' +
        (c.preFrom ? c.preFrom + '부터' : '없음') + ' · 일봉 종가.';
    }
  }

  /* ------------------------------------------------------------ 실시간 갱신(점수·막대·레이더) */

  /* 한 벌(snapshot)에서 점수·막대·판정·레이더·가격·표를 같은 순간에 다시 그린다.
     슬라이더를 움직이면 이 함수 하나만 돌므로 일부만 갱신되는 일이 없다. */
  function updateLive(view, t) {
    var snap = snapshot(t);
    var values = snap.values, result = snap.result, v = snap.verdict, axes = snap.axes;
    var meta = liveInfo(t);
    var info = priceInfo(snap);

    var priceEl = el('#gPrice', view); if (priceEl) priceEl.textContent = '$' + F.fixed(info.price, 2);
    var ptag = el('#gPriceTag', view);
    if (ptag) { ptag.textContent = info.tag; ptag.className = 'badge ' + info.badgeCls; }
    var pnote = el('#gPriceNote', view); if (pnote) pnote.innerHTML = priceNoteHtml(snap, info);
    var duo = el('#gDuo', view); if (duo) duo.innerHTML = duoHtml(snap, meta);
    var six = el('#gSix', view); if (six) six.innerHTML = sixLine(values);
    var mnote = el('#gModeNote', view); if (mnote) mnote.innerHTML = modeNote(snap);

    var scoreEl = el('#gScore', view); if (scoreEl) scoreEl.textContent = trim1(result.score);
    var badge = el('#gBadge', view);
    if (badge) {
      badge.textContent = badgeOf(result.score);
      badge.className = 'badge ' + (result.score >= BUY ? 'good' : 'grey');
    }
    var vd = el('#gVerdict', view);
    if (vd) { vd.textContent = v.label; vd.className = 'g-verdict g-tone-' + v.tone; }
    var vs = el('#gVerdictSub', view); if (vs) vs.textContent = v.sub;
    var bar = el('#gBar', view); if (bar) bar.style.width = Math.max(0, Math.min(100, result.score)) + '%';
    var hint = el('#gHint', view);
    if (hint) hint.textContent = result.score >= BUY
      ? '지금 매수 구간(' + BUY + ' 이상)입니다'
      : '매수 구간(' + BUY + ')까지 ' + trim1(BUY - result.score) + '점 남았습니다';
    var ct = el('#gContrib', view); if (ct) ct.textContent = contribText(result);
    var radar = el('#gRadar', view); if (radar) radar.innerHTML = radarSvg(axes);
    var state = el('#gState', view); if (state) state.innerHTML = stateHtml(axes, result.score);

    if (el('#ovChart', view)) drawOverlap(view, Data.crashes.cases);

    var rows = el('#gTrackTable', view);
    if (rows) {
      rows.innerHTML = result.rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="mono">' + (r.value === null ? '—' : fmtVal(r.key, r.value) + esc(r.unit || '')) +
          '</td><td class="mono">' + (r.converted === null ? '—' : F.num(r.converted)) +
          '</td><td class="mono">' + (r.contribution === null ? '—' : F.signed(r.contribution, 1)) + '</td></tr>';
      }).join('');
    }
    var sum = el('#gTrackSum', view);
    if (sum) sum.textContent = '값이 없는 지표는 빼고 남은 가중치 합(' + F.fixed(result.weightSum, 2) +
      ')으로 나눕니다. 기여도 합 ÷ 가중치 합 = ' + F.num(result.score) + '점.';

    /* 최근 한 달 일봉의 지금 점·점수 선도 같은 값에서 다시 그린다 */
    var barsHost = el('#gBars', view);
    if (barsHost) {
      var bars = monthBars(t), ld = meta && meta.barLive ? meta.barLive : null;
      barsHost.innerHTML = candleSvg(bars, ld, info.price, info.tag);
      var bsum = el('#gBarsSum', view);
      if (bsum) bsum.textContent = barSummary(bars, ld);
    }
    if (el('#gMonth', view)) drawCharts(view, t, monthScorePts(t, snap), result.score);
  }

  function recordNow(t) {
    var result = snapshot(t).result;
    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var at = F.day(F.today()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    var arr = S.get('gaugeTrack', []);
    var last = arr[arr.length - 1];
    if (last && last.at === at && last.target === t) return;
    arr.push({ at: at, target: t, score: result.score });
    if (arr.length > 60) arr = arr.slice(arr.length - 60);
    S.set('gaugeTrack', arr);
  }

  /* ------------------------------------------------------------ 이벤트 */

  /* 5분 갱신(live.js)이 새 live.json 을 받으면 이 화면도 다시 그린다 — 새 타이머를 만들지 않는다 */
  var NO_RECORD = false;
  var LIVE_SIG = null;   /* 마지막으로 그린 live.json 지문 — 값이 그대로면 화면을 다시 그리지 않는다 */
  document.addEventListener('stockrebal:live', function () {
    dropValues();
    if (location.hash.indexOf('#/gauge') !== 0) return;
    var v = liveView();
    if (!v || !v.querySelector('#gTop')) return;
    var ae = document.activeElement;
    if (ae && v.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return; /* 입력 중엔 손대지 않는다 */
    /* 새 live.json 이 왔는데 값이 실제로 그대로면 다시 그리지 않는다(깜박임 방지).
       '현재' 선도 같은 값으로 움직이므로 이 지문 하나로 함께 판단한다. */
    var doc = (w.Live && w.Live.data) ? w.Live.data() : null;
    var nd = ovNowPoint().dd;
    var sig = String((doc && doc.updatedAt) || '') + '|' + (nd === null || nd === undefined ? 'x' : Number(nd).toFixed(2));
    if (LIVE_SIG === sig) return;
    LIVE_SIG = sig;
    var m = location.hash.match(/^#\/gauge\/crash\/([\w-]+)/);
    NO_RECORD = true;
    rerender(v, m ? m[1] : null);
    NO_RECORD = false;
  });

  /* 화면 다시 그리기 — 스크롤 위치를 지키고, 상세(폭락 사례) 경로도 유지한다 */
  function rerender(view, detailId) {
    var y = (w.pageYOffset || 0);
    V.gauge(view, detailId || null);
    if (y) w.scrollTo(0, y);
  }

  function bind(view, t, detailId) {
    /* 섹션 접기/펴기 — 원본 GaugeUiState 자리. 펴면 차트를 다시 그린다(숨은 동안 폭이 0). */
    els(view, '[data-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-toggle');
        var sec = btn.closest('.g-sec');
        var body = sec.querySelector('.g-secbody');
        var open = body.hasAttribute('hidden');
        if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
        ST.open[key] = open;
        saveState();
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        var mark = btn.querySelector('.mark');
        if (mark) mark.textContent = open ? '접기 ▴' : '펼치기 ▾';
        if (open) {
          if (key === 'crash') {
            drawOverlap(view, Data.crashes.cases);
            var cid = el('#gCase', view);
            if (cid) drawCrashChart(view, Data.caseById(cid.getAttribute('data-case-id')));
          }
        }
      });
    });

    /* 대상 칩 */
    els(view, '[data-target]').forEach(function (b) {
      b.addEventListener('click', function () {
        ST.target = b.getAttribute('data-target');
        ST.edited = false;
        dropValues();
        saveState();
        rerender(view, detailId);
      });
    });

    /* 자동/수동 — 수동이면 지금 보이던 여섯 값을 복사해 입력값으로 시작한다 */
    els(view, '[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-mode');
        if (mode === ST.mode) return;
        if (mode === 'manual') {
          var cur = valuesRef(ST.target);
          ST.manual[ST.target] = {};
          IND.forEach(function (s) { ST.manual[ST.target][s.key] = cur[s.key]; });
        } else {
          ST.manual[ST.target] = null;
          ST.priceSrc = null;
          ST.priceVal = null;
        }
        ST.mode = mode;
        ST.edited = false;
        dropValues();
        saveState();
        recordNow(ST.target);
        rerender(view, detailId);
      });
    });

    /* 확정 종가 / 실시간(프리마켓) — 홈과 같은 Basis 저장값을 쓴다 */
    els(view, '[data-basis]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!w.Basis) return;
        var want = b.getAttribute('data-basis');
        if (want === Basis.get()) return;
        Basis.set(want);
        ST.edited = false;
        ST.priceSrc = null;
        dropValues();
        rerender(view, detailId);
      });
    });

    /* 실시간 새로고침 — live.js 의 같은 5분 경로를 부른다(새 타이머 없음).
       새 값은 'stockrebal:live' 신호로 이 화면에 다시 그려진다. */
    var rf = el('#gLiveRefresh', view);
    if (rf) rf.addEventListener('click', function () {
      if (!w.Basis) return;
      rf.disabled = true;
      rf.textContent = '불러오는 중…';
      var p = (w.Live && w.Live.refresh) ? w.Live.refresh()
        : Basis.load(true).then(function (doc) { if (doc && Basis.adopt) Basis.adopt(doc); return doc; });
      p.then(function () {
        if (!(w.Live && w.Live.refresh)) { dropValues(); rerender(view, detailId); }
        toast(Basis.status().hasLive ? '실시간 값을 다시 읽었습니다.' : 'live.json 이 없어 확정 종가로 남습니다.');
      });
    });

    /* 여섯 지표 펼치기/접기 */
    var ib = el('#gIndsBtn', view);
    if (ib) ib.addEventListener('click', function () {
      var box = el('#gInds', view);
      if (!box) return;
      var open = box.hasAttribute('hidden');
      if (open) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
      ST.open.inds = open;
      saveState();
      ib.setAttribute('aria-expanded', open ? 'true' : 'false');
      var mark = ib.querySelector('.mark');
      if (mark) mark.textContent = open ? '접기 ▴' : '펼치기 ▾';
    });

    /* 슬라이더·숫자 — 여섯 값이 유일한 입력. 만지면 점수·가격·레이더가 한 번에 따라온다. */
    els(view, '[data-slider]').forEach(function (sl) {
      sl.addEventListener('input', function () {
        var key = sl.getAttribute('data-slider');
        var v = Number(sl.value);
        valuesRef(ST.target)[key] = v;
        ST.edited = true;
        if (key === 'dd' || key === 'gap') ST.priceSrc = { t: ST.target, key: key };
        var num = el('[data-num="' + key + '"]', view);
        if (num && document.activeElement !== num) num.value = key === 'vixr' ? v.toFixed(2) : v.toFixed(1);
        updateLive(view, ST.target);
      });
    });
    els(view, '[data-num]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var key = inp.getAttribute('data-num');
        var v = numOrNull(inp.value);
        if (v === null) return;
        valuesRef(ST.target)[key] = v;
        ST.edited = true;
        if (key === 'dd' || key === 'gap') ST.priceSrc = { t: ST.target, key: key };
        var sl = el('[data-slider="' + key + '"]', view);
        if (sl) sl.value = String(v);
        updateLive(view, ST.target);
      });
    });

    /* 지표 추적 — 지금 값 기록 */
    var tn = el('#gTrackNow', view);
    if (tn) tn.addEventListener('click', function () {
      recordNow(ST.target);
      rerender(view, detailId);
      toast('지금 값을 기록했습니다.');
    });

    /* 겹쳐 보기 — 보기 3가지 */
    els(view, '[data-ovscale]').forEach(function (b) {
      b.addEventListener('click', function () {
        OV.scale = b.getAttribute('data-ovscale');
        S.set('crashOv', OV.scale);
        els(view, '[data-ovscale]').forEach(function (x) { x.classList.toggle('on', x === b); });
        drawOverlap(view, Data.crashes.cases);
      });
    });

    /* 겹쳐 보기 — 저점 기준 창(6개월 단위 0.5~3년) */
    var owin = el('#ovWin', view);
    if (owin) owin.addEventListener('input', function () {
      var wv = Number(owin.value);
      OV.win = OV_WINS.indexOf(wv) >= 0 ? wv : 1;
      S.set('crashWin', OV.win);
      var lab = el('#ovWinLab', view);
      if (lab) lab.textContent = ovWinText(OV.win);
      drawOverlap(view, Data.crashes.cases);
    });

    /* 겹쳐 보기 — 사례 칩 켜고 끄기 (사례·전체·현재 한 곳에서) */
    els(view, '[data-ovcase]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-ovcase');
        var i = OV_OFF.indexOf(id);
        if (i >= 0) OV_OFF.splice(i, 1); else OV_OFF.push(id);
        ovChipsSync(view, Data.crashes.cases);
        drawOverlap(view, Data.crashes.cases);
      });
    });

    /* 겹쳐 보기 — 전체 한 번에(사례 6개 + 현재) */
    els(view, '[data-ovall]').forEach(function (b) {
      b.addEventListener('click', function () {
        var cases = Data.crashes.cases;
        var turnOn = !ovAllOn(cases);
        OV_OFF.length = 0;
        if (!turnOn) {
          cases.forEach(function (c) { OV_OFF.push(c.id); });
          OV_OFF.push('today');
        }
        S.set('crashTodayOff', !turnOn);
        ovChipsSync(view, cases);
        drawOverlap(view, cases);
      });
    });

    /* 겹쳐 보기 — 현재 선 토글 */
    els(view, '[data-ovtoday]').forEach(function (b) {
      b.addEventListener('click', function () {
        ovSetToday(!ovTodayOn());
        ovChipsSync(view, Data.crashes.cases);
        drawOverlap(view, Data.crashes.cases);
      });
    });

    /* 겹쳐 보기 — 짚어보기(포인터·터치 이동) */
    var ovHost = el('#ovChart', view);
    if (ovHost) {
      var readAt = function (clientX) {
        var o = ovHost.__ov;
        if (!o) return;
        var r = ovHost.getBoundingClientRect();
        if (!r.width) return;
        var vx = (clientX - r.left) / r.width * o.W;
        var box = el('#ovReadout', view);
        if (o.kind === 'date') {
          var ms = o.x0 + (vx - o.pad.l) / (o.W - o.pad.l - o.pad.r) * (o.x1 - o.x0);
          if (box) box.innerHTML = ovDateReadout(ms, o.series, o.today);
          return;
        }
        var lim3 = 252 * (OV.win || 1);
        var day = Math.round((vx - o.pad.l) / (o.W - o.pad.l - o.pad.r) * (2 * lim3) - lim3);
        day = Math.max(-lim3, Math.min(lim3, day));
        if (box) box.innerHTML = ovReadoutText(day, o.scale, o.today, o.series, view);
      };
      ovHost.addEventListener('mousemove', function (e) { readAt(e.clientX); });
      ovHost.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches[0]) readAt(e.touches[0].clientX);
      }, { passive: true });
      ovHost.addEventListener('mouseleave', function () {
        drawOverlap(view, Data.crashes.cases);
      });
    }

    /* 폭락 표 줄 → 상세 */
    els(view, '.g-crashrow').forEach(function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/gauge/crash/' + tr.getAttribute('data-case'); });
    });

    /* 고점/저점 기준 */
    els(view, '[data-scale]').forEach(function (b) {
      b.addEventListener('click', function () {
        crashScale = b.getAttribute('data-scale');
        els(view, '[data-scale]').forEach(function (x) { x.classList.toggle('on', x === b); });
        var cid = el('#gCase', view);
        if (cid) drawCrashChart(view, Data.caseById(cid.getAttribute('data-case-id')));
      });
    });
    els(view, '[data-scale]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-scale') === crashScale);
    });

    if (!NO_RECORD) recordNow(t);
  }

  /* 가격·VIX → 여섯 지표 (원본 Gauge.valuesFromInputs 와 같은 식)
     화면에서는 빼었지만(값 직접 입력 삭제) Basis.pairFor 가 live.json 에 값이 없을 때
     이 함수로 실시간 값을 낸다. */
  function valuesFromInputs(pack, price, vixLevel) {
    if (!pack || !pack.closes || pack.closes.length < 260) return null;
    var closes = pack.closes.slice();
    closes[closes.length - 1] = price;
    var peak = pack.peak5y;
    for (var i = 0; i < closes.length; i++) if (closes[i] > peak) peak = closes[i];
    var ma200 = avg(closes.slice(-200));
    var drsi = wilderRsi(closes);
    var weeks = pack.weeks.slice();
    weeks[weeks.length - 1] = price;
    var wrsi = wilderRsi(weeks);
    var vx = pack.vix.slice();
    var ma50 = avg(vx.slice(-50));
    if (!(peak > 0) || !(ma200 > 0) || !(ma50 > 0) || !vx.length) return null;
    var win = vx.slice(-252);
    var cnt = 0;
    win.forEach(function (v) { if (v <= vixLevel) cnt++; });
    return {
      dd: Math.abs((price / peak - 1) * 100),
      wrsi: wrsi,
      vixr: vixLevel / ma50,
      gap: (price / ma200 - 1) * 100,
      drsi: drsi,
      vixp: cnt / win.length * 100
    };
  }

  function avg(arr) {
    if (!arr || !arr.length) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function wilderRsi(closes, n) {
    n = n || 14;
    if (!closes || closes.length < n + 1) return null;
    var g = 0, l = 0, i, ch;
    for (i = 1; i <= n; i++) {
      ch = closes[i] - closes[i - 1];
      if (ch > 0) g += ch; else l -= ch;
    }
    var ag = g / n, al = l / n;
    for (i = n + 1; i < closes.length; i++) {
      ch = closes[i] - closes[i - 1];
      ag = (ag * (n - 1) + Math.max(ch, 0)) / n;
      al = (al * (n - 1) + Math.max(-ch, 0)) / n;
    }
    if (al === 0) return 100;
    return 100 - 100 / (1 + ag / al);
  }

  /* 다른 파일(app.js)이 읽는 계산 결과 — 검증 스크립트가 같은 식을 부른다 */
  w.GaugeMath = {
    IND: IND, convert: convert, scoreOf: scoreOf, verdictOf: verdictOf,
    valuesFromInputs: valuesFromInputs, wilderRsi: wilderRsi
  };

  /* ------------------------------------------------------------ 기준(정규장/프리마켓)과 실시간 값
   *
   * 원본 MarketScreen 의 [정규장]/[프리마켓] 두 탭과 같은 구분이다. 고른 기준은 홈·매수 지표가
   * 함께 쓴다. 값은 data/live.json(5분 갱신 작업이 만든다)을 읽고, 없으면 확정 종가로 남는다.
   */
  var LIVE = { json: null, tried: false, promise: null };

  function poolGet(obj, sym) {
    if (!obj || typeof obj !== 'object') return null;
    var keys = [sym, sym.replace('^', ''), sym.toUpperCase(), sym.replace('^', '').toUpperCase()];
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v === undefined) continue;
      if (typeof v === 'number') return { last: v };
      if (v && typeof v === 'object') return v;
    }
    return null;
  }

  function findSym(sym) {
    var j = LIVE.json;
    if (!j) return null;
    var pools = [j, j.symbols, j.quotes, j.prices, j.bySymbol, j.data, j.tickers];
    for (var i = 0; i < pools.length; i++) {
      var hit = poolGet(pools[i], sym);
      if (hit) return hit;
    }
    return null;
  }

  function num(v) { return (v === null || v === undefined || isNaN(v)) ? null : Number(v); }

  function etSession(iso) {
    if (!iso) return null;
    var ms = Date.parse(iso);
    if (isNaN(ms)) return null;
    var et = new Date(ms - 5 * 3600 * 1000); /* 동부 표준시 기준(서머타임 보정 없음) */
    var h = et.getUTCHours() + et.getUTCMinutes() / 60;
    var word = h >= 4 && h < 9.5 ? '장전' : (h >= 9.5 && h < 16 ? '정규' : (h >= 16 && h < 20 ? '장후' : '시간외'));
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return { word: word, hhmm: pad(et.getUTCHours()) + ':' + pad(et.getUTCMinutes()) };
  }

  function kstTime(iso) {
    var ms = Date.parse(iso);
    if (isNaN(ms)) return null;
    var k = new Date(ms + 9 * 3600 * 1000);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(k.getUTCHours()) + ':' + pad(k.getUTCMinutes());
  }

  var Basis = {
    get: function () { return S.get('basis', 'close') === 'live' ? 'live' : 'close'; },
    set: function (v) { S.set('basis', v === 'live' ? 'live' : 'close'); },
    load: function (force) {
      if (force) LIVE.promise = null;
      if (LIVE.promise) return LIVE.promise;
      LIVE.promise = fetch('data/live.json' + (force ? '?t=' + Date.now() : ''), { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('live.json ' + r.status);
        return r.json();
      }).then(function (j) {
        LIVE.json = j; LIVE.tried = true; return j;
      }).catch(function () { LIVE.json = null; LIVE.tried = true; return null; });
      return LIVE.promise;
    },
    json: function () { return LIVE.json; },
    quote: function (sym) {
      var e = findSym(sym);
      if (!e) return null;
      var price = num(e.last) || num(e.price) || num(e.close);
      if (price === null) return null;
      var at = e.lastTime || e.time || e.asOf || (LIVE.json && LIVE.json.updatedAt) || null;
      var sess = etSession(at);
      var chg = num(e.changePct);
      if (chg === null) {
        var prev = num(e.prevClose) || num(e.previousClose);
        if (prev && prev > 0) chg = (price / prev - 1) * 100;
      }
      return {
        sym: sym, price: price, changePct: chg, at: at,
        close: num(e.close) || num(e.regularClose) || num(e.prevClose) || num(e.previousClose),
        session: sess ? sess.word : null, hhmm: sess ? sess.hhmm : kstTime(at),
        source: e.source || (LIVE.json && LIVE.json.source) || 'live.json'
      };
    },
    /* 그 기준의 여섯 지표 — live.json 의 가격·VIX 로 자동과 같은 식으로 다시 낸다 */
    valuesFor: function (target) {
      if (Basis.get() !== 'live') return null;
      return Basis.liveFor(target);
    },
    /* 기준과 무관하게 실시간 값을 본다(확정 화면에서도 옆에 나란히 보여 주기 위해) */
    liveFor: function (target) {
      if (!Data.gauge || !Data.gauge.targets || !Data.gauge.targets[target]) return null;
      return Basis.pairFor(target);
    },
    /* 확정(종가) 점수 — live.json 이 마지막 완료 정규장으로 매일 다시 계산해 둔 값 */
    confirmed: function (target) {
      var sym = target === 'ndx' ? 'TQQQ' : 'SOXL';
      var e = findSym(sym);
      if (!e || e.score === null || e.score === undefined || !e.scoreRows || !e.scoreAsOf) return null;
      var d = e.scoreDetail || {}, vx = d.vix || {};
      return {
        score: num(e.score), rows: e.scoreRows, verdict: e.scoreVerdict, asOf: e.scoreAsOf,
        values: e.scoreValues || null, close: num(d.close), peak: num(d.peak), ma200: num(d.ma200),
        dd: num(d.dd), vix: num(vx.last), ma50_vix: num(vx.ma50), vix_samples: vx.samples || null
      };
    },
    /* 최근 한 달 일봉 — 파이프라인이 5년 일봉에서 잘라 live.json 에 넣는다 */
    dayBars: function (target) {
      var sym = target === 'ndx' ? 'TQQQ' : 'SOXL';
      var e = findSym(sym);
      if (!e || !e.dayBars || !e.dayBars.length) return null;
      var out = [];
      e.dayBars.forEach(function (b) {
        var d = b.d || b.date, o = num(b.o), h = num(b.h), l = num(b.l), c = num(b.c);
        if (!d || c === null) return;
        out.push([d, o === null ? c : o, h === null ? Math.max(o || c, c) : h, l === null ? Math.min(o || c, c) : l, c]);
      });
      return out.length ? out : null;
    },
    /* live.json 을 다른 곳(live.js 5분 갱신)이 새로 받았을 때 이 사본도 갈아 끼운다 */
    adopt: function (doc) {
      if (doc && doc.updatedAt) { LIVE.json = doc; LIVE.tried = true; LIVE.promise = null; }
    },
    /* 지표 추적 머리에 적을 실시간 정보 — 점수·값·시각·세션·파일 갱신 시각 */
    meta: function (target) {
      if (!target) target = 'ndx';
      var sym = target === 'ndx' ? 'TQQQ' : 'SOXL';
      var e = findSym(sym);
      if (!e) return null;
      var j = LIVE.json || {};
      var at = e.lastTimeEt || e.time || null;
      var sess = e.sessionLabel || (j.market && j.market.sessionLabel) || null;
      var ageMin = null;
      if (j.updatedAt) {
        var ts = Date.parse(j.updatedAt);
        if (!isNaN(ts)) ageMin = Math.round((Date.now() - ts) / 60000);
      }
      var mk = j.market || {};
      /* 반나절 장 뒤에는 market.session 이 'regular' 로 남을 수 있다 — 봉 표시는 그 종목의
         scoreLiveBasis(진행 중인 봉을 얹었는지)로 정한다. post 면 그날 봉은 이미 끝난 것으로 본다. */
      var liveSess = e.scoreLiveBasis === 'pre' || e.scoreLiveBasis === 'regular';
      return {
        score: num(e.scoreLive), values: e.scoreLiveValues || null,
        asOf: e.scoreLiveAsOf || null,
        price: num(e.scoreLivePrice) || num(e.last),
        atEt: at, sessionLabel: sess,
        updatedAtKst: j.updatedAtKst || null, ageMin: ageMin,
        basis: e.scoreLiveBasis || null,
        etDate: mk.etDate || null,
        barLive: liveSess ? (mk.etDate || null) : null
      };
    },
    /* 대상 가격·VIX 한 쌍 — live.json 이 이미 계산해 둔 scoreLiveValues 가 있으면 그것을 쓴다(같은 식) */
    pairFor: function (target) {
      var sym = target === 'ndx' ? 'TQQQ' : 'SOXL';
      var entry = findSym(sym);
      var vq = Basis.quote('^VIX') || Basis.quote('VIX');
      if (entry && entry.scoreLiveValues && vq) {
        return {
          values: entry.scoreLiveValues,
          price: num(entry.scoreLivePrice) || num(entry.last),
          vix: num(vq.price),
          quote: Basis.quote(sym),
          at: entry.lastTime || null,
          score: num(entry.scoreLive),
          file: true   /* live.json 이 계산해 둔 값 — VIX도 그때 쓴 확정 종가 */
        };
      }
      var pq = Basis.quote(sym);
      if (!pq || !vq) return null;
      var vals = valuesFromInputs(Data.gauge.targets[target].recompute, pq.price, vq.price);
      if (!vals) return null;
      return { values: vals, price: pq.price, vix: vq.price, quote: pq, at: pq.at };
    },
    status: function () {
      var j = LIVE.json;
      if (!j) return { hasLive: false, at: null, label: null };
      var q = Basis.quote('TQQQ') || Basis.quote('SOXL');
      if (!q) return { hasLive: false, at: null, label: null };
      var mk = (j && j.market) || {};
      return {
        hasLive: true, at: q.at,
        session: mk.sessionLabel || q.session || '프리마켓', hhmm: q.hhmm,
        label: '실시간(추정) · ' + (q.session ? q.session + ' ' : '') + (q.hhmm || '시각 없음')
      };
    }
  };

  w.Basis = Basis;

  if (!Data.loadLive) {
    Data.loadLive = function () { return Basis.load(); };
  }

  /* 증시 탭 등 다른 파일이 채운다 — 없으면 준비 중 안내(죽은 링크 방지) */

  if (!Data.loadGauge) {
    Data.loadGauge = function () {
      if (Data.gauge) return Promise.resolve(Data.gauge);
      if (!Data._gaugePromise) {
        Data._gaugePromise = fetch('data/gauge.json', { cache: 'no-cache' }).then(function (r) {
          if (!r.ok) throw new Error('data/gauge.json ' + r.status);
          return r.json();
        }).then(function (j) { Data.gauge = j; return j; }).catch(function (e) {
          Data._gaugePromise = null;
          throw e;
        });
      }
      return Data._gaugePromise;
    };
  }
})(window);
