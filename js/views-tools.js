/* 도구 화면 — 세금(원본 core/Tax.kt) · 증권사 파일 가져오기(core/BrokerFile.kt) ·
   알림·위젯(Notify.kt·ScoreWidget.kt 의 웹 대체) · 설정·백업(SettingsScreen.kt·core/Backup.kt).
   원본에 있는 식·문구·기본값을 그대로 쓰고, 기기 기능만 웹 수단으로 바꾼다(바꾼 것은 화면에 적는다). */
(function (w) {
  'use strict';
  var V = w.Views = w.Views || {};

  var TAX_DEDUCTION = 2500000;   // 원본 OverseasTax.DEDUCTION_KRW
  var TAX_RATE = 0.22;           // 소득세 20% + 지방소득세 2%

  var state = {
    taxRows: null, taxFx: null, taxAlready: 0, taxOut: null,
    imp: null, impErr: '', impFile: '',
    msg: ''
  };

  function won(v) {
    if (v == null || isNaN(v)) return '—';
    return Math.round(v).toLocaleString('ko-KR');
  }
  function usd(v) {
    if (v == null || isNaN(v)) return '—';
    return '$' + Number(v).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* ------------------------------------------------------------ 도구 첫 화면 */
  function index(view) {
    var h = '<div class="hero"><div class="crumb"><a href="#/">홈</a> / 도구</div><h1>도구</h1>' +
      '<p>원본 앱의 세금 계산·잔고 파일 가져오기·알림·설정·백업을 웹에서 씁니다. 기기 기능(알림·위젯)은 브라우저 수단으로 바꿨고, 바꾼 점을 각 화면에 적었습니다.</p></div>';
    h += '<div class="tool-list">';
    h += card('#/tools/tax', '세금 (양도소득세)', '해외주식 매도 계획의 예상 세액 — 원본 core/Tax.kt 식');
    h += card('#/tools/import', '증권사 파일 가져오기', 'CSV·엑셀(xlsx) 잔고를 읽어 보유 표에 반영');
    h += card('#/tools/notify', '알림·위젯', '브라우저 알림·홈 화면 추가·점수 카드 PNG');
    h += card('#/tools/settings', '설정·백업', '화면·알림 설정, JSON 백업과 복원');
    h += card('#/tools/data', '자료 안내', '어떤 값이 어디서 오는지, 갱신 주기');
    h += '</div>';
    view.innerHTML = h;
  }

  function card(href, title, sub) {
    return '<a class="tool-card" href="' + href + '"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></a>';
  }

  /* ------------------------------------------------------------ 세금 */
  function tax(view) {
    if (!state.taxRows) {
      state.taxRows = [{ sym: '', qty: '', price: '', avg: '' }];
      state.taxFx = Mkt.ready ? (Mkt.fx() || 1350) : 1350;
    }
    var rows = state.taxRows;
    var h = '<div class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/tools">도구</a> / 세금</div>' +
      '<h1>해외(미국) 주식 양도소득세 예상액</h1>' +
      '<p>원본 앱의 계산식 그대로입니다. 세율 22%(소득세 20% + 지방소득세 2%), 양도소득 기본공제 연 250만원, ' +
      '손익통산은 같은 해 해외주식끼리만.</p></div>';

    h += '<section class="panel"><div class="card-h"><h2>매도 계획</h2>' +
      '<span class="right"><button class="btn sm ghost" type="button" data-tax-hold>보유에서 불러오기</button></span></div>';
    h += '<div class="tbl-wrap"><table class="mkt"><thead><tr><th class="nm">티커</th><th>수량</th><th>매도가</th><th>평단가</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      h += '<tr><td class="nm"><input class="tin" data-i="' + i + '" data-k="sym" value="' + esc(r.sym) + '" placeholder="SOXL" aria-label="티커"></td>' +
        '<td><input class="tin" data-i="' + i + '" data-k="qty" value="' + esc(r.qty) + '" inputmode="decimal" aria-label="수량"></td>' +
        '<td><input class="tin" data-i="' + i + '" data-k="price" value="' + esc(r.price) + '" inputmode="decimal" aria-label="매도가"></td>' +
        '<td><input class="tin" data-i="' + i + '" data-k="avg" value="' + esc(r.avg) + '" inputmode="decimal" aria-label="평단가"></td>' +
        '<td><button class="x" type="button" data-tax-del="' + i + '">✕</button></td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="row" style="margin-top:10px"><button class="btn" type="button" data-tax-add>+ 줄 추가</button></div>';

    h += '<div class="form-row" style="margin-top:12px"><label for="taxFx">원/달러</label>' +
      '<input type="number" id="taxFx" value="' + esc(state.taxFx || '') + '" step="0.01">' +
      '<span class="src">' + (Mkt.ready && Mkt.fx() ? '시세 자료의 환율 ' + Mkt.fx() : '환율 자료 없음 — 직접 넣어 주세요') + '</span></div>';
    h += '<div class="form-row"><label for="taxAlready">올해 이미 실현한 양도차익</label>' +
      '<input type="number" id="taxAlready" value="' + esc(state.taxAlready || '') + '" step="10000"> <span class="src">원 · 비우면 0(공제 전액 남음)으로 가정</span></div>';
    h += '<div class="row"><button class="btn primary" type="button" data-tax-run>계산</button></div>';
    h += '<div id="taxOut" style="margin-top:12px">' + taxOutHtml() + '</div>';
    h += '<div class="note">계산하지 않는 것 — 수수료, 외국납부세액공제, 취득·양도 시점 환율 차이(지금 환율 하나로 환산), 대주주 여부, 연말 결제일 기준. ' +
      '기본공제는 연간 누적이라 앱이 알 수 없어 위에 적은 실현 차익을 받습니다. 이 화면은 참고용이며 세무 신고를 대신하지 않습니다.</div>';
    h += '</section>';
    view.innerHTML = h;
    bindTax(view);
  }

  function taxOutHtml() {
    var o = state.taxOut;
    if (!o) return '<div class="note">값을 넣고 계산을 누르세요.</div>';
    if (o.error) return '<div class="empty">' + esc(o.error) + '</div>';
    var h = '<div class="kv">' +
      '<div><b>매도 대금</b><span>' + usd(o.sellUsd) + '</span></div>' +
      '<div><b>양도차익(달러)</b><span>' + usd(o.gainUsd) + '</span></div>' +
      '<div><b>양도차익(원)</b><span>' + won(o.gainKrw) + '원</span></div>' +
      '<div><b>이번 매도로 늘어나는 세금</b><span class="bad">' + won(o.taxKrw) + '원</span></div>' +
      '<div><b>세금(달러)</b><span>' + usd(o.taxUsd) + '</span></div>' +
      '<div><b>세후 매도 대금</b><span class="px">' + usd(o.afterTaxUsd) + '</span></div>' +
      '</div>';
    if (o.assumedFullDeduction) h += '<div class="note warn">올해 이미 실현한 양도차익이 비어 0원으로 가정했습니다(기본공제 250만원 전액 남음).</div>';
    if (o.reducesTax) h += '<div class="note ok">이번 매도는 손실이라 오히려 세금이 줄어듭니다(연말 신고 때 반영).</div>';
    if (o.unknown) h += '<div class="note warn">평단가가 없어 차익을 모르는 줄 ' + o.unknown + '개 — 그 줄은 세액 배분에서 빠졌습니다.</div>';
    if (o.rows.length) {
      h += '<div class="tbl-wrap" style="margin-top:10px"><table class="mkt"><thead><tr>' +
        '<th class="nm">종목</th><th>매도 대금</th><th>차익</th><th>이 줄의 세금</th></tr></thead><tbody>';
      o.rows.forEach(function (r) {
        h += '<tr><td class="nm">' + esc(r.sym) + '</td><td>' + usd(r.proceedsUsd) + '</td>' +
          '<td>' + (r.known ? usd(r.gainUsd) : '<span class="dim">평단가 없음</span>') + '</td>' +
          '<td>' + usd(r.taxUsd) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="note">줄마다의 세금은 이번 세액을 그 줄의 이익 비율로 나눈 값입니다(원본 Tax.estimate 와 같은 방식).</div>';
    }
    return h;
  }

  function bindTax(view) {
    view.querySelectorAll('.tin').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = +inp.getAttribute('data-i'), k = inp.getAttribute('data-k');
        if (state.taxRows[i]) state.taxRows[i][k] = inp.value;
      });
    });
    view.querySelectorAll('[data-tax-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.taxRows.splice(+b.getAttribute('data-tax-del'), 1);
        if (!state.taxRows.length) state.taxRows.push({ sym: '', qty: '', price: '', avg: '' });
        tax(view);
      });
    });
    var add = view.querySelector('[data-tax-add]');
    if (add) add.addEventListener('click', function () {
      state.taxRows.push({ sym: '', qty: '', price: '', avg: '' });
      tax(view);
    });
    var hold = view.querySelector('[data-tax-hold]');
    if (hold) hold.addEventListener('click', function () {
      var hs = S.get('holdings', []) || [];
      var out = [];
      hs.forEach(function (r) {
        if (!r.sym || String(r.sym).toUpperCase() === 'CASH') return;
        var q = Mkt.ready ? Mkt.quote(r.sym) : null;
        var px = q && q.regPrice != null ? q.regPrice : r.price;
        if (px == null) return;
        out.push({ sym: r.sym, qty: r.qty == null ? '' : r.qty, price: px, avg: r.avg == null ? '' : r.avg });
      });
      if (!out.length) { state.msg = '보유 표에 티커·수량이 있는 줄이 없습니다.'; tax(view); return; }
      state.taxRows = out;
      tax(view);
    });
    var run = view.querySelector('[data-tax-run]');
    if (run) run.addEventListener('click', function () {
      var fxEl = view.querySelector('#taxFx');
      var alEl = view.querySelector('#taxAlready');
      state.taxFx = numOrNull(fxEl && fxEl.value);
      state.taxAlready = numOrNull(alEl && alEl.value) || 0;
      state.taxOut = computeTax();
      var box = view.querySelector('#taxOut');
      if (box) box.innerHTML = taxOutHtml();
    });
  }

  /* 원본 OverseasTax.taxOf / estimate 를 그대로 옮긴 것. */
  function taxOf(gainKrw, alreadyKrw) {
    return (Math.max(0, alreadyKrw + gainKrw - TAX_DEDUCTION) -
      Math.max(0, alreadyKrw - TAX_DEDUCTION)) * TAX_RATE;
  }

  function computeTax() {
    var fx = state.taxFx;
    if (!fx || !isFinite(fx) || fx <= 0) return { error: '환율이 없으면 계산하지 않습니다 — 원/달러를 넣어 주세요.' };
    var rows = [], sells = 0;
    state.taxRows.forEach(function (r) {
      var qty = numOrNull(r.qty), px = numOrNull(r.price), avg = numOrNull(r.avg);
      if (!qty || !px) return;
      sells++;
      var known = avg != null && avg > 0;
      rows.push({
        sym: (r.sym || '').toUpperCase() || '(이름 없음)',
        proceedsUsd: Math.abs(qty) * px,
        gainUsd: known ? Math.abs(qty) * (px - avg) : 0,
        known: known, taxUsd: 0
      });
    });
    if (!sells) return { error: '매도 줄이 없습니다(수량·매도가를 넣어 주세요).' };
    var gainUsd = rows.filter(function (r) { return r.known; }).reduce(function (s, r) { return s + r.gainUsd; }, 0);
    var gainKrw = gainUsd * fx;
    var already = isFinite(state.taxAlready) ? state.taxAlready : 0;
    var raw = taxOf(gainKrw, already);
    var taxKrw = Math.max(0, raw);
    var positive = rows.filter(function (r) { return r.known && r.gainUsd > 0; })
      .reduce(function (s, r) { return s + r.gainUsd; }, 0);
    rows.forEach(function (r) {
      r.taxUsd = (r.known && r.gainUsd > 0 && positive > 0) ? taxKrw * r.gainUsd / positive / fx : 0;
    });
    var sellUsd = rows.reduce(function (s, r) { return s + r.proceedsUsd; }, 0);
    return {
      fx: fx, gainUsd: gainUsd, gainKrw: gainKrw, alreadyKrw: already,
      taxKrw: taxKrw, taxUsd: taxKrw / fx, sellUsd: sellUsd, afterTaxUsd: sellUsd - taxKrw / fx,
      assumedFullDeduction: Math.abs(already) < 0.5, reducesTax: raw < -0.5,
      unknown: rows.filter(function (r) { return !r.known; }).length, rows: rows
    };
  }

  /* ------------------------------------------------------------ 증권사 파일 가져오기 */
  var ROLES = {
    name: ['종목명', '종목이름', '상품명', '종목'],
    ticker: ['종목코드', '종목번호', '단축코드', '티커', '심볼', '코드'],
    qty: ['보유수량', '잔고수량', '평가수량', '보유량', '수량'],
    avg: ['매수평균가', '매입평균가', '평균단가', '매입단가', '매수가', '평단가', '매입가', '단가']
  };

  function normalize(s) {
    return String(s || '').replace(/\s+/g, '').replace(/[()\[\]<>·\-_/]/g, '').replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).trim();
  }

  /* 원본 BrokerFile.score: 같으면 3000+길이, 시작하면 2000+길이, 품으면 1000+길이. */
  function scoreHeader(h, kw) {
    var n = normalize(h);
    if (!n) return 0;
    if (n === kw) return 3000 + kw.length;
    if (n.indexOf(kw) === 0) return 2000 + kw.length;
    if (n.indexOf(kw) >= 0) return 1000 + kw.length;
    return 0;
  }

  /* 원본 findHeader: 앞 20줄에서 후보(점수)를 모아 높은 것부터 붙이고,
     칸 수가 많을수록 · 점수 합이 클수록 좋은 머리글로 고른다(동점이면 앞줄). */
  function findHeader(table) {
    var limit = Math.min(20, table.length), best = null;
    var roles = Object.keys(ROLES);
    for (var i = 0; i < limit; i++) {
      var row = table[i] || [];
      var cands = [];
      for (var c = 0; c < row.length; c++) {
        var h = normalize(row[c]);
        if (!h) continue;
        roles.forEach(function (role, ri) {
          ROLES[role].forEach(function (kw) {
            var s = scoreHeader(h, kw);
            if (s > 0) cands.push([s, ri, c]);
          });
        });
      }
      cands.sort(function (a, b) { return b[0] - a[0]; });
      var cols = {}, used = {}, weight = 0;
      cands.forEach(function (x) {
        var role = roles[x[1]], col = x[2];
        if (cols[role] != null || used[col]) return;
        cols[role] = col; used[col] = 1; weight += x[0];
      });
      var n = Object.keys(cols).length;
      if (n < 2) continue;
      if (!best || n > Object.keys(best.cols).length ||
          (n === Object.keys(best.cols).length && weight > best.weight)) {
        best = { row: i, cols: cols, weight: weight, cells: row.slice(0, 16) };
      }
    }
    return best;
  }

  function num(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    s = s.replace(/[\u00A0\s,]/g, '').replace(/[₩$원주%]/g, '').replace(/\+/g, '');
    var neg = false;
    if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') { neg = true; s = s.slice(1, -1); }
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    if (s.charAt(s.length - 1) === '-') { neg = true; s = s.slice(0, -1); }
    var v = Number(s);
    if (!isFinite(v)) return null;
    return neg ? -v : v;
  }

  var KR_CODE = /^\d{6}$/, KR_PREFIX = /^[Aa]\d{6}$/, KR_SUFFIX = /^(\d{6})\.(KS|KQ)$/i, US_TICK = /^[A-Za-z]{1,6}([.\-][A-Za-z]{1,2})?$/;

  function cleanTicker(raw) {
    var t = String(raw || '').trim().replace(/[\s\u00A0]/g, '');
    if (t.charAt(0) === "'") t = t.slice(1);
    t = t.replace(/"/g, '');
    if (KR_PREFIX.test(t)) return t.slice(1);
    var m = KR_SUFFIX.exec(t);
    if (m) return m[1];
    return t.toUpperCase();
  }

  function codeOf(ticker, name) {
    var t = cleanTicker(ticker);
    if (KR_CODE.test(t)) return t;
    var m = /(\d{6})/.exec(String(name || ''));
    return m ? m[1] : null;
  }

  function classify(ticker, name) {
    var t = cleanTicker(ticker);
    if (KR_CODE.test(t)) return { market: 'kr', ambiguous: false };
    if (US_TICK.test(t)) return { market: 'us', ambiguous: false };
    return { market: 'us', ambiguous: true };
  }

  function isTotalRow(text) {
    var t = normalize(text);
    if (!t) return false;
    return t === '합계' || t === '총계' || t === '소계' || t === '전체' || t === '총합계' ||
      t.indexOf('합계') === 0 || t.indexOf('총계') === 0 || t.indexOf('소계') === 0 || t.indexOf('합계') >= 0;
  }

  function csvRows(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function mapTable(table, format, encoding) {
    var found = findHeader(table);
    if (!found) {
      return { ok: false, format: format, encoding: encoding, rows: [], missing: [],
        message: '머리글 줄을 찾지 못했습니다 — 앞 20줄에 종목명·수량 칸이 있는 줄이 없습니다. 증권사 잔고 화면에서 받은 파일인지 확인해 주세요.' };
    }
    var cols = found.cols;
    var missing = [];
    if (cols.qty == null) missing.push('보유수량');
    if (cols.name == null && cols.ticker == null) missing.push('종목명·종목코드');
    if (cols.avg == null) missing.push('매입단가(평단가)');
    var need = [];
    if (cols.qty == null) need.push('보유수량');
    if (cols.name == null && cols.ticker == null) need.push('종목명·종목코드');
    if (need.length) return { ok: false, format: format, encoding: encoding, rows: [], missing: missing,
      headers: found.cells, message: '이 칸을 찾지 못했습니다: ' + need.join(', ') };
    var rows = [], skipped = 0;
    for (var i = found.row + 1; i < table.length; i++) {
      var row = table[i] || [];
      var nameRaw = cols.name != null ? String(row[cols.name] || '').trim() : '';
      var tickerRaw = cols.ticker != null ? String(row[cols.ticker] || '').trim() : '';
      if (isTotalRow(nameRaw) || isTotalRow(tickerRaw)) { skipped++; continue; }
      var qty = num(row[cols.qty]);
      if (qty == null || qty === 0) { skipped++; continue; }
      if (!nameRaw && !tickerRaw) { skipped++; continue; }
      var ticker = cleanTicker(tickerRaw);
      var cls = classify(ticker, nameRaw);
      var appName = cls.market === 'kr' ? (nameRaw || ticker) : (ticker || nameRaw);
      if (cls.market === 'kr' && !KR_CODE.test(ticker)) {
        var code = codeOf(ticker, nameRaw);
        if (code) ticker = code;
      }
      var avg = cols.avg != null ? num(row[cols.avg]) : null;
      var item = { name: appName, displayName: nameRaw || ticker, ticker: ticker,
        qty: qty, avg: avg == null ? 0 : avg, market: cls.market, ambiguous: cls.ambiguous };
      var same = rows.findIndex(function (x) {
        var a = codeOf(x.ticker, x.displayName), b = codeOf(item.ticker, item.displayName);
        if (a && b) return a === b;
        return normalize(x.displayName).toLowerCase() === normalize(item.displayName).toLowerCase();
      });
      if (same >= 0) {
        var old = rows[same];
        var total = old.qty + item.qty;
        old.avg = total > 0 ? (old.avg * old.qty + item.avg * item.qty) / total : old.avg;
        old.qty = total;
      } else rows.push(item);
    }
    return { ok: true, format: format, encoding: encoding, headerRow: found.row + 1, headers: found.cells,
      rows: rows, skipped: skipped, missing: missing,
      domestic: rows.filter(function (r) { return r.market === 'kr'; }).length,
      foreign: rows.filter(function (r) { return r.market === 'us'; }).length,
      ambiguous: rows.filter(function (r) { return r.ambiguous; }).length };
  }

  function decodeText(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), enc: 'UTF-8(BOM)' };
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), enc: 'UTF-16LE' };
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), enc: 'UTF-8' };
    } catch (e) {
      try {
        return { text: new TextDecoder('euc-kr').decode(bytes), enc: 'CP949(EUC-KR)' };
      } catch (e2) {
        return { text: new TextDecoder('utf-8').decode(bytes), enc: 'UTF-8(일부 글자 깨짐)' };
      }
    }
  }

  /* xlsx = zip. 브라우저 내장 DecompressionStream('deflate-raw') 로 풀어 시트 XML 만 읽는다. */
  function unzip(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    var eocd = -1;
    for (var i = u8.length - 22; i >= 0 && i > u8.length - 70000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip 끝을 찾지 못했습니다');
    var count = dv.getUint16(eocd + 10, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    var files = {}, p = cdOff;
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var localOff = dv.getUint32(p + 42, true);
      var name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nameLen));
      files[name] = { method: method, csize: csize, local: localOff };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return {
      names: Object.keys(files),
      read: function (name) {
        var f = files[name];
        if (!f) return null;
        var lp = f.local;
        var nameLen = dv.getUint16(lp + 26, true), extraLen = dv.getUint16(lp + 28, true);
        var start = lp + 30 + nameLen + extraLen;
        var data = u8.subarray(start, start + f.csize);
        if (f.method === 0) return Promise.resolve(data);
        if (!w.DecompressionStream) return Promise.reject(new Error('이 브라우저는 압축 풀기를 지원하지 않습니다 — CSV 로 저장해 주세요'));
        var ds = new DecompressionStream('deflate-raw');
        var stream = new Blob([data]).stream().pipeThrough(ds);
        return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      }
    };
  }

  function xmlRows(xml, shared) {
    var rows = [];
    // <row .../> (빈 줄) 과 <row>...</row> 둘 다. 빈 줄을 건너뛰면 뒤 줄의 칸이 앞 줄로 밀린다.
    var rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, m;
    while ((m = rowRe.exec(xml))) {
      var inner = m[2] || '';
      var cells = [], cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g, cm;
      var col = 0;
      while ((cm = cellRe.exec(inner))) {
        var attrs = cm[1] || cm[3] || '', body = cm[2] || '';
        var ref = /r="([A-Z]+)\d+"/.exec(attrs);
        if (ref) {
          var letters = ref[1], idx = 0;
          for (var i = 0; i < letters.length; i++) idx = idx * 26 + (letters.charCodeAt(i) - 64);
          col = idx - 1;
        }
        var v = '';
        var vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        var isStr = /t="s"/.test(attrs);
        var inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(body);
        if (inline) v = inline[1];
        else if (vm) v = isStr ? ((shared[+vm[1]] != null) ? shared[+vm[1]] : '') : vm[1];
        cells[col] = unxml(v);
        col++;
      }
      rows.push(cells);
    }
    return rows;
  }

  function unxml(s) {
    return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  function readXlsx(buf) {
    var zip = unzip(buf);
    var sheet = zip.names.filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })[0];
    if (!sheet) throw new Error('엑셀 안에서 시트를 찾지 못했습니다.');
    var sharedName = 'xl/sharedStrings.xml';
    var sharedP = zip.names.indexOf(sharedName) >= 0 ? zip.read(sharedName).then(function (u8) {
      var xml = new TextDecoder('utf-8').decode(u8), out = [], re = /<si>([\s\S]*?)<\/si>/g, m;
      while ((m = re.exec(xml))) {
        var t = '', tr = /<t[^>]*>([\s\S]*?)<\/t>/g, tm;
        while ((tm = tr.exec(m[1]))) t += unxml(tm[1]);
        out.push(t);
      }
      return out;
    }) : Promise.resolve([]);
    return sharedP.then(function (shared) {
      return zip.read(sheet).then(function (u8) {
        var rows = xmlRows(new TextDecoder('utf-8').decode(u8), shared);
        if (!rows.length) throw new Error('엑셀 시트가 비어 있습니다.');
        return rows;
      });
    });
  }

  function importView(view) {
    var h = '<div class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/tools">도구</a> / 가져오기</div>' +
      '<h1>증권사 파일 가져오기</h1>' +
      '<p>증권사 홈페이지에서 내려받은 잔고 파일(CSV·엑셀 xlsx)을 읽어 보유 표에 반영합니다. ' +
      '같은 종목은 수량·평단가만 바꾸고, 새 종목은 표 아래에 더합니다. 목표 비중은 건드리지 않습니다.</p></div>';

    h += '<section class="panel"><div class="card-h"><h2>파일 고르기</h2></div>' +
      '<div class="form-row"><input type="file" id="impFile" accept=".csv,.txt,.tsv,.xlsx"></div>' +
      '<div class="note">읽는 순서 — 압축(zip) 서명이면 엑셀(xlsx), 아니면 글자 파일(CSV). 글자는 UTF-8 → CP949(EUC-KR) 순서로 풀고, ' +
      '앞 20줄 안에서 머리글을 찾아 종목명·종목코드·수량·평단가 칸을 뽑습니다. 예전 엑셀(.xls)과 PDF 는 읽지 못합니다.</div>';
    if (state.impErr) h += '<div class="note bad">' + esc(state.impErr) + '</div>';
    h += '<div id="impOut" style="margin-top:10px">' + impOutHtml() + '</div>';
    h += '</section>';
    view.innerHTML = h;

    var input = view.querySelector('#impFile');
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      state.impFile = f.name;
      state.impErr = '';
      var reader = new FileReader();
      reader.onload = function () {
        var buf = reader.result;
        var bytes = new Uint8Array(buf);
        var isZip = bytes[0] === 0x50 && bytes[1] === 0x4B;
        var isOldXls = bytes[0] === 0xD0 && bytes[1] === 0xCF;
        var isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
        if (isOldXls) { state.imp = null; state.impErr = '예전 엑셀 형식(.xls)은 읽지 못합니다. 엑셀에서 .xlsx 나 .csv 로 저장해 주세요.'; importView(view); return; }
        if (isPdf) { state.imp = null; state.impErr = 'PDF 는 읽지 못합니다. 증권사 홈페이지에서 엑셀(.xlsx)이나 CSV 로 받아 주세요.'; importView(view); return; }
        var job;
        if (isZip) job = readXlsx(buf).then(function (table) { return mapTable(table, '엑셀(xlsx)', ''); });
        else {
          var d = decodeText(buf);
          job = Promise.resolve(mapTable(csvRows(d.text), 'CSV', d.enc));
        }
        job.then(function (rep) {
          state.imp = rep;
          state.impErr = rep.ok ? '' : rep.message;
          importView(view);
        }).catch(function (e) {
          state.imp = null;
          state.impErr = String((e && e.message) || e);
          importView(view);
        });
      };
      reader.readAsArrayBuffer(f);
    });

    view.querySelectorAll('[data-imp-apply]').forEach(function (b) {
      b.addEventListener('click', function () { applyImport(view); });
    });
    view.querySelectorAll('[data-imp-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { state.imp = null; state.impErr = ''; importView(view); });
    });
    view.querySelector('[data-imp-sample]') && view.querySelector('[data-imp-sample]').addEventListener('click', function () {
      var txt = '종목명,종목코드,보유수량,매입평균가\n삼성전자,005930,30,"150,000"\nTQQQ,TQQQ,100,53.03\n';
      var rep = mapTable(csvRows(txt), 'CSV(예시)', 'UTF-8');
      state.imp = rep; state.impErr = rep.ok ? '' : rep.message;
      importView(view);
    });
  }

  function impOutHtml() {
    var rep = state.imp;
    if (!rep) return '<button class="btn ghost" type="button" data-imp-sample>예시 CSV 로 동작 보기</button>';
    if (!rep.ok) {
      return '<div class="block"><b>칸을 찾지 못했습니다</b><p class="note">' + esc(rep.message) + '</p>' +
        '<button class="btn ghost" type="button" data-imp-cancel>닫기</button></div>';
    }
    var h = '<div class="card-h"><h2>파일 미리보기</h2><span class="right"><span class="src">' +
      esc([state.impFile, rep.format, rep.encoding].filter(Boolean).join(' · ')) + '</span></span></div>';
    h += '<div class="note">국내 ' + rep.domestic + ' · 미국 ' + rep.foreign + ' · 모두 ' + rep.rows.length + '종목' +
      (rep.ambiguous ? ' · 판단 애매 ' + rep.ambiguous + '(미국으로 넣음)' : '') +
      (rep.skipped ? ' · 건너뜀 ' + rep.skipped + '줄(수량 0·합계 줄)' : '') + '</div>';
    h += '<div class="tbl-wrap" style="margin-top:8px"><table class="mkt"><thead><tr>' +
      '<th class="nm">종목</th><th>수량</th><th>평단가</th><th>시장</th></tr></thead><tbody>';
    rep.rows.forEach(function (r) {
      h += '<tr><td class="nm"><span class="sym">' + esc(r.name) + '</span>' +
        (r.market === 'us' ? '<span class="desc">티커 ' + esc(r.ticker) + '</span>' : '<span class="desc">' + esc(r.ticker) + '</span>') + '</td>' +
        '<td>' + Math.round(r.qty).toLocaleString('ko-KR') + '주</td>' +
        '<td>' + (r.avg > 0 ? r.avg.toLocaleString('ko-KR') : '—') + '</td>' +
        '<td>' + (r.market === 'kr' ? '국내' : '미국') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="note">적용하면 같은 종목은 수량·평단가만 바꾸고 나머지는 더합니다. 현재가는 증시 자료에 있으면 그 값으로 채웁니다(없으면 빈 칸).</div>';
    h += '<div class="row" style="margin-top:8px"><button class="btn primary" type="button" data-imp-apply>적용 — 표에 넣기</button>' +
      '<button class="btn ghost" type="button" data-imp-cancel>취소</button></div>';
    return h;
  }

  function applyImport(view) {
    var rep = state.imp;
    if (!rep || !rep.ok) return;
    var list = S.get('holdings', []) || [];
    var updated = 0, added = 0;
    rep.rows.forEach(function (r) {
      var idx = list.findIndex(function (h) {
        var hs = String(h.sym || '').toUpperCase(), rs = String(r.ticker || r.name).toUpperCase();
        return hs && rs && (hs === rs || (r.market === 'kr' && hs === r.ticker));
      });
      var px = Mkt.ready ? (Mkt.quote(r.ticker) || {}).regPrice : null;
      if (idx >= 0) {
        list[idx].qty = r.qty;
        if (r.avg > 0) list[idx].avg = r.avg;
        if (px != null) list[idx].price = px;
        updated++;
      } else {
        list.push({ id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          sym: r.ticker || r.name, qty: r.qty, avg: r.avg || null, price: px == null ? null : px, target: 0 });
        added++;
      }
    });
    S.set('holdings', list);
    state.imp = null;
    state.impErr = '';
    toast(updated + '종목 갱신 · ' + added + '종목 추가');
    location.hash = '#/rebalance';
  }

  /* ------------------------------------------------------------ 알림·위젯 */
  function notifyView(view) {
    var set = S.get('notify', null) || { on: true, thNdx: 90, thSox: 90, quietOn: true, quietStart: 1380, quietEnd: 420 };
    var perm = (w.Notification && Notification.permission) || 'unsupported';
    var h = '<div class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/tools">도구</a> / 알림</div>' +
      '<h1>알림·위젯</h1><p>원본 앱은 기기 알림과 홈 화면 위젯으로 점수를 알려 줍니다. 웹에서는 브라우저 알림·홈 화면 바로가기·PNG 카드로 바꿉니다.</p></div>';

    h += '<section class="panel"><div class="card-h"><h2>브라우저 알림</h2><span class="right"><span class="src">권한 ' +
      (perm === 'granted' ? '허용' : perm === 'denied' ? '차단됨' : perm === 'unsupported' ? '지원 안 함' : '아직 묻지 않음') + '</span></span></div>';
    h += '<div class="note">웹 알림은 <b>이 화면을 열어 둔 동안</b>에만 울립니다(서버가 없어 앱이 꺼져 있으면 못 보냅니다). ' +
      '원본 앱의 기기 알림과 다른 점입니다. 점수는 5분 갱신 파일이 새로 오면 확인합니다.</div>';
    h += '<div class="row" style="margin-top:10px"><button class="btn primary" type="button" data-perm>알림 허용하기</button>' +
      '<button class="btn" type="button" data-test>시험 알림</button></div>';
    h += '<div class="form-row" style="margin-top:10px"><label>NDX 임계 점수</label><input type="number" id="thNdx" value="' + set.thNdx + '" min="0" max="100">' +
      '<label>SOX 임계 점수</label><input type="number" id="thSox" value="' + set.thSox + '" min="0" max="100"></div>';
    h += '<div class="form-row"><label>조용한 시간</label><input type="time" id="qStart" value="' + hhmm(set.quietStart) + '">' +
      ' ~ <input type="time" id="qEnd" value="' + hhmm(set.quietEnd) + '"> <label style="min-width:auto"><input type="checkbox" id="qOn"' +
      (set.quietOn ? ' checked' : '') + '> 켬</label></div>';
    h += '<div class="row"><button class="btn" type="button" data-save>설정 저장</button></div>';
    h += '<div id="permNote" class="note"></div></section>';

    h += '<section class="panel"><div class="card-h"><h2>홈 화면에 추가 (아이폰·안드로이드)</h2></div>' +
      '<ol class="note" style="padding-left:18px;line-height:1.8">' +
      '<li>아이폰 사파리에서 이 사이트를 엽니다.</li>' +
      '<li>아래 공유 버튼(네모에서 화살표)을 누릅니다.</li>' +
      '<li>“홈 화면에 추가”를 고르고 이름을 확인합니다.</li>' +
      '<li>홈 화면 아이콘을 누르면 앱처럼 전체 화면으로 열립니다.</li>' +
      '<li>안드로이드 크롬은 오른쪽 위 ⋮ → “홈 화면에 추가”.</li></ol>' +
      '<div class="note">원본 앱의 홈 화면 위젯(점수 2개를 늘 보여 주는 것)은 웹에 없습니다. 대신 아래 PNG 카드를 저장해 두면 잠금 화면·바탕화면에 둘 수 있습니다.</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn" type="button" data-png>점수 카드 PNG 저장</button>' +
      '<a class="btn ghost" href="#/">홈으로</a></div></section>';
    view.innerHTML = h;

    var pn = view.querySelector('#permNote');
    view.querySelector('[data-perm]').addEventListener('click', function () {
      if (!w.Notification) { pn.textContent = '이 브라우저는 알림을 지원하지 않습니다.'; return; }
      Notification.requestPermission().then(function (r) { pn.textContent = '권한: ' + r; notifyView(view); });
    });
    view.querySelector('[data-test]').addEventListener('click', function () {
      if (!w.Notification || Notification.permission !== 'granted') { pn.textContent = '먼저 알림을 허용해 주세요.'; return; }
      var t = Data.scores.targets;
      new Notification('스톡 리밸런싱 · 시험 알림', {
        body: 'TQQQ ' + F.num(t.ndx.score) + '점 · SOXL ' + F.num(t.sox.score) + '점 (' + F.day(Data.asOf()) + ' 기준)'
      });
      pn.textContent = '시험 알림을 보냈습니다.';
    });
    view.querySelector('[data-save]').addEventListener('click', function () {
      set.thNdx = numOrNull(view.querySelector('#thNdx').value);
      set.thSox = numOrNull(view.querySelector('#thSox').value);
      set.quietOn = view.querySelector('#qOn').checked;
      set.quietStart = parseHhmm(view.querySelector('#qStart').value);
      set.quietEnd = parseHhmm(view.querySelector('#qEnd').value);
      S.set('notify', set);
      toast('알림 설정을 저장했습니다.');
      notifyView(view);
    });
    view.querySelector('[data-png]').addEventListener('click', function () { saveScoreCard(); });
  }

  function hhmm(min) {
    if (min == null) return '23:00';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(Math.floor(min / 60) % 24) + ':' + p(min % 60);
  }
  function parseHhmm(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? (+m[1]) * 60 + (+m[2]) : 0;
  }

  /* 점수 카드 PNG — 홈의 공유 카드와 같은 값(두 점수·판정·기준일). 원본 위젯의 웹 대체. */
  function saveScoreCard() {
    var t = Data.scores.targets, asOf = Data.asOf();
    var cv = document.createElement('canvas');
    var W = 900, H = 500;
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#1a1f2b'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e8ecf4';
    c.font = '700 30px -apple-system,"Apple SD Gothic Neo",sans-serif';
    c.fillText('스톡 리밸런싱', 40, 60);
    c.font = '400 20px -apple-system,sans-serif';
    c.fillStyle = '#949fb1';
    c.fillText('기준 ' + asOf + ' · 스톡 리밸런싱', 40, 92);
    [['ndx', 'TQQQ', 40], ['sox', 'SOXL', 480]].forEach(function (p) {
      var d = t[p[0]];
      c.fillStyle = '#252c3a';
      c.fillRect(p[2], 130, 400, 300);
      c.fillStyle = '#e8ecf4';
      c.font = '700 26px -apple-system,sans-serif';
      c.fillText(p[1], p[2] + 24, 180);
      c.fillStyle = '#3DD68C';
      c.font = '700 72px -apple-system,sans-serif';
      c.fillText(F.num(d.score), p[2] + 24, 270);
      c.fillStyle = '#b3bdcb';
      c.font = '400 18px -apple-system,sans-serif';
      c.fillText(d.verdict ? d.verdict.label : '', p[2] + 24, 310);
      c.fillStyle = '#949fb1';
      c.font = '400 16px -apple-system,sans-serif';
      c.fillText(d.verdict ? d.verdict.sub : '', p[2] + 24, 340);
    });
    cv.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'score-card-' + asOf + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast('점수 카드를 저장했습니다.');
    });
  }

  /* ------------------------------------------------------------ 설정·백업 */
  var BACKUP_MAGIC = 'stockrebal-backup';

  var SETTINGS_KEYS = [
    ['holdings', '보유 표'], ['journal', '매매일지'], ['verify', '검증 기록'], ['principles', '원칙'],
    ['settings', '리밸런싱 설정'], ['watch.us', '관심 종목(미국)'], ['watch.kr', '관심 종목(국내)'],
    ['notify', '알림 설정'], ['subscribers', '구독 신청'], ['mkt.maoff', '차트 이동평균선']
  ];

  function settingsView(view) {
    var h = '<div class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/tools">도구</a> / 설정·백업</div>' +
      '<h1>설정·백업</h1><p>원본 앱 청소부(SettingsScreen.kt·core/Backup.kt)의 웹 판입니다. 이 브라우저에 저장된 자료를 한 파일(JSON)로 내보내고 되돌립니다.</p></div>';

    var look = S.get('look', null) || { numColors: 'kr', contrast: 'normal', font: 'normal' };
    h += '<section class="panel"><div class="card-h"><h2>화면 설정</h2><span class="right"><span class="src">원본 SettingsScreen 의 화면 항목</span></span></div>';
    h += '<div class="form-row"><label>숫자 색</label><select id="lookNum">' +
      '<option value="kr"' + (look.numColors === 'kr' ? ' selected' : '') + '>국내식 — 상승 빨강 · 하락 파랑</option>' +
      '<option value="us"' + (look.numColors === 'us' ? ' selected' : '') + '>미국식 — 상승 초록 · 하락 빨강</option>' +
      '</select><span class="src">국내 화면은 늘 국내식, 이 설정은 미국 화면에 적용됩니다. 가격 숫자는 늘 연두색입니다.</span></div>';
    h += '<div class="form-row"><label>대비</label><select id="lookContrast">' +
      '<option value="normal"' + (look.contrast === 'normal' ? ' selected' : '') + '>보통</option>' +
      '<option value="high"' + (look.contrast === 'high' ? ' selected' : '') + '>높음</option></select></div>';
    h += '<div class="form-row"><label>글자 크기</label><select id="lookFont">' +
      '<option value="normal"' + (look.font === 'normal' ? ' selected' : '') + '>보통</option>' +
      '<option value="large"' + (look.font === 'large' ? ' selected' : '') + '>크게</option></select>' +
      '<span class="src">증시·일정·도구 화면에만 적용합니다(다른 화면의 색·글자는 그 화면 담당)</span></div>';
    h += '<div class="row"><button class="btn" type="button" data-look-save>화면 설정 저장</button></div></section>';

    h += '<section class="panel"><div class="card-h"><h2>저장된 자료</h2></div><table class="mkt"><tbody>';
    SETTINGS_KEYS.forEach(function (k) {
      var v = S.get(k[0], null);
      var n = Array.isArray(v) ? v.length + '건' : (v ? '있음' : '없음');
      h += '<tr><td class="nm">' + esc(k[1]) + ' <span class="src">' + esc(k[0]) + '</span></td><td>' + n + '</td></tr>';
    });
    h += '</tbody></table></section>';

    h += '<section class="panel"><div class="card-h"><h2>백업</h2></div>' +
      '<div class="note">담는 것 — 보유·관심 종목·매매일지·검증 기록·원칙·알림 설정. 담지 않는 것 — 시세 캐시·차트 설정(언제든 다시 받는 것).</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn primary" type="button" data-export>JSON 으로 내보내기</button></div>' +
      '<div class="form-row" style="margin-top:12px"><input type="file" id="bkFile" accept=".json"></div>' +
      '<div class="note" id="bkNote"></div></section>';

    h += '<section class="panel"><div class="card-h"><h2>되돌리기</h2></div>' +
      '<div class="note">이 브라우저의 저장 자료를 모두 지웁니다(되돌릴 수 없음).</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn danger" type="button" data-wipe>모두 지우기</button></div></section>';
    view.innerHTML = h;

    view.querySelector('[data-look-save]').addEventListener('click', function () {
      var v2 = {
        numColors: view.querySelector('#lookNum').value,
        contrast: view.querySelector('#lookContrast').value,
        font: view.querySelector('#lookFont').value
      };
      S.set('look', v2);
      applyLook(v2);
      toast('화면 설정을 저장했습니다.');
    });

    view.querySelector('[data-export]').addEventListener('click', function () {
      var body = { app: BACKUP_MAGIC, v: 1, at: new Date().toISOString(), data: {} };
      SETTINGS_KEYS.forEach(function (k) {
        var v = S.get(k[0], null);
        if (v != null) body.data[k[0]] = v;
      });
      var blob = new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'stockreb-backup-' + F.today() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast('백업 파일을 내보냈습니다.');
    });

    view.querySelector('#bkFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var note = view.querySelector('#bkNote');
        var js;
        try { js = JSON.parse(r.result); } catch (e) { note.className = 'note bad'; note.textContent = 'JSON 파일이 아닙니다.'; return; }
        if (!js || js.app !== BACKUP_MAGIC) { note.className = 'note bad'; note.textContent = '스톡 리밸런싱 백업 파일이 아닙니다.'; return; }
        var keys = Object.keys(js.data || {});
        if (!keys.length) { note.className = 'note bad'; note.textContent = '담긴 자료가 없습니다.'; return; }
        var summary = keys.map(function (k) {
          var v = js.data[k];
          return k + '(' + (Array.isArray(v) ? v.length + '건' : '값') + ')';
        }).join(' · ');
        confirmBox({ title: '백업을 복원할까요?', body: summary + ' — 지금 자료를 덮어씁니다.', ok: '복원' }, function () {
          keys.forEach(function (k) { S.set(k, js.data[k]); });
          note.className = 'note ok';
          note.textContent = '복원했습니다 — ' + summary;
          toast('복원했습니다.');
        });
      };
      r.readAsText(f);
    });

    view.querySelector('[data-wipe]').addEventListener('click', function () {
      confirmBox({ title: '저장 자료를 모두 지울까요?', body: '보유·일지·기록·설정이 지워집니다. 되돌릴 수 없습니다.', ok: '지운다' }, function () {
        SETTINGS_KEYS.forEach(function (k) { S.del(k[0]); });
        toast('지웠습니다.');
        settingsView(view);
      });
    });
  }

  /* 화면 설정 적용 — 새 화면(mkt-wrap) 안에서만. 색 팔레트 파일은 건드리지 않는다. */
  function applyLook(v) {
    try {
      var r = document.documentElement;
      r.setAttribute('data-mkt-contrast', v.contrast || 'normal');
      r.setAttribute('data-mkt-font', v.font || 'normal');
      r.setAttribute('data-mkt-num', v.numColors || 'kr');
    } catch (e) { /* 무시 */ }
  }
  var savedLook = S.get('look', null);
  if (savedLook) applyLook(savedLook);

  /* ------------------------------------------------------------ 자료 안내 */
  function dataView(view) {
    var s = Mkt.snap;
    var h = '<div class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/tools">도구</a> / 자료</div>' +
      '<h1>자료 안내</h1><p>화면의 숫자가 어디서 오는지, 언제 갱신되는지 적습니다.</p></div>';
    h += '<section class="panel"><div class="card-h"><h2>출처</h2></div>';
    h += '<table class="mkt"><tbody>';
    h += '<tr><td class="nm">점수·폭락 사례</td><td class="nm">data/scores.json · data/crashes.json — 원본 앱 v2.7.0 자산에서 만든 값</td></tr>';
    h += '<tr><td class="nm">증시 스냅샷</td><td class="nm">data/market.json — ' + esc(s ? (s.sources || []).join(' · ') : '없음') + '</td></tr>';
    h += '<tr><td class="nm">봉(캔들)</td><td class="nm">data/candles.json — 나스닥·네이버 일봉</td></tr>';
    h += '<tr><td class="nm">일정</td><td class="nm">data/calendar.json — 나스닥 경제지표·실적 캘린더 + 앱 내장 손글 일정</td></tr>';
    h += '<tr><td class="nm">5분 갱신</td><td class="nm">data/live.json — ' + esc(Mkt.liveText()) + '</td></tr>';
    h += '</tbody></table>';
    h += '<div class="note">스냅샷은 만든 시각 ' + esc(s ? Mkt.time(s.generatedAt) : '—') + ' 기준입니다. 값이 없는 칸은 —로 두고 지어내지 않습니다.</div></section>';
    h += '<section class="panel"><div class="card-h"><h2>다시 만들기</h2></div>' +
      '<pre class="json">python3 tools/make_market_snapshot.py   # market.json + candles.json\npython3 tools/make_calendar.py         # calendar.json</pre>' +
      '<div class="note">5분 갱신은 GitHub Actions(data/live.json)가 맡습니다. 실패하면 이전 파일을 그대로 둡니다.</div></section>';
    view.innerHTML = h;
  }

  /* ------------------------------------------------------------ 라우터 */
  V.tools = function (view, parts) {
    var k = parts && parts[1];
    if (!Mkt.ready) {
      view.innerHTML = '<div class="loading">자료를 불러오는 중…</div>';
      Mkt.load().then(function () { V.tools(view, parts); }).catch(function () {
        if (k === 'tax' || k === 'data') taxOrData(view, k);
        else index(view);
      });
      return;
    }
    if (k === 'tax') return tax(view);
    if (k === 'import') return importView(view);
    if (k === 'notify') return notifyView(view);
    if (k === 'settings') return settingsView(view);
    if (k === 'data') return dataView(view);
    return index(view);
  };

  function taxOrData(view, k) { return k === 'tax' ? tax(view) : dataView(view); }

  /* 시험용 손잡이 — 원본 시험(BrokerFileTest)의 기대값을 웹에서 같은 입력으로 대조한다. */
  w.ToolsTest = { taxOf: taxOf, mapTable: mapTable, csvRows: csvRows, decodeText: decodeText,
    readXlsx: readXlsx, computeTax: computeTax, state: state };
})(window);
