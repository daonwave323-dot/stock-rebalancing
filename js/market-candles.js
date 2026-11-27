/* 캔들 차트 — 원본 core/Candles.kt(CandleSpan) · view/Candles.kt(CandleChartView) 규칙.
   일봉 자료를 브라우저에서 주·월·연봉으로 묶고, 이동평균선을 같은 창에서 계산한다.
   담긴 기간(무아 님 결정 2026-11-28): 일봉 최근 1년(약 252거래일) + 주봉 5년. 5년 기간 탭은 주봉을 쓴다.
   자료가 모자란 봉 단위는 **모자란다고 적는다**(봉을 지어내지 않는다). */
(function (w) {
  'use strict';

  var SPANS = [
    { key: 'day', label: '일봉', ma: [5, 20, 60, 120], unit: '일', window: 120, need: 20 },
    { key: 'week', label: '주봉', ma: [5, 20, 60], unit: '주', window: 120, need: 15 },
    { key: 'month', label: '월봉', ma: [5, 20, 60], unit: '개월', window: 0, need: 6 },
    { key: 'year', label: '연봉', ma: [3, 5, 10], unit: '년', window: 0, need: 3 }
  ];

  function spanOf(key) {
    for (var i = 0; i < SPANS.length; i++) if (SPANS[i].key === key) return SPANS[i];
    return SPANS[0];
  }

  /* 일봉 [날짜,시,고,저,종,거래량] → 주/월/연봉. 원본은 야후에서 직접 받지만 결과 규칙은 같다:
     시가=첫 봉 시가, 고가=최대, 저가=최소, 종가=마지막 종가, 거래량=합. */
  function fold(bars, span) {
    if (span === 'day') return bars.slice();
    var out = [], cur = null, curKey = null;
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      var d = new Date(b[0] + 'T00:00:00Z');
      var k;
      if (span === 'week') {
        var t = new Date(d.getTime());
        var dow = (t.getUTCDay() + 6) % 7; // 월=0
        t.setUTCDate(t.getUTCDate() - dow);
        k = t.toISOString().slice(0, 10);
      } else if (span === 'month') {
        k = b[0].slice(0, 7);
      } else {
        k = b[0].slice(0, 4);
      }
      if (curKey !== k) {
        if (cur) out.push(cur);
        cur = [k, b[1], b[2], b[3], b[4], b[5] || 0];
        curKey = k;
      } else {
        cur[2] = Math.max(cur[2], b[2]);
        cur[3] = Math.min(cur[3], b[3]);
        cur[4] = b[4];
        cur[5] = (cur[5] || 0) + (b[5] || 0);
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function sma(bars, n) {
    var out = [], sum = 0;
    for (var i = 0; i < bars.length; i++) {
      sum += bars[i][4];
      if (i >= n) sum -= bars[i - n][4];
      out.push(i >= n - 1 ? sum / n : null);
    }
    return out;
  }

  function css(name, fb) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v || '').trim() || fb;
    } catch (e) { return fb; }
  }

  var MA_COLORS = ['#8FBEDC', '#dcb05f', '#a294e0', '#6fcf97'];

  /* box 안에 차트를 그린다. opts: {bars, span, market, maOff:{}, height}
     반환: {bars, span, note} */
  function draw(box, opts) {
    var canvas = box.querySelector('canvas');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = box.clientWidth || 320;
    var H = opts.height || 300;
    box.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var sp = spanOf(opts.span);
    var all = opts.bars || [];
    var bars = fold(all, sp.key);
    // opts.window 를 주면 그 값을 쓴다(0 = 자르지 않음 — 기간(6개월·1년·5년)을 화면이 먼저 잘라 넘길 때).
    var win = opts.window != null ? opts.window : sp.window;
    if (win && bars.length > win) bars = bars.slice(bars.length - win);

    if (!bars.length) {
      ctx.fillStyle = css('--dim', '#949fb1');
      ctx.font = '12px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('봉 자료가 없습니다', W / 2, H / 2);
      return { bars: [], span: sp, note: '자료 없음' };
    }

    var padL = 4, padR = 54, padT = 10, padB = 26;
    var gw = W - padL - padR, gh = H - padT - padB;
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b) {
      if (b[3] < lo) lo = b[3];
      if (b[2] > hi) hi = b[2];
    });
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) { hi = lo + 1; }
    var pad = (hi - lo) * 0.06;
    lo -= pad; hi += pad;
    if (lo < 0) lo = 0;      // 가격은 음수가 없다 — 아래쪽에 -3.140 같은 눈금이 생기지 않게

    var n = bars.length;
    var step = gw / n;
    var bw = Math.max(1, Math.min(12, step * 0.62));
    var y = function (v) { return padT + (hi - v) / (hi - lo) * gh; };

    // 격자
    ctx.strokeStyle = css('--line', '#3a4351');
    ctx.lineWidth = 0.6;
    for (var g = 0; g <= 4; g++) {
      var yy = padT + gh * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + gw, yy); ctx.stroke();
      var val = hi - (hi - lo) * g / 4;
      ctx.fillStyle = css('--dim', '#949fb1');
      ctx.font = '9.5px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'left';
      ctx.fillText(fmtVal(val, opts), padL + gw + 5, yy + 3);
    }

    // 캔들 — 상승/하락 색은 시장 규칙(국내 상승 빨강·하락 파랑 / 미국 상승 초록·하락 빨강)
    var upC = opts.market === 'kr' ? '#e2808f' : '#3DD68C';
    var dnC = opts.market === 'kr' ? '#6a9ae0' : '#e2808f';
    for (var i = 0; i < n; i++) {
      var b = bars[i];
      var x = padL + step * i + step / 2;
      var up = b[4] >= b[1];
      ctx.strokeStyle = up ? upC : dnC;
      ctx.fillStyle = up ? upC : dnC;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y(b[2]));
      ctx.lineTo(x, y(b[3]));
      ctx.stroke();
      var y1 = y(Math.max(b[1], b[4])), y2 = y(Math.min(b[1], b[4]));
      var hh = Math.max(1, y2 - y1);
      ctx.fillRect(x - bw / 2, y1, bw, hh);
    }

    // 이동평균선
    var maOff = opts.maOff || {};
    sp.ma.forEach(function (period, idx) {
      if (maOff[sp.key + '|' + period]) return;
      var line = sma(bars, period);
      ctx.strokeStyle = MA_COLORS[idx % MA_COLORS.length];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      var started = false;
      for (var i2 = 0; i2 < line.length; i2++) {
        if (line[i2] == null) continue;
        var px = padL + step * i2 + step / 2;
        if (!started) { ctx.moveTo(px, y(line[i2])); started = true; }
        else ctx.lineTo(px, y(line[i2]));
      }
      if (started) ctx.stroke();
    });

    // 마지막 종가 선 + 값
    var lastB = bars[n - 1];
    var lastY = y(lastB[4]);
    ctx.strokeStyle = css('--price', '#3DD68C');
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, lastY); ctx.lineTo(padL + gw, lastY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css('--price', '#3DD68C');
    ctx.font = '700 10px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'left';
    var lastTxt = fmtVal(lastB[4], opts);
    // 마지막 종가 글자가 오른쪽 눈금 숫자와 겹치지 않게 바탕을 깔고 적는다.
    var tWid = ctx.measureText(lastTxt).width;
    ctx.save();
    ctx.fillStyle = css('--bg', '#1a1f2b');
    ctx.fillRect(padL + gw + 3, lastY - 7, tWid + 4, 14);
    ctx.restore();
    ctx.fillStyle = css('--price', '#3DD68C');
    ctx.fillText(lastTxt, padL + gw + 5, lastY + 3);

    // x축 날짜 (앞·중간·끝)
    ctx.fillStyle = css('--dim', '#949fb1');
    ctx.font = '9.5px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    [0, Math.floor(n / 2), n - 1].forEach(function (i3, k) {
      var lbl = bars[i3][0];
      if (sp.key === 'day') lbl = lbl.slice(2);
      else if (sp.key === 'week') lbl = lbl.slice(2);
      ctx.textAlign = k === 0 ? 'left' : (k === 2 ? 'right' : 'center');
      var px2 = padL + step * i3 + step / 2;
      ctx.fillText(String(lbl), k === 0 ? padL : (k === 2 ? padL + gw : px2), H - 8);
    });

    // 짚은 자리(손가락/마우스) — 날짜·시고저종
    box.__bars = bars;
    box.__geo = { padL: padL, step: step, padT: padT, gh: gh, lo: lo, hi: hi, gw: gw };
    if (!canvas.__bound) {
      canvas.__bound = true;
      var readout = box.parentElement && box.parentElement.querySelector('.chart-readout');
      function show(e) {
        var r = canvas.getBoundingClientRect();
        var cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        var geo = box.__geo, bs = box.__bars;
        if (!geo || !bs || !bs.length) return;
        var i4 = Math.floor((cx - geo.padL) / geo.step);
        i4 = Math.max(0, Math.min(bs.length - 1, i4));
        var b2 = bs[i4];
        if (readout) {
          readout.textContent = b2[0] + ' · 시 ' + fmtVal(b2[1], opts) + ' 고 ' + fmtVal(b2[2], opts) +
            ' 저 ' + fmtVal(b2[3], opts) + ' 종 ' + fmtVal(b2[4], opts) +
            (b2[5] ? ' · 거래량 ' + Math.round(b2[5]).toLocaleString('ko-KR') : '');
        }
      }
      canvas.addEventListener('mousemove', show);
      canvas.addEventListener('touchstart', show, { passive: true });
      canvas.addEventListener('touchmove', show, { passive: true });
    }
    return { bars: bars, span: sp, note: '' };
  }

  function fmtVal(v, opts) {
    if (v == null || isNaN(v)) return '—';
    var cur = opts && opts.cur;
    var d = cur === 'KRW' ? 0 : (v >= 1000 ? 2 : (v >= 10 ? 2 : 3));
    return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* 이 봉 단위를 그릴 수 있는지 — 원본은 봉을 더 받아 오지만, 스냅샷에는 약 1~5년치만 있다. */
  function usable(all, spanKey) {
    var sp = spanOf(spanKey);
    var bars = fold(all || [], sp.key);
    return { ok: bars.length >= sp.need, count: bars.length, need: sp.need, span: sp };
  }

  /* 봉 자료는 두 파일로 나뉘어 있다(무아 님 결정 2026-11-28).
       data/candles-index.json — 증시 탭 첫 화면의 지수 카드 미니차트가 쓰는 지수·대표 ETF 9종
       data/candles.json      — 그 밖의 종목 봉. 종목 상세·큰 차트를 열 때만 받는다
     두 파일 모두 일봉 최근 1년(symbols) + 주봉 5년(weekly)이고, 키 표기는 스냅샷 표기(`035720`)다.
     관심 목록·5분 갱신은 야후 표기(`035720.KS`)를 쏘므로 양쪽 표기를 같은 키로 맞춰 찾는다. */
  var cache = {};        // 일봉(최근 1년)
  var cacheW = {};       // 주봉(5년) — 5년 기간 탭이 쓰는 봉
  function candleKey(sym) {
    var s = String(sym || '').trim();
    return (w.Mkt && Mkt.baseSym) ? Mkt.baseSym(s) : s;
  }
  function barsOf(syms, sym) {
    if (!syms) return null;
    var s = String(sym || '').trim();
    var k = candleKey(s);
    return syms[s] || syms[s.toUpperCase()] || syms[k] || syms[k.toUpperCase()] ||
      syms[k + '.KS'] || syms[k + '.KQ'] || null;
  }
  function absorb(js, sym, key) {
    var d = barsOf(js && js.symbols, sym) || [];
    var wk = barsOf(js && js.weekly, sym) || [];
    if (d.length) cache[key] = d;      // 빈 결과는 담아 두지 않는다(자료가 늦게 와도 다시 찾게)
    if (wk.length) cacheW[key] = wk;
    return d;
  }
  /* opts.spark — 미니차트(지수 카드). 작은 파일만 본다(종목 봉 큰 파일을 당기지 않게).
     그 밖에는 작은 파일에 없으면 큰 파일(종목 봉)을 받는다. */
  function loadFor(sym, opts) {
    var key = candleKey(sym);
    if (cache[key]) return Promise.resolve(cache[key]);
    if (!w.Mkt) return Promise.resolve([]);
    var spark = !!(opts && opts.spark);
    return Mkt.loadCandleIndex().then(function (js) {
      var d = absorb(js, sym, key);
      if (d.length || spark) return d;
      return Mkt.loadCandles().then(function (full) { return absorb(full, sym, key); });
    });
  }
  function weeklyOf(sym) {
    return cacheW[candleKey(sym)] || null;
  }

  function drawNote(box, text) {
    var canvas = box.querySelector('canvas');
    if (!canvas) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = box.clientWidth || 320, H = 200;
    box.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = css('--tx3', '#8b93a7');
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    var lines = String(text).split('\n');
    lines.forEach(function (t, i) {
      ctx.fillText(t, W / 2, H / 2 - (lines.length - 1) * 9 + i * 18);
    });
  }

  w.Candles = { spans: SPANS, draw: draw, fold: fold, usable: usable, spanOf: spanOf,
    loadFor: loadFor, cache: cache, weeks: cacheW, weeklyOf: weeklyOf,
    drawNote: drawNote, key: candleKey }; 
})(window);
