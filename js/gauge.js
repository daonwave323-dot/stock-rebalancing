/* 매수 지표 탭 — 원본 앱 GaugeScreen(밸류게이지) 을 웹으로 옮긴 화면.
 *
 * 원본 구성(위에서 아래로): 대상 칩·가격 → 기준 줄 → 값 직접 입력(접힘) → 밸류게이지 카드 →
 * 문턱 통계 → 육각 레이더 → 최근 한 달 두 차트 → 전체 흐름 → 지표 추적(접힘) → 폭락 비교(접힘).
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

  var ST = { target: 'ndx', mode: 'auto', manual: {}, open: {} };
  var LIVE = {};
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
    if (s >= 90) return { label: '계획의 50% 투입', sub: '역사적 바닥 구간입니다', tone: 'good', level: 90 };
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
    LIVE = {};
  }
  function saveState() {
    S.set('gauge', { target: ST.target, mode: ST.mode, manual: ST.manual, open: ST.open });
  }

  function autoValues(t) {
    var T = Data.gauge.targets[t], o = {};
    T.rows.forEach(function (r) {
      if (r.raw === null || r.raw === undefined) { o[r.key] = null; return; }
      o[r.key] = r.key === 'dd' ? Math.abs(r.raw) : r.raw;
    });
    return o;
  }

  function liveValues(t) {
    if (!LIVE[t]) {
      var base = autoValues(t);
      if (ST.mode === 'manual' && ST.manual[t]) {
        IND.forEach(function (s) {
          var v = ST.manual[t][s.key];
          if (v !== null && v !== undefined && !isNaN(v)) base[s.key] = v;
        });
      }
      LIVE[t] = base;
    }
    return LIVE[t];
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

  function candleSvg(bars) {
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
    bars.forEach(function (b, i) {
      var up = b[4] >= b[1];
      var col = up ? 'var(--green)' : 'var(--red)';
      s.push('<line x1="' + x(i).toFixed(1) + '" y1="' + y(b[2]).toFixed(1) + '" x2="' + x(i).toFixed(1) + '" y2="' + y(b[3]).toFixed(1) + '" stroke="' + col + '" stroke-width="1"/>');
      var y0 = y(Math.max(b[1], b[4])), y1 = y(Math.min(b[1], b[4]));
      s.push('<rect x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, y1 - y0).toFixed(1) + '" fill="' + col + '"/>');
    });
    s.push('</svg>');
    return s.join('');
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
    if (!G.axes) G.axes = AXES;

    var t = ST.target, T = G.targets[t];
    var values = liveValues(t);
    var result = scoreOf(values, t);
    var v = verdictOf(result.score);
    var axes = axesOf(values, t);
    var D = T.detail, S_ = T.stat;

    var chips = '<button type="button" class="g-chip-target ' + (t === 'ndx' ? 'on' : '') + '" data-target="ndx">나스닥 TQQQ</button>' +
      '<button type="button" class="g-chip-target ' + (t === 'sox' ? 'on' : '') + '" data-target="sox">반도체 SOXL</button>';

    var basis = ST.mode === 'manual'
      ? '직접 입력값 · VIX ' + F.fixed(D.vix, 2) + ' · 입력한 값으로 계산'
      : F.day(G.as_of) + ' 종가 기준 · VIX ' + F.fixed(D.vix, 2) + ' · <span class="live">지연 데이터(정적 배포)</span>';

    /* 1) 대상·가격·기준 */
    var head =
      '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<div class="row">' + chips + '</div>' +
        '<div class="g-price">$' + F.fixed(D.close, 2) + '</div>' +
      '</div>' +
      '<p class="g-basis">' + basis + '</p>';

    /* 2) 값 직접 입력(원본 inputSection — 기본 접힘) */
    var inputBody =
      '<div class="g-row" style="margin-bottom:8px"><span class="g-seg">' +
        '<button type="button" data-mode="auto" class="' + (ST.mode === 'auto' ? 'on' : '') + '">자동</button>' +
        '<button type="button" data-mode="manual" class="' + (ST.mode === 'manual' ? 'on' : '') + '">수동(직접 입력)</button>' +
      '</span></div>' +
      '<p class="g-cap">' + (ST.mode === 'manual'
        ? '수동 — 내가 넣은 값을 씁니다. 정적 배포라 자동 갱신은 없습니다.'
        : '자동 — 마지막 확정 봉(종가) 값입니다. 슬라이더를 움직이면 그 값으로 다시 계산합니다.') + '</p>' +
      '<div class="grid g2" style="margin-top:8px">' +
        '<label class="field"><span>가격 ($)</span><input id="gPx" inputmode="decimal" value="' + F.fixed(D.close, 2) + '"></label>' +
        '<label class="field"><span>VIX</span><input id="gVix" inputmode="decimal" value="' + F.fixed(D.vix, 2) + '"></label>' +
      '</div>' +
      '<p class="g-cap" id="gInputErr" style="color:var(--red);min-height:16px"></p>' +
      '<button class="btn primary sm" type="button" id="gCalc">이 값으로 계산</button>' +
      '<p class="note">가격과 VIX를 넣으면 여섯 지표를 자동과 <b>같은 식</b>으로 다시 냅니다(가격·VIX는 10년 일봉에서 200일선·주봉 RSI·5년 최고·50일 VIX 평균을 다시 계산).</p>';

    /* 3) 밸류게이지 카드 */
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
        '<div class="g-rarity">🎯 ' + esc(S_.rarity) + '</div>' +
        '<div class="g-contrib" id="gContrib">' + esc(contribText(result)) + '</div>' +
      '</article>';

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

    /* 6) 최근 한 달 두 차트 */
    var candles = G.candles[t] || [];
    var monthPts = (G.month || []).map(function (p) {
      return [p[0], t === 'ndx' ? p[1] : p[2]];
    }).filter(function (p) { return p[1] > 0; });
    var mMin = monthPts.length ? Math.min.apply(null, monthPts.map(function (p) { return p[1]; })) : 0;
    var mMax = monthPts.length ? Math.max.apply(null, monthPts.map(function (p) { return p[1]; })) : 0;

    var chartsCard =
      '<article class="panel">' +
        '<div class="g-sub">주가 · 최근 한 달 일봉</div>' +
        '<div class="g-cap">일별 · 자료 ' + candles.length + '일치 · 점선 = 이 구간 최저가</div>' +
        '<div class="chart-box">' + candleSvg(candles) + '</div>' +
        '<div class="g-sub mt">밸류게이지 · 최근 한 달</div>' +
        '<div class="g-cap">' + (monthPts.length >= 2
          ? '일별 · 이 구간 ' + Math.round(mMin) + '~' + Math.round(mMax) + ' · 점선 ' + BUY
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
          return label + ' ' + e.date.slice(0, 4) + ' ' + trim1(e.score);
        }).join(' · ') + '</p>' +
        '<p class="note">점수는 그날까지의 자료만으로 계산했습니다(미래 자료가 섞이지 않게). 2002·2008은 이 사이트의 주별 이력(2011~) 밖이라 그래프가 아니라 위 글줄에만 적었습니다.</p>' +
      '</article>';

    /* 8) 지표 추적 (접힘) */
    var track = trackingHtml(t, values, result);
    /* 9) 폭락 비교 (접힘) */
    var crashHtml = crashSectionHtml(detailId);

    view.innerHTML =
      '<section class="hero"><div class="crumb"><a href="#/">홈</a> / 매수 지표</div>' +
        '<h1>매수 지표</h1>' +
        '<p>여섯 지표를 0~100으로 환산해 가중 평균한 <b>밸류게이지</b>입니다. 높을수록 저평가·공포이고, ' + BUY + ' 이상이면 계획한 투입 구간입니다.</p>' +
      '</section>' +
      head +
      section('input', '값 직접 입력', '가격과 VIX를 직접 넣으면 점수·막대·레이더·오늘 점이 그 값으로 다시 계산됩니다.', inputBody) +
      gaugeCard +
      statBlock +
      radarCard +
      chartsCard +
      flowCard +
      section('track', '지표 추적', '지표 값 직접 조작·기록, 버블 체크, 무엇이 실시간인가, 매매 기준·산식. 눌러서 폅니다.', track) +
      section('crash', '폭락 비교', '저점 전후 1년 비교 · 여섯 사례. 눌러서 폅니다.', crashHtml, !!detailId);

    bind(view, t);
    drawCharts(view, t, monthPts);
    if (ST.open.crash || detailId) drawOverlap(view, Data.crashes.cases);
    if (detailId) {
      var c = Data.caseById(detailId);
      if (c) drawCrashChart(view, c);
    }
  };

  /* ------------------------------------------------------------ 지표 추적 */

  function trackingHtml(t, values, result) {
    var T = Data.gauge.targets[t];
    var rows = IND.map(function (spec) {
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

    var table = '<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>지표</th><th>값</th><th>환산</th><th>기여</th></tr></thead><tbody>' +
      result.rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="mono">' + (r.value === null ? '—' : fmtVal(r.key, r.value) + esc(r.unit || '')) +
          '</td><td class="mono">' + (r.converted === null ? '—' : F.num(r.converted)) +
          '</td><td class="mono">' + (r.contribution === null ? '—' : F.signed(r.contribution, 1)) + '</td></tr>';
      }).join('') +
'' + '</tbody></table></div>' +
      '<p class="note">값이 없는 지표는 빼고 남은 가중치 합(' + F.fixed(result.weightSum, 2) + ')으로 나눕니다. 기여도 합 ÷ 가중치 합 = ' + F.num(result.score) + '점.</p>';

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

    var prov =
      '<article class="panel">' +
        '<div class="g-sub" style="margin:0">무엇이 실시간이고 무엇이 종가인가</div>' +
        '<p class="note" style="margin-top:6px">확정(종가) = 마지막 정규장 봉. 실시간(추정) = 확정 일봉에 지금 값을 얹어 같은 식으로 다시 계산한 값. ' +
          '이 사이트는 정적 배포라 실시간 시세가 없습니다 — 위 점수는 <b>' + (ST.mode === 'manual' ? '직접 입력한 값' : '마지막 확정 봉(' + F.day(Data.gauge.as_of) + ') 종가') + '</b>입니다.</p>' +
        '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>값</th><th>확정(종가)</th><th>출처</th></tr></thead><tbody>' +
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
        '<div class="row" style="justify-content:space-between;margin-bottom:4px"><div class="g-sub" style="margin:0">지표 값 · 직접 조작</div>' +
          '<span class="g-seg"><button type="button" data-mode="auto" class="' + (ST.mode === 'auto' ? 'on' : '') + '">자동</button>' +
          '<button type="button" data-mode="manual" class="' + (ST.mode === 'manual' ? 'on' : '') + '">수동</button></span></div>' +
        '<p class="g-cap">' + (ST.mode === 'manual'
          ? '값을 고치면 위 점수·게이지·레이더가 바로 바뀌고, 고친 값은 이 브라우저에 저장됩니다.'
          : '자동 값(마지막 확정 봉)입니다. 슬라이더를 움직이면 위 점수가 바로 바뀝니다. 저장하려면 수동을 누르세요.') + '</p>' +
        rows + table +
      '</article>' +
      '<article class="panel">' +
        '<div class="g-sub" style="margin:0">지표 추적</div>' +
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
   * 세 보기 — 저점=100·로그(기본) / 고점=100·로그 / 낙폭%.
   * 오늘 선은 live.json → 없으면 확정 종가 → 수동 입력 순으로 정해지고, 기준을 화면에 적는다.
   */
  var OV = { scale: 'trough' };
  var OV_OFF = null;

  function ovCasePath(c, scale) {
    var src;
    if (scale === 'trough') src = c.troughPath || [];
    else if (scale === 'peak') src = (c.prePath || []).concat(c.path || []);
    else src = (c.prePath || []).concat(c.path || []);
    return src.map(function (p) {
      var v;
      if (scale === 'pct') v = p[1];
      else v = 100 * (1 + p[1] / 100);
      return [p[0], v];
    }).filter(function (p) { return p[0] >= -252 && p[0] <= 252 && (scale === 'pct' || p[1] > 0); });
  }

  /* 오늘 경로 — ^NDX 일봉에서 고점 이후 하루씩. live/수동 값이 있으면 끝점을 그 값에 맞춘다. */
  function ovToday() {
    var now = Data.now();
    var idx = Data.scores.index || [];
    var rows = [];
    var seen = false;
    (idx || []).forEach(function (r) {
      if (!seen && r[0] >= now.peak_date) seen = true;
      if (seen) rows.push({ x: rows.length, dd: r[2] });
    });
    if (!rows.length) return null;

    var ddNow = now.dd, src = 'close';
    var label = '확정 종가 · ' + F.day(now.as_of);
    if (typeof ST !== 'undefined' && ST.mode === 'manual') {
      var v = liveValues(ST.target);
      if (v && v.dd !== null && v.dd !== undefined) { ddNow = -Math.abs(v.dd); src = 'manual'; label = '직접 입력한 값'; }
    } else if (w.Basis && Basis.get() === 'live') {
      var q = Basis.quote('^NDX') || Basis.quote('NDX');
      if (q && now.peak_close > 0) {
        ddNow = (q.price / now.peak_close - 1) * 100;
        src = 'live';
        label = '실시간(추정) · ' + (q.session ? q.session + ' ' : '') + (q.hhmm || '');
      }
    }
    var lastDd = rows[rows.length - 1].dd;
    var ratio = (lastDd > -100) ? (1 + ddNow / 100) / (1 + lastDd / 100) : 1;

    var t = 0, best = 1e9;
    rows.forEach(function (r) { if (r.dd < best) { best = r.dd; t = r.x; } });
    var td = rows[t] ? rows[t].dd : now.dd;
    var troughBase = 1 + td / 100;
    return {
      dd: ddNow, src: src, label: label,
      peak: rows.map(function (r) { return [r.x, r.dd]; }),
      trough: rows.map(function (r) {
        return [r.x - t, ((1 + r.dd / 100) * ratio / troughBase - 1) * 100];
      }),
      offset: rows[rows.length - 1].x,
      troughOffset: rows[rows.length - 1].x - t
    };
  }

  function ovScaleLabel(s) { return s === 'trough' ? '저점=100 · 로그' : (s === 'peak' ? '고점=100 · 로그' : '낙폭 %'); }

  function overlapCard(cases) {
    if (OV_OFF === null) OV_OFF = S.get('crashOff', []);
    var saved = S.get('crashOv', null);
    if (saved === 'trough' || saved === 'peak' || saved === 'pct') OV.scale = saved;
    var chips = cases.map(function (c) {
      var on = OV_OFF.indexOf(c.id) < 0;
      return '<button class="chip ' + (on ? 'on' : '') + '" type="button" data-ovcase="' + c.id + '">' +
        '<span class="dot" style="background:' + c.color + '"></span>' + esc(c.short) + '</button>';
    }).join('');
    return '<article class="panel">' +
      '<div class="row" style="justify-content:space-between;align-items:center">' +
        '<div class="g-sub" style="margin:0">일곱 시점 겹쳐 보기</div>' +
        '<span class="g-seg" id="ovScale">' +
          ['trough', 'peak', 'pct'].map(function (s) {
            return '<button type="button" data-ovscale="' + s + '" class="' + (OV.scale === s ? 'on' : '') + '">' + ovScaleLabel(s) + '</button>';
          }).join('') +
        '</span>' +
      '</div>' +
      '<div class="pill-row" id="ovChips" style="margin:8px 0 2px">' + chips + '</div>' +
      '<div class="chart-box" id="ovChart" style="touch-action:pan-y"></div>' +
      '<p class="note" id="ovReadout"></p>' +
      '<p class="note" id="ovCaption"></p>' +
      '<p class="note" id="ovBasis"></p>' +
    '</article>';
  }

  function ovCaptionText(scale) {
    if (scale === 'trough') {
      return '각 사례의 **저점 = 100**, 세로는 로그 눈금. 저점 0일 기준 −252~+252거래일이라 일곱 선이 저점에서 만납니다. ' +
        '오늘 선은 지금까지의 잠정 저점을 100으로 두고 같은 방식으로 옮겼습니다(최종 저점이 아니라 잠정값).';
    }
    if (scale === 'peak') {
      return '각 사례의 **고점 = 100**, 세로는 로그 눈금. 고점 0일 기준 −252~+252거래일.';
    }
    return '같은 구간을 **낙폭 %** 선형 눈금으로. 로그 보기와 달리 깊은 낙폭이 더 크게 보입니다.';
  }

  function drawOverlap(view, cases) {
    var host = el('#ovChart', view);
    if (!host) return;
    var scale = OV.scale;
    var today = ovToday();
    var on = cases.filter(function (c) { return OV_OFF.indexOf(c.id) < 0; });
    var series = on.map(function (c) { return { id: c.id, short: c.short, color: c.color, pts: ovCasePath(c, scale) }; });
    var todayPts = today ? (scale === 'trough' ? today.trough : today.peak) : [];
    if (scale === 'trough' && today) {
      todayPts = today.trough.map(function (p) { return [p[0], 100 * (1 + p[1] / 100)]; });
    } else if (today) {
      todayPts = today.peak.map(function (p) { return [p[0], scale === 'pct' ? p[1] : 100 * (1 + p[1] / 100)]; });
    }

    var W = 760, H = 320, pad = { l: 48, r: 66, t: 16, b: 28 };
    var all = series.reduce(function (a, s) { return a.concat(s.pts); }, []).concat(todayPts);
    if (!all.length) { host.innerHTML = '<div class="empty">그릴 값이 없습니다.</div>'; return; }
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
    var xMin = -252, xMax = 252;
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var sx = function (x) { return pad.l + (x - xMin) / (xMax - xMin) * iw; };
    var sy = function (v) { return pad.t + ih - (yOf(v) - loL) / (hiL - loL) * ih; };

    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="폭락 사례 겹쳐 보기 — ' + ovScaleLabel(scale) + '">'];
    /* 가로 눈금 — 저점/고점 기준일과 ±1년 */
    [[-252, '−252'], [-126, '−126'], [0, '0'], [126, '+126'], [252, '+252']].forEach(function (t) {
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

    /* 오늘 — 강조색으로 굵게 */
    if (todayPts.length) {
      var dt = todayPts.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join('');
      s.push('<path d="' + dt + '" fill="none" stroke="var(--blue)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>');
      var last = todayPts[todayPts.length - 1];
      s.push('<circle cx="' + sx(last[0]).toFixed(1) + '" cy="' + sy(last[1]).toFixed(1) + '" r="4" fill="var(--blue)"/>');
      s.push('<text x="' + (sx(last[0]) + 6).toFixed(1) + '" y="' + (sy(last[1]) - 8).toFixed(1) + '" font-size="10.5" fill="var(--blue)">오늘</text>');
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
    host.__ov = { series: series, today: today, todayPts: todayPts, scale: scale, sx: sx, pad: pad, W: W };

    /* 기본 읽기 줄 — 오늘 자리에서 */
    var day = scale === 'trough' ? (today ? today.troughOffset : null) : (today ? today.offset : null);
    el('#ovReadout', view).innerHTML = ovReadoutText(day, scale, today, series, view);
    el('#ovCaption', view).innerHTML = ovCaptionText(scale).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    el('#ovBasis', view).textContent = '오늘 기준 — ' + (today ? today.label : '값 없음(오늘 선을 그리지 않았습니다)') +
      ' · ' + (OV.scale === 'trough' ? '저점' : '고점') + ' 기준 +' + (day === null ? '—' : day) + '거래일';
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
    if (day === null || day === undefined) return '오늘 값이 없어 읽기를 그리지 않습니다.';
    var head = (scale === 'trough' ? '저점 +' : '고점 +') + day + '일' + (scale === 'pct' ? ' 낙폭' : '') + ' — ';
    var parts = [];
    if (today) {
      var tv = scale === 'trough'
        ? ovValueAt(today.trough.map(function (p) { return [p[0], 100 * (1 + p[1] / 100)]; }), day, scale)
        : ovValueAt(today.peak.map(function (p) { return [p[0], scale === 'pct' ? p[1] : 100 * (1 + p[1] / 100)]; }), day, scale);
      parts.push({ k: '오늘', v: tv, c: 'var(--blue)' });
    }
    series.forEach(function (se) {
      parts.push({ k: se.short, v: ovValueAt(se.pts, day, scale), c: se.color });
    });
    var vals = parts.filter(function (p) { return p.v !== null; }).sort(function (a, b) { return a.v - b.v; });
    return head + vals.map(function (p) {
      return scale === 'pct' ? p.k + ' ' + F.pct(p.v, 1) : p.k + ' ' + F.fixed(100 + p.v, 1);
    }).join(' · ');
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
      return '<tr class="g-crashrow" data-case="' + c.id + '">' +
        '<td><b style="color:' + c.color + '">■</b> ' + esc(c.name) + '<div class="dim small">' + esc(c.tag) + ' · ' + esc(c.index) + '</div></td>' +
        '<td class="mono">' + F.day(c.peak) + '<div class="dim small">' + F.fixed(c.peak_close, 2) + '</div></td>' +
        '<td class="mono">' + F.day(c.trough) + '<div class="dim small">' + F.fixed(c.trough_close, 2) + '</div></td>' +
        '<td class="mono neg">' + F.pct(c.dd, 1) + '</td>' +
        '<td class="mono">' + F.int(c.days_to_trough) + '</td>' +
        '<td class="mono">' + F.int(c.days_to_recovery) + '</td>' +
        '<td class="mono">' + (m ? F.day(m.date) + '<div class="dim small">고점 +' + m.day + '일 · 낙폭 ' + F.pct(m.dd, 1) + '</div>' : '—') + '</td>' +
        '<td class="mono">' + (m ? F.num(m.distance, 2) : '—') + '</td>' +
        '<td class="mono ' + (m && m.fwd30 !== null && m.fwd30 < 0 ? 'neg' : 'pos') + '">' + (m ? F.pct(m.fwd30, 1) : '—') + '</td>' +
        '</tr>';
    }).join('');

    var cards = cases.map(function (c) {
      var m = c.now_match;
      return '<a class="case-card" href="#/gauge/crash/' + c.id + '" style="border-left-color:' + c.color + '">' +
        '<div class="top"><span class="nm">' + esc(c.short) + '</span><span class="dd">' + F.pct(c.dd, 1) + '</span></div>' +
        '<div class="meta">' + esc(c.name) + ' · 저점까지 ' + F.int(c.days_to_trough) + '거래일</div>' +
        (m ? '<div class="meta">닮은 날 ' + F.day(m.date) + ' (고점 +' + m.day + '일, 거리 ' + F.num(m.distance, 2) + ') → 30일 ' + F.pct(m.fwd30, 1) + '</div>' : '') +
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
          '<th>지금과 닮은 날</th><th>거리</th><th>그 뒤 30일</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="note">거리 = 네 지표(낙폭·200일선·RSI·VIX)의 차이를 각 10눈금으로 나눈 평균. 작을수록 닮았습니다. VIX가 없던 1929·1987은 세 지표로만 계산합니다. 줄을 누르면 사례 상세가 열립니다.</p>' +
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

  function drawCharts(view, t, monthPts) {
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
        markers: [{ x: monthPts.length - 1, y: monthPts[monthPts.length - 1][1], color: '#43b795', r: 3 }]
      });
    } else if (host) {
      host.innerHTML = '<div class="empty">이력이 쌓이는 중입니다.</div>';
    }

    var flow = el('#gFlow', view);
    var weekly = (Data.gauge.weekly[t] || []);
    if (flow && weekly.length >= 3) {
      var pts = weekly.map(function (p, i) { return [i, p[1]]; });
      var ticks = [];
      var lastYear = '';
      weekly.forEach(function (p, i) {
        var y = p[0].slice(0, 4);
        if (y !== lastYear && (y % 2 === 0 || i === 0 || i === weekly.length - 1)) { ticks.push({ x: i, label: y.slice(2) }); lastYear = y; }
        else if (y !== lastYear) lastYear = y;
      });
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

  function updateLive(view, t) {
    var values = liveValues(t);
    var result = scoreOf(values, t);
    var v = verdictOf(result.score);
    var axes = axesOf(values, t);

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
  }

  function recordNow(t) {
    var values = liveValues(t);
    var result = scoreOf(values, t);
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

  function bind(view, t) {
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
        saveState();
        V.gauge(liveView(), null);
      });
    });

    /* 자동/수동 */
    els(view, '[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-mode');
        if (mode === ST.mode) return;
        if (mode === 'manual') {
          var cur = liveValues(ST.target);
          ST.manual[ST.target] = {};
          IND.forEach(function (s) { ST.manual[ST.target][s.key] = cur[s.key]; });
        }
        ST.mode = mode;
        LIVE = {};
        saveState();
        recordNow(ST.target);
        V.gauge(liveView(), null);
      });
    });

    /* 슬라이더·숫자 — 만지면 위가 같이 움직인다 */
    els(view, '[data-slider]').forEach(function (sl) {
      sl.addEventListener('input', function () {
        var key = sl.getAttribute('data-slider');
        var v = Number(sl.value);
        liveValues(ST.target)[key] = v;
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
        liveValues(ST.target)[key] = v;
        var sl = el('[data-slider="' + key + '"]', view);
        if (sl) sl.value = String(v);
        updateLive(view, ST.target);
      });
    });

    /* 가격·VIX로 다시 계산 */
    var calc = el('#gCalc', view);
    if (calc) calc.addEventListener('click', function () {
      var px = numOrNull(el('#gPx', view).value);
      var vx = numOrNull(el('#gVix', view).value);
      var err = el('#gInputErr', view);
      var pack = Data.gauge.targets[ST.target].recompute;
      if (!px || px <= 0) { err.textContent = '가격은 0보다 큰 숫자로 넣어 주세요.'; return; }
      if (!vx || vx <= 0) { err.textContent = 'VIX는 0보다 큰 숫자로 넣어 주세요.'; return; }
      var vals = valuesFromInputs(pack, px, vx);
      if (!vals) { err.textContent = '일봉 자료가 모자라 이 값으로 계산할 수 없습니다.'; return; }
      err.textContent = '';
      ST.mode = 'manual';
      ST.manual[ST.target] = vals;
      LIVE = {};
      saveState();
      V.gauge(liveView(), null);
      toast(px + ' · VIX ' + vx + ' 로 다시 계산했습니다.');
    });

    /* 지표 추적 — 지금 값 기록 */
    var tn = el('#gTrackNow', view);
    if (tn) tn.addEventListener('click', function () {
      recordNow(ST.target);
      V.gauge(liveView(), null);
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

    /* 겹쳐 보기 — 사례 칩 켜고 끄기 */
    els(view, '[data-ovcase]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-ovcase');
        var i = OV_OFF.indexOf(id);
        if (i >= 0) OV_OFF.splice(i, 1); else OV_OFF.push(id);
        S.set('crashOff', OV_OFF);
        b.classList.toggle('on', OV_OFF.indexOf(id) < 0);
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
        var day = Math.round((vx - o.pad.l) / (o.W - o.pad.l - o.pad.r) * 504 - 252);
        day = Math.max(-252, Math.min(252, day));
        var box = el('#ovReadout', view);
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

    recordNow(t);
  }

  /* 가격·VIX → 여섯 지표 (원본 Gauge.valuesFromInputs 와 같은 식) */
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
        close: num(e.close) || num(e.prevClose) || num(e.previousClose),
        session: sess ? sess.word : null, hhmm: sess ? sess.hhmm : kstTime(at),
        source: e.source || (LIVE.json && LIVE.json.source) || 'live.json'
      };
    },
    /* 그 기준의 여섯 지표 — live.json 의 가격·VIX 로 자동과 같은 식으로 다시 낸다 */
    valuesFor: function (target) {
      if (Basis.get() !== 'live') return null;
      if (!Data.gauge || !Data.gauge.targets || !Data.gauge.targets[target]) return null;
      return Basis.pairFor(target);
    },
    /* 대상 가격·VIX 한 쌍 */
    pairFor: function (target) {
      var sym = target === 'ndx' ? 'TQQQ' : 'SOXL';
      var pq = Basis.quote(sym);
      var vq = Basis.quote('^VIX') || Basis.quote('VIX');
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
      return {
        hasLive: true, at: q.at,
        session: q.session || '프리마켓', hhmm: q.hhmm,
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
