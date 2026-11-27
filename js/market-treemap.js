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

  /* items: [{key, weight, data}] → [{key,x,y,w,h,weight,data}] */
  function compute(items, width, height) {
    var clean = items.filter(function (it) { return isFinite(it.weight) && it.weight > 0; })
      .sort(function (a, b) { return b.weight - a.weight; });
    if (!clean.length || width <= 0 || height <= 0) return [];
    var total = clean.reduce(function (s, it) { return s + it.weight; }, 0);
    var area = width * height;
    var scaled = clean.map(function (it) {
      return { key: it.key, area: it.weight / total * area, weight: it.weight, data: it.data };
    });
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

  /* -3% 이하 빨강 ~ 0 회색 ~ +3% 이상 초록 (TreemapView.colorOf). */
  function colorOf(chg) {
    var flat = CSS('--panel2', '#2e3646');
    var green = '#1E7A5C', red = '#8E2A38';
    var t = Math.max(-1, Math.min(1, (Number(chg) || 0) / 3));
    return blend(flat, t >= 0 ? green : red, Math.abs(t));
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
    var line = CSS('--bg', '#1a1f2b');
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i], d = r.data;
      ctx.fillStyle = colorOf(d.chg);
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

  w.Treemap = { compute: compute, draw: draw, colorOf: colorOf, blend: blend };
})(window);
