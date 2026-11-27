/* SVG 차트 — 외부 라이브러리 없이. 컨테이너 폭을 재서 실제 픽셀 좌표로 그린다. */
(function (w) {
  'use strict';

  function width(host, fallback) {
    var b = host.getBoundingClientRect();
    return Math.max(280, Math.round(b.width || fallback || 720));
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = (span / count) / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var s = Math.ceil(min / step) * step;
    var out = [];
    for (var v = s; v <= max + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  function fmtTick(v, d) {
    var s = Number(v).toFixed(d === undefined ? 0 : d);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var AXIS = '#5b6a82', GRID = '#333c4a', TXT = '#9aa5b6';

  /**
   * 꺾은선 차트.
   * opt: {series:[{name,color,points:[[x,y]..],dashed,width}], xMin,xMax,yMin,yMax,
   *       xTicks:[{x,label}], yTicks:[n], hlines:[{y,color,label,dash}], vlines:[{x,color,label}],
   *       markers:[{x,y,color,label,shape}], height, yFmt:(v)=>s, yDigits, pad}
   */
  function line(host, opt) {
    if (!host) return;
    var W = width(host), H = opt.height || 260;
    var pad = opt.pad || { l: 46, r: 14, t: 14, b: 26 };
    var series = (opt.series || []).filter(function (s) { return s.points && s.points.length; });
    var allX = [], allY = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { allX.push(p[0]); allY.push(p[1]); });
    });
    if (!allX.length) { host.innerHTML = '<div class="empty">그릴 값이 없습니다.</div>'; return; }

    var xMin = opt.xMin !== undefined ? opt.xMin : Math.min.apply(null, allX);
    var xMax = opt.xMax !== undefined ? opt.xMax : Math.max.apply(null, allX);
    var yMin = opt.yMin, yMax = opt.yMax;
    if (yMin === undefined) yMin = Math.min.apply(null, allY);
    if (yMax === undefined) yMax = Math.max.apply(null, allY);
    if (opt.snapY) {
      var stepY = opt.snapY;
      yMin = Math.floor(yMin / stepY) * stepY;
      yMax = Math.ceil(yMax / stepY) * stepY;
    }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    var xr = xMax - xMin || 1, yr = yMax - yMin || 1;
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var sx = function (x) { return pad.l + (x - xMin) / xr * iw; };
    var sy = function (y) { return pad.t + ih - (y - yMin) / yr * ih; };

    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img">'];

    /* 가로 눈금 */
    var yt = opt.yTicks || niceTicks(yMin, yMax, 5);
    yt.forEach(function (v) {
      if (v < yMin - 1e-9 || v > yMax + 1e-9) return;
      var y = sy(v);
      s.push('<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="' + GRID + '" stroke-width="1"/>');
      s.push('<text x="' + (pad.l - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="' + TXT + '">' + esc(fmtTick(v, opt.yDigits === undefined ? 0 : opt.yDigits)) + '</text>');
    });

    /* 세로 눈금 */
    if (opt.xTicks && opt.xTicks.length) {
      opt.xTicks.forEach(function (t) {
        var x = sx(t.x);
        if (x < pad.l - 1 || x > W - pad.r + 1) return;
        s.push('<line x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (pad.t + ih) + '" stroke="' + GRID + '" stroke-width="1" stroke-dasharray="2 4"/>');
        var anchor = x > W - pad.r - 16 ? 'end' : (x < pad.l + 16 ? 'start' : 'middle');
        s.push('<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '" font-size="10.5" fill="' + TXT + '">' + esc(t.label) + '</text>');
      });
    }

    /* 기준선 */
    (opt.hlines || []).forEach(function (h) {
      var y = sy(h.y);
      s.push('<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="' + (h.color || AXIS) + '" stroke-width="1"' + (h.dash ? ' stroke-dasharray="' + h.dash + '"' : '') + '/>');
      if (h.label) s.push('<text x="' + (W - pad.r - 2) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + (h.color || TXT) + '">' + esc(h.label) + '</text>');
    });
    (opt.vlines || []).forEach(function (v) {
      var x = sx(v.x);
      s.push('<line x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (pad.t + ih) + '" stroke="' + (v.color || AXIS) + '" stroke-width="1"' + (v.dash ? ' stroke-dasharray="' + v.dash + '"' : '') + '/>');
      if (v.label) s.push('<text x="' + (x + 4).toFixed(1) + '" y="' + (pad.t + 10) + '" font-size="10" fill="' + (v.color || TXT) + '">' + esc(v.label) + '</text>');
    });

    /* 선 */
    series.forEach(function (se) {
      var d = '';
      se.points.forEach(function (p, i) {
        d += (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1);
      });
      s.push('<path d="' + d + '" fill="none" stroke="' + se.color + '" stroke-width="' + (se.width || 1.8) + '" stroke-linejoin="round" stroke-linecap="round"' + (se.dashed ? ' stroke-dasharray="4 4"' : '') + '/>');
    });

    /* 점 표시 */
    (opt.markers || []).forEach(function (m) {
      var x = sx(m.x), y = sy(m.y);
      if (m.shape === 'square') {
        s.push('<rect x="' + (x - 3.5) + '" y="' + (y - 3.5) + '" width="7" height="7" fill="' + (m.color || '#e8ecf4') + '"/>');
      } else if (m.shape === 'diamond') {
        s.push('<path d="M' + x + ' ' + (y - 5) + 'L' + (x + 5) + ' ' + y + 'L' + x + ' ' + (y + 5) + 'L' + (x - 5) + ' ' + y + 'Z" fill="' + (m.color || '#e8ecf4') + '"/>');
      } else {
        s.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (m.r || 3.2) + '" fill="' + (m.color || '#e8ecf4') + '"/>');
      }
      if (m.label) {
        var anchor = m.anchor || (x > W * 0.75 ? 'end' : 'start');
        var dx = anchor === 'end' ? -7 : 7;
        s.push('<text x="' + (x + dx).toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" text-anchor="' + anchor + '" font-size="10.5" fill="' + esc(m.color || '#d5dce8') + '">' + esc(m.label) + '</text>');
      }
    });

    /* 테두리 */
    s.push('<line x1="' + pad.l + '" y1="' + (pad.t + ih) + '" x2="' + (W - pad.r) + '" y2="' + (pad.t + ih) + '" stroke="' + AXIS + '"/>');
    s.push('</svg>');
    host.innerHTML = s.join('');
  }

  /**
   * 산점도.
   * opt: {points:[{x,y,color,r,title}], xMin,xMax,yMin,yMax, xTicks, yTicks, xDigits, yDigits,
   *       vlines, hlines, markers, height, xLabel, yLabel}
   */
  function scatter(host, opt) {
    if (!host) return;
    var W = width(host), H = opt.height || 340;
    var pad = opt.pad || { l: 46, r: 16, t: 16, b: 34 };
    var pts = (opt.points || []);
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    (opt.vlines || []).forEach(function (v) { xs.push(v.x); });
    (opt.hlines || []).forEach(function (h) { ys.push(h.y); });
    if (!xs.length) { host.innerHTML = '<div class="empty">그릴 값이 없습니다.</div>'; return; }
    var xMin = opt.xMin !== undefined ? opt.xMin : Math.min.apply(null, xs);
    var xMax = opt.xMax !== undefined ? opt.xMax : Math.max.apply(null, xs);
    var yMin = opt.yMin !== undefined ? opt.yMin : Math.min.apply(null, ys);
    var yMax = opt.yMax !== undefined ? opt.yMax : Math.max.apply(null, ys);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    var xr = xMax - xMin || 1, yr = yMax - yMin || 1;
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var sx = function (x) { return pad.l + (x - xMin) / xr * iw; };
    var sy = function (y) { return pad.t + ih - (y - yMin) / yr * ih; };

    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img">'];
    var yt = opt.yTicks || niceTicks(yMin, yMax, 5);
    yt.forEach(function (v) {
      if (v < yMin - 1e-9 || v > yMax + 1e-9) return;
      var y = sy(v);
      s.push('<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="' + (Math.abs(v) < 1e-9 ? AXIS : GRID) + '" stroke-width="1"/>');
      s.push('<text x="' + (pad.l - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="' + TXT + '">' + esc(fmtTick(v, opt.yDigits === undefined ? 0 : opt.yDigits)) + '</text>');
    });
    var xt = opt.xTicks || niceTicks(xMin, xMax, 5);
    xt.forEach(function (v) {
      if (v < xMin - 1e-9 || v > xMax + 1e-9) return;
      var x = sx(v);
      s.push('<line x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (pad.t + ih) + '" stroke="' + GRID + '" stroke-width="1" stroke-dasharray="2 4"/>');
      s.push('<text x="' + x.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="10.5" fill="' + TXT + '">' + esc(fmtTick(v, opt.xDigits === undefined ? 0 : opt.xDigits)) + '</text>');
    });
    (opt.hlines || []).forEach(function (h) {
      var y = sy(h.y);
      s.push('<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="' + (h.color || AXIS) + '" stroke-width="1"' + (h.dash ? ' stroke-dasharray="' + h.dash + '"' : '') + '/>');
    });
    (opt.vlines || []).forEach(function (v) {
      var x = sx(v.x);
      s.push('<line x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (pad.t + ih) + '" stroke="' + (v.color || AXIS) + '" stroke-width="1"' + (v.dash ? ' stroke-dasharray="' + v.dash + '"' : '') + '/>');
      if (v.label) s.push('<text x="' + (x + 5).toFixed(1) + '" y="' + (pad.t + 12) + '" font-size="10.5" fill="' + (v.color || TXT) + '">' + esc(v.label) + '</text>');
    });
    pts.forEach(function (p) {
      var cx = sx(p.x), cy = sy(p.y);
      s.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (p.r || 2.6) + '" fill="' + (p.color || '#6a9ae0') + '" fill-opacity="' + (p.opacity || 0.55) + '"' + (p.stroke ? ' stroke="' + p.stroke + '" stroke-width="1.5"' : '') + '>');
      if (p.title) s.push('<title>' + esc(p.title) + '</title>');
      s.push('</circle>');
    });
    (opt.markers || []).forEach(function (m) {
      var x = sx(m.x), y = sy(m.y);
      s.push('<path d="M' + x.toFixed(1) + ' ' + (y - 6).toFixed(1) + 'L' + (x + 6).toFixed(1) + ' ' + y.toFixed(1) + 'L' + x.toFixed(1) + ' ' + (y + 6).toFixed(1) + 'L' + (x - 6).toFixed(1) + ' ' + y.toFixed(1) + 'Z" fill="' + (m.color || '#e8ecf4') + '" stroke="#1a1f2b" stroke-width="1"/>');
      if (m.label) s.push('<text x="' + (x + 9).toFixed(1) + '" y="' + (y - 8).toFixed(1) + '" font-size="10.5" fill="' + (m.color || '#e8ecf4') + '">' + esc(m.label) + '</text>');
    });
    if (opt.xLabel) s.push('<text x="' + (pad.l + iw / 2) + '" y="' + (H - 1) + '" text-anchor="middle" font-size="10.5" fill="' + TXT + '">' + esc(opt.xLabel) + '</text>');
    if (opt.yLabel) s.push('<text x="10" y="' + (pad.t + 2) + '" font-size="10.5" fill="' + TXT + '">' + esc(opt.yLabel) + '</text>');
    s.push('</svg>');
    host.innerHTML = s.join('');
  }

  w.Charts = { line: line, scatter: scatter };
})(window);
