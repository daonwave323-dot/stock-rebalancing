/* 마켓맵(트리맵) — 원본 core/Treemap.kt 의 squarified 배치를 그대로 옮기고,
   view/TreemapView.kt 의 색 규칙(-3% ~ +3%, 0은 회색)과 글자 규칙을 따른다.
   캔버스로 그린다(칸이 많아도 퍼포먼스가 유지되고, 모바일 390px 에서 가로 넘침이 없다). */
(function (w) {
  'use strict';

  var EPS = 1e-6;

  function worstRatio(row, next, sum, side) {
    if (sum <= 0 || side <= EPS) return Number.MAX_VALUE;
    var maxA = next, minA = next;
    for (var i = 0; i < row.length; i++) {
      if (row[i].area > maxA) maxA = row[i].area;
      if (row[i].area < minA) minA = row[i].area;
    }
    if (minA <= 0) return Number.MAX_VALUE;
    var s2 = side * side, sum2 = sum * sum;
    return Math.max(s2 * maxA / sum2, sum2 / (s2 * minA));
  }

  function clip(r, width, height) {
    var left = Math.min(Math.max(r.x, 0), width);
    var top = Math.min(Math.max(r.y, 0), height);
    var right = Math.min(Math.max(r.x + r.w, 0), width);
    var bottom = Math.min(Math.max(r.y + r.h, 0), height);
    var cw = right - left, ch = bottom - top;
    if (cw <= 0.01 || ch <= 0.01) return null;
    return { key: r.key, x: left, y: top, w: cw, h: ch, weight: r.weight, data: r.data };
  }

  /* 칸 최소 크기 — 390px 폭에서도 티커가 읽히는 한 변(px). 시가총액 비중이 이보다 작은
     칸도 이 크기는 갖도록 넓이에 하한을 두고, 큰 칸이 그만큼 줄어든다(비중은 하한 위에서만 반영). */
  var MIN_SIDE = 46;

  /* 넓이 하한 — 작은 칸을 하한에 고정하고 남은 넓이를 나머지 칸이 원래 비중대로 나눠 갖는다.
     자리가 모자라면(칸 수 × 하한 > 전체) 균등 배분으로 물러선다. */
  function fitAreas(weights, totalArea, factor) {
    var n = weights.length;
    var minA = MIN_SIDE * MIN_SIDE * (factor || 2.6);
    minA = Math.min(minA, totalArea / Math.max(1, n));
    if (!n) return [];
    if (minA * n > totalArea) minA = totalArea / n;
    var fixed = [], wsum = 0, i;
    for (i = 0; i < n; i++) { fixed.push(false); wsum += weights[i]; }
    var areas = new Array(n);
    for (var pass = 0; pass < 12; pass++) {
      var rest = totalArea, restW = 0, fixedCount = 0;
      for (i = 0; i < n; i++) {
        if (fixed[i]) { rest -= minA; fixedCount++; } else restW += weights[i];
      }
      if (rest < 0) rest = 0;
      var newly = 0;
      for (i = 0; i < n; i++) {
        if (fixed[i]) { areas[i] = minA; continue; }
        areas[i] = restW > 0 ? rest * weights[i] / restW : rest / Math.max(1, n - fixedCount);
        if (areas[i] < minA) { fixed[i] = true; newly++; }
      }
      if (!newly) break;
      if (fixedCount + newly >= n) {           // 전부 하한이면 균등
        for (i = 0; i < n; i++) areas[i] = totalArea / n;
        break;
      }
    }
    return areas;
  }

  /* items: [{key, weight, data}] → [{key,x,y,w,h,weight,data}]
     모든 칸이 최소 한 변(MIN_SIDE) 이상이 되도록 넓이 하한을 키워 가며 배치한다.
     비중만으로는 작은 칸이 실처럼 얇아지므로, 한 변이 모자라면 하한을 키우고
     그래도 안 되면 균등 배치로 물러선다(큰 칸이 줄어드는 것은 감수 — 사용자가 정한 규칙). */
  function compute(items, width, height) {
    var clean = items.filter(function (it) { return isFinite(it.weight) && it.weight > 0; })
      .sort(function (a, b) { return b.weight - a.weight; });
    if (!clean.length || width <= 0 || height <= 0) return [];
    var area = width * height;
    var weights = clean.map(function (it) { return it.weight; });
    var tries = [2.6, 4.5, 8, 0], rects = null;
    for (var t = 0; t < tries.length; t++) {
      var fitted = tries[t] ? fitAreas(weights, area, tries[t]) : weights.map(function () { return area / weights.length; });
      var scaled = clean.map(function (it, i) {
        return { key: it.key, area: fitted[i], weight: it.weight, data: it.data };
      });
      rects = place(scaled, width, height);
      var thin = rects.some(function (r) { return Math.min(r.w, r.h) < MIN_SIDE - 0.6; });
      if (!thin) break;
    }
    return rects || [];
  }

  /* 스쿼리파이 배치 — 넓이 목록을 폭·높이 안에 채운다. */
  function place(scaled, width, height) {
    var out = [], x = 0, y = 0, wd = width, ht = height, i = 0;
    while (i < scaled.length && wd > EPS && ht > EPS) {
      var side = Math.min(wd, ht);
      var row = [], rowSum = 0, worst = Number.MAX_VALUE, j = i;
      while (j < scaled.length) {
        var nextSum = rowSum + scaled[j].area;
        var cand = worstRatio(row, scaled[j].area, nextSum, side);
        if (!row.length || cand <= worst) {
          row.push(scaled[j]); rowSum = nextSum; worst = cand; j++;
        } else break;
      }
      var thickness = side > 0 ? rowSum / side : 0;
      var offset = 0;
      for (var k = 0; k < row.length; k++) {
        var item = row[k];
        var len = thickness > 0 ? item.area / thickness : 0;
        var rect = (wd >= ht)
          ? { key: item.key, x: x, y: y + offset, w: thickness, h: len, weight: item.weight, data: item.data }
          : { key: item.key, x: x + offset, y: y, w: len, h: thickness, weight: item.weight, data: item.data };
        var c = clip(rect, width, height);
        if (c) out.push(c);
        offset += len;
      }
      if (wd >= ht) { x += thickness; wd -= thickness; } else { y += thickness; ht -= thickness; }
      i = j;
    }
    return out;
  }

  function hex(c) {
    if (typeof c !== 'string') return [0, 0, 0];
    var s = c.replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
  }
  function blend(from, to, t) {
    var a = hex(from), b = hex(to);
    var k = Math.max(0, Math.min(1, t));
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * k) + ',' + Math.round(a[2] + (b[2] - a[2]) * k) + ')';
  }

  var CSS = function (name, fb) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v || '').trim() || fb;
    } catch (e) { return fb; }
  };

  /* 등락 → 칸 색. 고정 ±3%가 아니라 **이 화면에 보이는 칸들의 가장 큰 |등락률|** 을 눈금으로 쓴다
     (분모 최소 0.5%). 프리마켓처럼 등락이 0.0x%p로 작은 날에도 0이 아닌 칸은
     최소 세기(0.38) 이상 칠해져 상승 초록·하락 빨강이 눈에 보인다. 0%만 색 없음(패널 회색). */
  var MIN_INK = 0.38;

  /* 눈금 — 보이는 칸 중 가장 큰 |등락률|. 최소 0.5%.
     등락률이 전부 0이면 0.5% (모두 회색). */
  function scaleOf(cells) {
    var max = 0;
    (cells || []).forEach(function (c) {
      var v = c && c.chg != null ? Math.abs(Number(c.chg)) : 0;
      if (isFinite(v) && v > max) max = v;
    });
    return Math.max(0.5, max);
  }

  function inkOf(chg, scale) {
    var v = Number(chg);
    if (chg == null || !isFinite(v) || Math.abs(v) < 1e-9) return 0;
    var den = (scale == null || !isFinite(scale) || scale <= 0) ? 3 : scale;
    var t = Math.min(1, Math.abs(v) / den);
    return MIN_INK + (1 - MIN_INK) * t;
  }

  function colorOf(chg, scale) {
    var flat = CSS('--panel2', '#2e3646');
    var green = '#1E7A5C', red = '#8E2A38';
    var v = Number(chg) || 0;
    var t = inkOf(v, scale);
    if (!t) return blend(flat, flat, 0);
    return blend(flat, v > 0 ? green : red, t);
  }

  /* 칸 안에 여러 줄을 적는 경우(반도체 종목 칸: 티커·회사 이름·등락률·시가총액).
     높이에 들어가는 만큼만 적고, 첫 줄(티커)은 폭에 맞춰 줄인다. 자리가 모자라면
     회사 이름보다 등락률·시가총액을 먼저 남긴다. */
  function drawLines(ctx, r, lines) {
    var F = '-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    var maxW = r.w - 8;
    if (maxW <= 8 || !lines.length) return;
    var show = r.h >= 60 ? 4 : (r.h >= 46 ? 3 : (r.h >= 32 ? 2 : 1));
    if (show > lines.length) show = lines.length;
    var fs = r.w < 48 ? 9 : (r.w < 70 ? 10.5 : (r.w < 110 ? 12 : 13));
    ctx.font = '700 ' + fs + 'px ' + F;
    while (fs > 7 && ctx.measureText(lines[0]).width > maxW) {
      fs -= 0.5;
      ctx.font = '700 ' + fs + 'px ' + F;
    }
    if (ctx.measureText(lines[0]).width > maxW) return;
    var subs = [], subFs = 9.5;
    if (show > 1 && lines.length >= 4) {
      var merged = lines[2] + ' · ' + lines[3];
      var variants = show >= 4 ? [lines[1], lines[2], lines[3]]
        : (show === 3 ? [lines[1], merged, lines[2]] : [merged, lines[2], lines[1]]);
      ctx.font = subFs + 'px ' + F;
      for (var i = 0; i < variants.length; i++) {
        var t = variants[i];
        if (!t || t === '—' || subs.indexOf(t) >= 0) continue;
        if (ctx.measureText(t).width <= maxW) {
          subs.push(t);
          if (subs.length >= show - 1) break;
        }
      }
    }
    var gap = 11.5;
    var total = fs + subs.length * gap;
    var y = r.y + r.h / 2 - total / 2 + fs / 2;
    var cx = r.x + r.w / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eef2f8';
    ctx.font = '700 ' + fs + 'px ' + F;
    ctx.fillText(lines[0], cx, y);
    ctx.fillStyle = '#dfe6ef';
    ctx.font = subFs + 'px ' + F;
    for (var j = 0; j < subs.length; j++) {
      y += gap;
      ctx.fillText(subs[j], cx, y);
    }
    ctx.restore();
  }

  /* 칸을 캔버스에 그린다. onPick(key) 로 누른 칸을 알려 준다. */
  function draw(box, cells, onPick) {
    if (!box) return;
    var canvas = box.querySelector('canvas');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = box.clientWidth || 320, H = box.clientHeight || 268;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '700 11px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (!cells || !cells.length) {
      ctx.fillStyle = CSS('--dim', '#949fb1');
      ctx.font = '12px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
      ctx.fillText('마켓맵 자료가 없습니다', W / 2, H / 2);
      box.__rects = [];
      return;
    }
    var items = cells.map(function (c) {
      return { key: c.name, weight: c.mcap || c.weight || 0, data: c };
    });
    var rects = compute(items, W, H);
    box.__rects = rects;
    box.__scale = scaleOf(cells);
    var line = CSS('--bg', '#1a1f2b');
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i], d = r.data;
      ctx.fillStyle = colorOf(d.chg, box.__scale);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (r.w < 34 || r.h < 20) continue;
      if (d.lines && d.lines.length) { drawLines(ctx, r, d.lines); continue; }
      var name = d.name;
      var sub = (d.chg == null ? '—' : (d.chg > 0 ? '+' : '') + d.chg.toFixed(2) + '%') + ' · ' + d.count + '종목';
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx.clip();
      var fs = r.w < 62 ? 9 : (r.w < 96 ? 10.5 : 12);
      ctx.font = '700 ' + fs + 'px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
      var tw = ctx.measureText(name).width;
      if (tw > r.w - 8) {
        fs = fs * 0.82;
        ctx.font = '700 ' + fs + 'px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
        tw = ctx.measureText(name).width;
      }
      if (tw <= r.w - 8) {
        ctx.fillStyle = '#eef2f8';
        var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        ctx.font = '9.5px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
        var showSub = r.h >= 34 && ctx.measureText(sub).width <= r.w - 8;
        ctx.font = '700 ' + fs + 'px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
        if (!showSub) ctx.fillText(name, cx, cy);
        else {
          ctx.fillText(name, cx, cy - 7);
          ctx.font = '9.5px -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif';
          ctx.fillStyle = '#dfe6ef';
          ctx.fillText(sub, cx, cy + 8);
        }
      }
      ctx.restore();
    }
    if (onPick && !canvas.__picked) {
      canvas.__picked = true;
      canvas.addEventListener('click', function (e) {
        var b = canvas.getBoundingClientRect();
        var px = e.clientX - b.left, py = e.clientY - b.top;
        var list = box.__rects || [];
        for (var i = 0; i < list.length; i++) {
          var r = list[i];
          if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
            onPick(r.key, r.data);
            return;
          }
        }
      });
      canvas.addEventListener('touchstart', function (e) {
        var b = canvas.getBoundingClientRect();
        var t = e.touches[0];
        if (!t) return;
        canvas.__tap = { x: t.clientX - b.left, y: t.clientY - b.top };
      }, { passive: true });
      canvas.addEventListener('touchend', function () {
        var t = canvas.__tap;
        if (!t) return;
        var list = box.__rects || [];
        for (var i = 0; i < list.length; i++) {
          var r = list[i];
          if (t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h) {
            onPick(r.key, r.data);
            return;
          }
        }
      });
    }
  }

  w.Treemap = { compute: compute, draw: draw, colorOf: colorOf, blend: blend,
    scaleOf: scaleOf, inkOf: inkOf, MIN_SIDE: MIN_SIDE, MIN_INK: MIN_INK };
})(window);
