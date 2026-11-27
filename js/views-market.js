/* 증시 탭 — 원본 MarketScreen.kt 의 계층을 그대로 옮긴다.
     증시 홈(지수 · 관심 종목 · 마켓맵 · 순위)
       → 캔들 차트(지수 칸) : 일·주·월·연봉 + 이동평균선
       → 섹터(마켓맵 칸) : 그 섹터의 업종 목록
       → 업종 : 그 업종의 종목 목록(거래대금/상승/하락/시총 정렬)
       → 종목 상세 : 캔들 차트·현재가·밸류에이션·기술적 지표·목표가·성과
     국내·미국 모두 같은 구조. 고정 상단 줄(시장 전환 + 정규장/프리마켓)은 스크롤 밖에 붙인다.
   자료를 받지 못하면 실패를 표시하고 이전 값을 지우지 않는다. 값을 지어내지 않는다. */
(function (w) {
  'use strict';

  var V = w.Views = w.Views || {};

  var st = {
    market: 'us', basis: 'regular', mapScope: 'all',
    sort: 'cap', sortDir: 'desc',
    maOff: localStorage.getItem('stockrebal.mkt.maoff') || '',
    timer: null, lastLive: 0, query: '', hits: [], probe: null, note: ''
  };

  var SORTS = { value: '거래대금', gain: '상승', loss: '하락', cap: '시총' };

  function num(v) { return (v == null || isNaN(v)) ? '—' : v; }

  function px(v, cur, cls) {
    var t = (v == null) ? '—' : Mkt.cur(v, cur);
    return '<span class="px ' + (cls || '') + '">' + t + '</span>';
  }
  function chg(v, market) {
    var cls = Mkt.tone(v, market);
    var arrow = (v == null || v === 0) ? '' : (v > 0 ? '▲ ' : '▼ ');
    return '<span class="' + cls + '">' + arrow + Mkt.pct(v) + '</span>';
  }

  /* ------------------------------------------------------------ 관심 하트
     원본 앱은 종목 상세 오른쪽 위의 별표 하나로 관심목록을 담고 뺐다(채워진 별 = 담김, 빈 별 = 안 담김,
     담긴 별은 악센트색, 나머지는 보조 글자색). 웹은 무아 님이 찾은 '하트' 모양으로 그 자리를 옮기고,
     목록 줄 오른쪽 끝에도 같은 버튼을 둔다. 모양만 SVG 로 새로 그린다(앱 자산을 쓰지 않는다).
     색은 기존 변수만 쓴다 — 담김은 --amber(금색). 등락 빨강·파랑·가격 연두와 겹치지 않는 색이다. */
  var HEART_PATH = 'M12 20.7 10.7 19.5C5.6 14.9 2.2 11.8 2.2 8.1 2.2 5.1 4.6 2.7 7.5 2.7c1.7 0 3.3.8 4.5 2.1 1.2-1.3 2.8-2.1 4.5-2.1 2.9 0 5.3 2.4 5.3 5.4 0 3.7-3.4 6.8-8.5 11.4z';

  function heartBtn(sym, name, withLabel) {
    var market = Mkt.marketOf(sym) || st.market;
    var on = Mkt.inWatch(market, sym);
    var lbl = on ? '관심 종목에서 빼기' : '관심 종목에 담기';
    return '<button class="heart' + (on ? ' on' : '') + (withLabel ? ' heartbtn' : '') + '" type="button"' +
      ' data-heart="' + esc(sym) + '" data-hn="' + esc(name || sym) + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + lbl + '" title="' + lbl + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path class="ho" d="' + HEART_PATH + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<path class="hf" d="' + HEART_PATH + '" fill="currentColor"/>' +
      '</svg>' + (withLabel ? '<span class="hlbl">' + (on ? '관심 빼기' : '관심 담기') + '</span>' : '') +
      '</button>';
  }

  function paintHearts(view, sym) {
    var market = Mkt.marketOf(sym) || st.market;
    var on = Mkt.inWatch(market, sym);
    var lbl = on ? '관심 종목에서 빼기' : '관심 종목에 담기';
    view.querySelectorAll('[data-heart]').forEach(function (b) {
      if (String(b.getAttribute('data-heart')).toUpperCase() !== String(sym).toUpperCase()) return;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', lbl);
      b.setAttribute('title', lbl);
      var t = b.querySelector('.hlbl');
      if (t) t.textContent = on ? '관심 빼기' : '관심 담기';
    });
  }

  function toggleHeart(btn, view) {
    var sym = btn.getAttribute('data-heart');
    var name = btn.getAttribute('data-hn') || sym;
    var market = Mkt.marketOf(sym) || st.market;
    var on = Mkt.inWatch(market, sym);
    if (on) {
      Mkt.removeWatch(market, sym);
      toast(name + ' 관심 목록에서 뺐습니다');
    } else if (Mkt.addWatch(market, sym, name)) {
      toast(name + ' 관심 목록에 담았습니다');
    } else {
      toast('이미 관심 목록에 있습니다');
    }
    paintHearts(view, sym);
    // 증시 홈은 관심 종목 표·개수가 같은 목록을 보여 준다 — 새로고침 없이 그 표만 다시 그린다.
    if (!location.hash.replace(/^#/, '').split('/').filter(Boolean)[1]) {
      var y = w.pageYOffset || 0;
      var hadFocus = document.activeElement === btn;
      home(view);
      w.scrollTo(0, y);
      if (hadFocus) {
        // 다시 그린 뒤에도 키보드 초점이 그 하트에 남게 한다.
        var again = null;
        view.querySelectorAll('[data-heart]').forEach(function (b) {
          if (!again && String(b.getAttribute('data-heart')).toUpperCase() === String(sym).toUpperCase()) again = b;
        });
        if (again) again.focus({ preventScroll: true });
      }
    }
  }

  function bindHearts(view) {
    view.querySelectorAll('[data-heart]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleHeart(b, view);
      });
    });
  }

  function stopTimer() {
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
  }

  function marketLabel(m) { return m === 'kr' ? '국내' : '미국'; }

  /* ------------------------------------------------------------ 기준(정규장/프리마켓)
     홈·매수 지표와 **같은 한 곳**(전역 Basis: 'close'|'live')을 쓴다.
     예전 이 화면만 쓰던 market.basis 는 읽기만 하고, 처음 한 번 Basis 로 옮긴 뒤 지운다. */
  var basisMoved = false;
  function basisKey() {
    if (w.Basis && Basis.get) return Basis.get() === 'live' ? 'after' : 'regular';
    // Basis 가 없는 옛 캐시에서도 화면이 깨지지 않게
    return S.get('market.basis', 'regular') === 'after' ? 'after' : 'regular';
  }
  function setBasis(k) {
    var live = k === 'after' || k === 'live';
    if (w.Basis && Basis.set) { Basis.set(live ? 'live' : 'close'); return; }
    S.set('market.basis', live ? 'after' : 'regular');
  }
  function moveLegacyBasis() {
    if (basisMoved) return;
    basisMoved = true;
    if (!w.Basis || !Basis.set) return;
    var old = S.get('market.basis', null);
    if (old === null) return;
    var hasNew = false;
    try { hasNew = w.localStorage.getItem('stockrebal.basis') !== null; } catch (e) {}
    if (!hasNew) Basis.set(old === 'after' ? 'live' : 'close');
    S.del('market.basis');   // 더 이상 쓰지 않는다(한 번 옮긴 뒤)
  }

  /* ------------------------------------------------------------ 공통 머리 */
  function topBar(home) {
    var defs = st.market === 'kr'
      ? '[정규장] = 정규장(09:00~15:30 KST) 값. 정규장 밖에는 직전 종가.\n[프리마켓] = 정규장 밖 모든 세션(장전 시간외·시간외 단일가)의 최근 체결.'
      : '[정규장] = 정규장(09:30~16:00 ET) 값. 정규장 밖에는 직전 종가.\n[프리마켓] = 정규장 밖 모든 세션(프리·애프터·데이마켓)의 최근 체결.';
    var h = '<div class="mkt-top">';
    h += '<div class="mkt-tabs">';
    if (home) {
      h += '<button class="tab' + (st.market === 'us' ? ' on' : '') + '" data-mkt="us" type="button">미국</button>';
      h += '<button class="tab' + (st.market === 'kr' ? ' on' : '') + '" data-mkt="kr" type="button">국내</button>';
    }
    h += '</div>';
    h += '<div class="mkt-tabs mini" style="margin-top:6px">';
    h += '<button class="tab' + (st.basis === 'regular' ? ' on' : '') + '" data-basis="close" type="button" aria-pressed="' +
      (st.basis === 'regular') + '">정규장</button>';
    h += '<button class="tab' + (st.basis === 'after' ? ' on' : '') + '" data-basis="live" type="button" aria-pressed="' +
      (st.basis === 'after') + '">프리마켓</button>';
    h += '<span class="src" style="margin-left:auto">' + esc(Mkt.liveText()) + '</span>';
    h += '</div>';
    h += '<div class="basis-line">보는 값 — ' + (st.basis === 'after'
      ? '프리마켓(실시간 추정) · 홈·매수 지표와 같은 기준'
      : '정규장(확정 종가) · 홈·매수 지표와 같은 기준') + '</div>';
    h += '<div class="defs">' + esc(defs) + '</div>';
    h += '</div>';
    return h;
  }

  function statusLine() {
    var s = Mkt.snap;
    if (!s) return '';
    var ses = Mkt.sessionOf(st.market);
    var txt = '자료 ' + F.day((s.asOf || '').slice(0, 10)) + ' · ' + (s.delayNote || '') +
      ' · 세션 ' + (ses.label || '—');
    if (Mkt.liveErr) txt += ' · 5분 갱신 실패(' + Mkt.liveErr.slice(0, 30) + ')';
    return '<div class="note" style="margin:0">' + esc(txt) + '</div>';
  }

  /* ------------------------------------------------------------ 홈 */
  function home(view) {
    var market = st.market, basis = st.basis;
    var idx = Mkt.indices(market, basis);
    var rows = Mkt.rows(market, basis);
    var watch = Mkt.watch(market);

    var h = topBar(true);
    h += statusLine();

    /* ① 지수 */
    h += '<section class="panel"><div class="card-h"><h2>주요 지수</h2>' +
      '<span class="right"><span class="daytag">' + (basis === 'after' ? '프리마켓' : '정규장') + '</span></span></div>';
    if (!idx.length) {
      h += '<div class="empty">지수 자료를 받지 못했습니다.</div>';
    } else {
      h += '<div class="idx-grid">';
      idx.forEach(function (x) {
        h += '<button class="idx-cell" type="button" data-candles="' + esc(x.sym) + '">' +
          '<div class="n">' + esc(x.name) + (x.proxy ? ' <span class="src">' + esc(x.proxy) + '</span>' : '') + '</div>' +
          '<div class="p">' + px(x.price, market === 'kr' ? 'KRW' : 'USD') + '</div>' +
          '<div class="c">' + chg(x.chg, market) + '</div>' +
          '<canvas class="spark" data-spark="' + esc(x.sym) + '" aria-hidden="true"></canvas>' +
          '<div class="f">' + esc(x.note || '') + (x.at ? ' · ' + Mkt.time(x.at) : '') + '</div>' +
          '</button>';
      });
      h += '</div>';
    }
    h += '<div class="note">' + (market === 'kr'
      ? '국내 지수는 코스피·코스닥입니다(네이버·트레이딩뷰 지연 시세).'
      : '미국 지수 칸은 알파카·야후에 지수가 없어 ETF 대체값(QQQ·SPY·DIA·IWM·SOXX)입니다.') + '</div>';
    h += '</section>';

    /* ② 관심 종목 */
    h += '<section class="panel"><div class="card-h"><h2>관심 종목</h2>' +
      '<span class="right"><span class="src">' + watch.length + '개 · 저장됨</span></span></div>';
    h += '<div class="wadd"><input id="wq" type="text" inputmode="search" autocomplete="off" ' +
      'placeholder="티커 또는 이름 (예: ' + (market === 'kr' ? '005930, 삼성전자' : 'AAPL, 엔비디아') + ')" value="' + esc(st.query) + '">' +
      '<div class="ac" id="wac" hidden></div></div>';
    if (st.note) h += '<div class="note ' + (st.probe && st.probe.ok ? 'ok' : 'warn') + '">' + esc(st.note) + '</div>';

    if (!watch.length) {
      h += '<div class="empty" style="padding:18px 0">아직 담은 종목이 없습니다. 위 칸에 티커를 넣으면 자동으로 시세가 붙습니다.</div>';
    } else {
      var wrows = watch.map(function (it) {
        var q = Mkt.quote(it.sym);
        var lk = Mkt.look(it.sym, basis);
        return { it: it, q: q, lk: lk };
      });
      h += '<div class="tbl-wrap" style="margin-top:8px"><table class="mkt fixed"><thead><tr>' +
        '<th class="nm c-name">종목</th><th class="c-price">가격</th><th class="c-chg">등락</th>' +
        '<th class="c-cap">시가총액</th><th class="c-vol">거래량</th>' +
        '<th class="hcell act c-heart" scope="col">관심</th></tr></thead><tbody>';
      wrows.forEach(function (r, i) {
        var sym = r.it.sym, cur = r.q ? r.q.cur : (market === 'kr' ? 'KRW' : 'USD');
        var price = r.lk ? r.lk.price : null;
        var c = r.lk ? r.lk.chg : null;
        h += '<tr class="row" data-stock="' + esc(sym) + '">' +
          '<td class="nm c-name"><span class="sym">' + esc(sym) + '</span><span class="desc">' + esc((r.q && (r.q.name || r.q.desc)) || r.it.name || '') + '</span></td>' +
          '<td class="c-price">' + px(price, cur) + '</td>' +
          '<td class="c-chg">' + chg(c, market) + '</td>' +
          '<td class="c-cap">' + (r.q ? Mkt.capShort(r.q.mcap, cur) : '—') + '</td>' +
          '<td class="vol c-vol">' + (r.lk ? Mkt.vol(r.lk.vol) : '—') + '</td>' +
          '<td class="hcell act c-heart" style="white-space:nowrap">' +
            '<button class="x" type="button" data-up="' + esc(sym) + '" title="위로" aria-label="' + esc(sym) + ' 위로">▲</button>' +
            '<button class="x" type="button" data-down="' + esc(sym) + '" title="아래로" aria-label="' + esc(sym) + ' 아래로">▼</button>' +
            heartBtn(sym, (r.q && r.q.name) || r.it.name || sym) +
          '</td></tr>';
        if (r.lk && r.lk.note && r.lk.session !== 'regular') {
          h += '<tr><td colspan="6" class="note" style="border:none;padding:0 6px 6px">' +
            esc(r.lk.note) + (r.lk.at ? ' · ' + Mkt.time(r.lk.at) : '') + '</td></tr>';
        }
      });
      h += '</tbody></table></div>';
    }
    h += '<div class="note">가격은 ' + (basis === 'after' ? '프리마켓 기준(장외 체결이 없으면 —)' : '정규장 기준') +
      '입니다. 값마다 출처와 시각을 함께 적습니다 — ' + esc(Mkt.liveText()) + '</div>';
    h += '</section>';

    /* ③ 마켓맵 */
    h += '<section class="panel"><div class="card-h"><h2>마켓맵</h2><span class="right">' +
      '<span class="daytag">' + (basis === 'after' ? '프리마켓' : '정규장') + '</span></span></div>';
    h += '<div class="seg-row" role="group" aria-label="마켓맵 보기" style="margin-top:8px">';
    // 국내에는 QQQ·SPY·DIA 구성종목이 없다. 반도체 보기는 그 시장 자료에 반도체 종목이 있을 때만 연다.
    var hasSemi = Mkt.rows(market, basis).some(function (r) { return r.industry === 'Semiconductors'; });
    [['all', '전체'], ['QQQ', 'QQQ'], ['SPY', 'SPY'], ['DIA', 'DIA'], ['SOX', '반도체'], ['SECTOR', '섹터·업종']].forEach(function (o) {
      if (market === 'kr' && o[0] !== 'all' && o[0] !== 'SECTOR' && o[0] !== 'SOX') return;
      if (o[0] === 'SOX' && !hasSemi) return;
      h += '<button class="seg' + (st.mapScope === o[0] ? ' on' : '') + '" data-scope="' + o[0] + '" type="button" aria-pressed="' +
        (st.mapScope === o[0]) + '">' + o[1] + '</button>';
    });
    h += '</div>';

    var cells = [];
    if (st.mapScope === 'SECTOR') {
      cells = Mkt.sectorCells(market, basis);
      h += '<div class="tbl-wrap" style="margin-top:8px"><table class="mkt"><thead><tr>' +
        '<th class="nm">섹터</th><th>등락(시총가중)</th><th>종목</th><th>시가총액</th></tr></thead><tbody>';
      cells.forEach(function (c) {
        h += '<tr class="row" data-sector="' + esc(c.sectorEn) + '">' +
          '<td class="nm"><span class="sym">' + esc(c.name) + '</span><span class="desc">' + esc(c.sectorEn) + '</span></td>' +
          '<td>' + chg(c.chg, market) + '</td><td class="vol">' + c.count + '</td>' +
          '<td>' + Mkt.cap(c.mcap, market === 'kr' ? 'KRW' : 'USD', Mkt.fx()) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="note">섹터를 누르면 업종 목록, 업종을 누르면 종목 목록이 열립니다. 칸 넓이는 섹터 합산 시가총액, 등락은 시총 가중 평균입니다.</div>';
    } else {
      cells = mapCells(market, basis, st.mapScope);
      var stockMap = st.mapScope === 'SOX';
      h += '<div class="note" style="margin:6px 0 6px">' + esc(mapNote(cells.length)) + '</div>';
      h += '<div class="map-box" id="mapbox"><canvas aria-label="' + (stockMap
        ? '반도체 마켓맵 — 칸을 누르면 그 종목 상세가 열립니다'
        : '마켓맵 — 칸을 누르면 그 섹터의 업종이 열립니다') + '"></canvas></div>';
      h += '<div class="map-legend"><span>−3%</span><span style="width:14px;height:8px;background:' + Treemap.colorOf(-3) + '"></span>' +
        '<span style="width:14px;height:8px;background:' + Treemap.colorOf(-1) + '"></span>' +
        '<span style="width:14px;height:8px;background:' + Treemap.colorOf(0) + '"></span>' +
        '<span style="width:14px;height:8px;background:' + Treemap.colorOf(1) + '"></span>' +
        '<span style="width:14px;height:8px;background:' + Treemap.colorOf(3) + '"></span><span>+3%</span></div>';
      h += '<div class="note">' + (stockMap
        ? '칸 하나가 종목 하나입니다. 넓이는 종목 시가총액, 색은 등락률(±3%)이고, 칸을 누르면 그 종목 상세가 열립니다.'
        : '칸 넓이는 섹터 합산 시가총액, 색은 등락률(±3%)입니다. 글자·숫자를 함께 적어 색만으로 읽지 않게 했습니다.') + '</div>';
    }
    h += '</section>';

    /* ④ 순위 */
    var ranks = rankRows(rows, market);
    h += '<section class="panel"><div class="card-h"><h2>순위</h2><span class="right">' +
      '<span class="seg-row" role="group" aria-label="순위 기준">';
    ['value', 'gain', 'loss', 'cap'].forEach(function (k) {
      h += '<button class="seg' + (st.sort === k ? ' on' : '') + '" data-sort="' + k + '" type="button" aria-pressed="' +
        (st.sort === k) + '">' + SORTS[k] + '</button>';
    });
    h += '</span></span></div>' + table(ranks, market, true) +
      '<div class="note">' + SORTS[st.sort] + ' 순 상위 30종목. 왼쪽 숫자가 등수이고, 행을 누르면 종목 상세가 열립니다.</div></section>';

    h += '<div class="note">값의 출처 — ' + esc((Mkt.snap && (Mkt.snap.sources || []).join(' · ')) || '') +
      '. 모두 공개 시세를 웹이 직접 받은 참고 자료이며 투자 권유가 아닙니다.</div>';
    h += '<div class="pill-row" style="margin-top:10px"><a class="chip" href="#/calendar">일정 보기</a>' +
      '<a class="chip" href="#/tools">도구</a></div>';
    h += '</div>';

    view.innerHTML = h;
    bindTop(view, true);
    bindWatch(view);
    bindHomeRows(view);
    bindHearts(view);
    if (st.mapScope !== 'SECTOR') {
      var box = view.querySelector('#mapbox');
      if (box) {
        // 칸 폭은 그리기 직후에 정해진다. 한 번 더 그리고, 크기가 바뀌면 다시 그린다(찌그러짐 방지).
        requestAnimationFrame(function () { if (document.body.contains(box)) Treemap.draw(box, cells, pick); });
        if (w.ResizeObserver) {
          if (box.__ro) box.__ro.disconnect();
          box.__ro = new ResizeObserver(function () { Treemap.draw(box, cells, pick); });
          box.__ro.observe(box);
        }
      }
      var pick = function (key, data) {
        if (st.mapScope === 'SOX') {
          // 칸 하나가 종목 하나 — 업종 화면이 아니라 그 종목 상세로 간다.
          var sym = (data && data.sym) || key;
          if (Mkt.quote(sym)) openStock(sym);
          return;
        }
        openSector(data && data.sectorEn ? data.sectorEn : key);
      };
      if (box) Treemap.draw(box, cells, pick);
    }
    requestAnimationFrame(function () { if (document.body.contains(view)) drawSparks(view, market, basis); });
    startPoll(view);
  }

  /* ------------------------------------------------------------ 지수 미니 차트
     data/candles.json 의 최근 22봉 종가(약 한 달)를 한 줄로 그린다. 봉 자료는 이 파일 하나를
     한 번만 받아 캐시한다(Mkt.loadCandles · Candles.loadFor). 봉이 없으면 선 없이 숫자만 남긴다.
     색은 그 화면의 등락 색 규칙(국내 상승 빨강·하락 파랑 / 미국 상승 초록·하락 빨강)을 그대로 쓴다. */
  var SPARK_N = 22;

  function toneColor(tone) {
    var el = document.createElement('span');
    el.className = tone || 'flat';
    el.style.cssText = 'position:absolute;left:-9999px;top:0';
    document.body.appendChild(el);
    var c = getComputedStyle(el).color;
    document.body.removeChild(el);
    return c;
  }

  function drawSparks(view, market, basis) {
    var list = view.querySelectorAll('canvas.spark');
    if (!list.length || !w.Candles || !Candles.loadFor) return;
    list.forEach(function (cv) {
      var sym = cv.getAttribute('data-spark');
      Candles.loadFor(sym).then(function (bars) {
        if (!document.body.contains(cv)) return;
        paintSpark(cv, sym, bars || [], market, basis);
      }).catch(function () { /* 숫자는 그대로 둔다 */ });
    });
  }

  /* 선 색 — 바로 위에 적힌 등락 숫자와 **같은 색**을 쓴다(셀의 등락 칸에서 읽는다).
     숫자는 올랐는데 선만 빨강이면 읽기 헷갈리기 때문. */
  function lineColor(cv, market, closes) {
    var cell = cv.parentNode;
    var cEl = cell ? cell.querySelector('.c span') : null;
    if (cEl) {
      var c = getComputedStyle(cEl).color;
      if (c) return c;
    }
    return toneColor(Mkt.tone(closes[closes.length - 1] - closes[0], market));
  }

  function paintSpark(cv, sym, bars, market, basis) {
    var closes = [];
    (bars || []).slice(-SPARK_N).forEach(function (b) {
      var v = b && b[4] != null ? Number(b[4]) : null;
      if (v != null && !isNaN(v)) closes.push(v);
    });
    var lk = Mkt.look(sym, basis);
    var liveDot = false;
    if (basis === 'after' && lk && lk.price != null && (lk.session === 'pre' || lk.session === 'post')) {
      closes.push(Number(lk.price));      // 프리마켓이면 마지막 점을 실시간 값으로 잇는다
      liveDot = true;
    }
    var W = cv.clientWidth || (cv.parentNode && cv.parentNode.clientWidth) || 140, H = 34;
    var dpr = Math.min(2, w.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (closes.length < 2 || W < 20) {   // 봉이 없으면 선 없이 숫자만 — 빈 칸도 남기지 않는다
      cv.style.display = 'none';
      return;
    }
    cv.style.display = 'block';

    var lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
    if (hi <= lo) hi = lo + 1;
    var padT = 3, padB = 4, gh = H - padT - padB;
    var xf = function (i) { return (i / (closes.length - 1)) * (W - 3) + 1.5; };
    var yf = function (v) { return padT + (hi - v) / (hi - lo) * gh; };

    // 기준선 — 기간 첫 종가(얇은 점선)
    ctx.strokeStyle = 'rgba(255,255,255,.20)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, yf(closes[0])); ctx.lineTo(W, yf(closes[0])); ctx.stroke();
    ctx.setLineDash([]);

    var col = lineColor(cv, market, closes);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    closes.forEach(function (v, i) {
      var px2 = xf(i), py = yf(v);
      if (i === 0) ctx.moveTo(px2, py); else ctx.lineTo(px2, py);
    });
    ctx.stroke();

    if (liveDot) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(xf(closes.length - 1), yf(closes[closes.length - 1]), 2.3, 0, Math.PI * 2); ctx.fill();
      var cell = cv.parentNode, f = cell ? cell.querySelector('.f') : null;
      if (f && f.textContent.indexOf('● 실시간') < 0) {
        f.textContent = '● 실시간 · ' + f.textContent;   // 선의 마지막 점은 실시간 값
        f.setAttribute('title', '선의 마지막 점은 실시간(장외) 값입니다');
      }
    }
  }

  function mapCells(market, basis, scope) {
    var rows = Mkt.rows(market, basis);
    if (scope === 'all') return Mkt.sectorCells(market, basis).map(function (c) {
      return c;
    });
    if (scope === 'SOX') {
      // 한 칸 = 한 종목. 업종 이름으로 다시 묶으면 칸이 하나가 되어 아무것도 안 보인다.
      return rows.filter(function (r) { return r.industry === 'Semiconductors' && (r.mcap || 0) > 0; })
        .sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); })
        .map(function (r) {
          var desc = shortCo(r.desc || r.name || '');
          return {
            sym: r.sym, name: r.sym, desc: desc, kind: 'stock',
            sectorEn: r.sector, industryEn: r.industry,
            mcap: r.mcap, chg: r.chg, count: 1,
            lines: [r.sym, desc, chgShort(r.chg), Mkt.capShort(r.mcap, r.cur)].filter(function (t) { return !!t; })
          };
        });
    }
    // QQQ/SPY/DIA — 구성종목 자료가 없으므로, 그 ETF 가 담는 대표 종목을 시총 상위로 대신한다(그 사실을 적는다).
    return Mkt.sectorCells(market, basis);
  }

  /* 칸에 함께 적을 값 — 티커 아래 줄(회사 이름·등락률·시가총액)에 쓴다. */
  function shortCo(s) {
    return String(s || '').replace(/[\s,]*\b(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?,?\s*Ltd\.?|Ltd\.?|plc|PLC|Limited|Holdings?|Group|N\.V\.|S\.A\.|SE|AG)\s*$/i, '').trim();
  }
  function chgShort(v) {
    if (v == null || isNaN(v)) return '—';
    return (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  }

  function mapNote(n) {
    var basis = st.basis === 'after' ? '프리마켓' : '정규장';
    if (st.mapScope === 'SECTOR') return '섹터 목록';
    if (st.mapScope === 'SOX') return '반도체 ' + (n || 0) + '종목 · 시가총액 기준 · ' + basis + ' 등락률';
    if (st.mapScope === 'all') return '시가총액 상위 종목을 섹터로 묶었습니다 · ' + basis + ' 등락률';
    return st.mapScope + ' 구성종목 자료는 무료 공개 소스에 없어, 시가총액 상위 섹터로 대신 보여 줍니다.';
  }

  function rankRows(rows, market) {
    var key = st.sort === 'gain' ? 'gain' : (st.sort === 'loss' ? 'loss' : (st.sort === 'value' ? 'value' : 'cap'));
    var list = rows.filter(function (r) { return r.chg != null; });
    if (key === 'gain') list = list.sort(function (a, b) { return b.chg - a.chg; });
    else if (key === 'loss') list = list.sort(function (a, b) { return a.chg - b.chg; });
    else if (key === 'value') list = list.sort(function (a, b) { return (b.val || 0) - (a.val || 0); });
    else list = list.sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); });
    return list.slice(0, 30);
  }

  function table(rows, market, numbered) {
    var h = '<div class="tbl-wrap"><table class="mkt fixed"><thead><tr>' +
      '<th class="nm c-name">종목</th><th class="c-price">가격</th><th class="c-chg">등락</th>' +
      '<th class="c-val">거래대금</th><th class="c-cap">시가총액</th>' +
      '<th class="hcell c-heart" scope="col">관심</th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      h += '<tr class="row" data-stock="' + esc(r.sym) + '">' +
        '<td class="nm c-name">' + (numbered ? '<span class="rk" aria-label="' + (i + 1) + '등">' + (i + 1) + '</span>' : '') +
          '<span class="sym">' + esc(r.sym) + '</span><span class="desc">' + esc(r.name || r.desc || '') + '</span></td>' +
        '<td class="c-price">' + px(r.price, r.cur) + '</td>' +
        '<td class="c-chg">' + chg(r.chg, market) + '</td>' +
        '<td class="vol c-val">' + Mkt.money(r.val, r.cur) + '</td>' +
        '<td class="c-cap">' + Mkt.capShort(r.mcap, r.cur) + '</td>' +
        '<td class="hcell c-heart">' + heartBtn(r.sym, r.name || r.desc || r.sym) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  /* ------------------------------------------------------------ 상단 줄·관심 종목 이벤트 */
  function bindTop(view, showTabs) {
    view.querySelectorAll('[data-mkt]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-mkt');
        if (m === st.market) return;
        st.market = m; st.mapScope = 'all'; st.sort = 'cap'; st.query = ''; st.note = ''; st.hits = [];
        S.set('market.tab', m);
        location.hash = '#/market';
        home(view);
      });
    });
    view.querySelectorAll('[data-basis]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-basis');            // close | live — 홈·매수 지표와 같은 값
        var want = k === 'live' ? 'after' : 'regular';
        if (want === st.basis) return;
        st.basis = want;
        setBasis(k);
        refresh(view);
      });
    });
    view.querySelectorAll('[data-scope]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.mapScope = b.getAttribute('data-scope');
        home(view);
      });
    });
    view.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.sort = b.getAttribute('data-sort');
        S.set('market.sort', st.sort);   // market.tab·market.basis 와 같은 S 저장 방식
        home(view);
      });
    });
  }

  function bindWatch(view) {
    var input = view.querySelector('#wq');
    var ac = view.querySelector('#wac');
    if (!input || !ac) return;

    function showHits() {
      var q = input.value.trim();
      st.query = q;
      if (!q) { ac.hidden = true; ac.innerHTML = ''; return; }
      var hits = Mkt.search(q, st.market, 8);
      st.hits = hits;
      if (hits.length) {
        ac.innerHTML = hits.map(function (x) {
          return '<button type="button" data-pick="' + esc(x.sym) + '">' +
            '<span class="t">' + esc(x.sym) + '</span><span>' + esc(x.name || '') + '</span>' +
            '<span class="m">' + esc(x.exch || marketLabel(x.market)) + '</span></button>';
        }).join('');
      } else {
        ac.innerHTML = '<button type="button" data-probe="1"><span>“' + esc(q) + '” 그대로 조회</span>' +
          '<span class="m">목록에 없음</span></button>';
      }
      ac.hidden = false;
    }

    input.addEventListener('input', showHits);
    input.addEventListener('focus', function () { if (input.value.trim()) showHits(); });
    ac.addEventListener('click', function (e) {
      var pick = e.target.closest('[data-pick]');
      var probe = e.target.closest('[data-probe]');
      if (pick) {
        addTicker(pick.getAttribute('data-pick'), view);
        return;
      }
      if (probe) {
        var q = input.value.trim();
        st.note = '“' + q + '”를 공개 소스에서 조회하는 중…';
        ac.hidden = true;
        refresh(view);
        Mkt.probe(q).then(function (r) {
          if (r.ok) {
            Mkt.addWatch(st.market, r.quote.sym, r.quote.name);
            st.note = r.quote.sym + ' 추가 — ' + (r.via === 'direct' ? '공개 소스에서 직접 받은 값' : '저장된 값') + '입니다.';
          } else {
            st.note = '“' + q + '” — ' + r.reason + '. 값을 지어내지 않습니다. 티커를 확인해 주세요.';
          }
          st.probe = r;
          st.query = '';
          refresh(view);
        });
      }
    });

    view.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        Mkt.removeWatch(st.market, b.getAttribute('data-del'));
        home(view);
      });
    });
    view.querySelectorAll('[data-up]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        Mkt.moveWatch(st.market, b.getAttribute('data-up'), -1);
        home(view);
      });
    });
    view.querySelectorAll('[data-down]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        Mkt.moveWatch(st.market, b.getAttribute('data-down'), 1);
        home(view);
      });
    });
  }

  function addTicker(sym, view) {
    var q = Mkt.quote(sym);
    Mkt.addWatch(st.market, sym, q ? q.name : sym);
    st.query = ''; st.note = sym + '을(를) 관심 종목에 담았습니다.';
    home(view);
    var el = document.getElementById('view');
    if (el) el.scrollIntoView({ block: 'start' });
  }

  function bindHomeRows(view) {
    view.querySelectorAll('[data-candles]').forEach(function (b) {
      b.addEventListener('click', function () {
        location.hash = '#/market/candles/' + encodeURIComponent(b.getAttribute('data-candles'));
      });
    });
    view.querySelectorAll('[data-sector]').forEach(function (b) {
      b.addEventListener('click', function () {
        location.hash = '#/market/sector/' + encodeURIComponent(b.getAttribute('data-sector'));
      });
    });
    view.querySelectorAll('[data-stock]').forEach(function (b) {
      b.addEventListener('click', function () {
        location.hash = '#/market/stock/' + encodeURIComponent(b.getAttribute('data-stock'));
      });
    });
  }

  /* ------------------------------------------------------------ 섹터·업종 */
  function sectorView(view, sectorEn) {
    var market = st.market, basis = st.basis;
    var cells = Mkt.industryCells(market, sectorEn, basis);
    var rows = Mkt.rows(market, basis).filter(function (r) { return r.sector === sectorEn; });
    var up = rows.filter(function (r) { return (r.chg || 0) > 0; }).length;
    var down = rows.filter(function (r) { return (r.chg || 0) < 0; }).length;
    var h = topBar(false);
    h += '<div class="crumb"><a href="#/market">← 증시</a> · ' + esc(NameKo.sec(sectorEn)) + '</div>';
    h += '<section class="panel"><div class="card-h"><h2>' + esc(NameKo.sec(sectorEn)) + '</h2>' +
      '<span class="right"><span class="src">' + rows.length + '종목 · 상승 ' + up + ' · 하락 ' + down + '</span></span></div>';
    if (!cells.length) {
      h += '<div class="empty">이 섹터의 업종 자료가 없습니다.</div>';
    } else {
      h += '<div class="tbl-wrap"><table class="mkt"><thead><tr><th class="nm">업종</th><th>등락(시총가중)</th><th>종목</th><th>시가총액</th></tr></thead><tbody>';
      cells.forEach(function (c) {
        h += '<tr class="row" data-industry="' + esc(c.industryEn || c.name) + '">' +
          '<td class="nm"><span class="sym">' + esc(NameKo.ind(c.industryEn)) + '</span>' +
          '<span class="desc">' + esc(c.industryEn || '') + '</span></td>' +
          '<td>' + chg(c.chg, market) + '</td><td class="vol">' + c.count + '</td>' +
          '<td>' + Mkt.cap(c.mcap, market === 'kr' ? 'KRW' : 'USD', Mkt.fx()) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<div class="note">업종을 누르면 그 업종의 종목 목록이 열립니다. 값은 ' + (basis === 'after' ? '프리마켓' : '정규장') + ' 기준입니다.</div></section>';
    view.innerHTML = h;
    bindTop(view, false);
    view.querySelectorAll('[data-industry]').forEach(function (b) {
      b.addEventListener('click', function () {
        openIndustry(sectorEn, b.getAttribute('data-industry'), b.getAttribute('data-industry'));
      });
    });
    stopTimer();
  }

  function industryView(view, sectorEn, industryEn) {
    var market = st.market, basis = st.basis;
    var rows = Mkt.rows(market, basis).filter(function (r) {
      return r.sector === sectorEn && (r.industry === industryEn || (industryEn === '__none' && !r.industry));
    });
    rows = sortList(rows);
    var h = topBar(false);
    h += '<div class="crumb"><a href="#/market">← 증시</a> · <a href="#/market/sector/' + encodeURIComponent(sectorEn) + '">' +
      esc(NameKo.sec(sectorEn)) + '</a> · ' + esc(NameKo.ind(industryEn)) + '</div>';
    h += '<section class="panel"><div class="card-h"><h2>' + esc(NameKo.ind(industryEn)) + '</h2>' +
      '<span class="right">';
    Object.keys(SORTS).forEach(function (k) {
      h += '<button class="daytag" style="cursor:pointer' + (st.sort === k ? ';color:var(--tx);border-color:var(--line2)' : '') +
        '" data-list-sort="' + k + '" type="button">' + SORTS[k] + '</button>';
    });
    h += '</span></div>';
    if (!rows.length) {
      h += '<div class="empty">이 업종의 종목 자료가 없습니다.</div>';
    } else {
      h += table(rows, market);
    }
    h += '<div class="note">' + rows.length + '종목 · ' + SORTS[st.sort] + ' 순 · 값은 ' +
      (basis === 'after' ? '프리마켓' : '정규장') + ' 기준입니다.</div></section>';
    view.innerHTML = h;
    bindTop(view, false);
    bindHomeRows(view);
    bindHearts(view);
    view.querySelectorAll('[data-list-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.sort = b.getAttribute('data-list-sort');
        industryView(view, sectorEn, industryEn);
      });
    });
    stopTimer();
  }

  function sortList(rows) {
    var k = st.sort;
    var list = rows.slice();
    if (k === 'gain') list.sort(function (a, b) { return (b.chg == null ? -1e9 : b.chg) - (a.chg == null ? -1e9 : a.chg); });
    else if (k === 'loss') list.sort(function (a, b) { return (a.chg == null ? 1e9 : a.chg) - (b.chg == null ? 1e9 : b.chg); });
    else if (k === 'value') list.sort(function (a, b) { return (b.val || 0) - (a.val || 0); });
    else list.sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); });
    return list;
  }

  /* ------------------------------------------------------------ 종목 상세 */
  function detailView(view, sym) {
    var q = Mkt.quote(sym);
    var market = (q && q.market) || st.market;
    if (q && q.market !== st.market) st.market = q.market;
    var basis = st.basis;
    var lk = Mkt.look(sym, basis);
    var h = topBar(false);
    h += '<div class="crumb"><a href="#/market">← 증시</a> · ' + esc(sym) + '</div>';
    if (!q) {
      h += '<section class="panel"><div class="empty">' + esc(sym) + ' 자료가 스냅샷에 없습니다.<br>' +
        '<span class="small">관심 종목에 담으면 5분 갱신 파이프라인이 다음 주기에 받아 옵니다. 값을 지어내지 않습니다.</span></div></section>';
      view.innerHTML = h;
      bindTop(view, false);
      stopTimer();
      return;
    }
    var raw = q.raw || {};
    var cur = q.cur;
    h += '<section class="panel"><div class="det-head">' +
      '<div><div class="note" style="margin:0">' + esc(q.exch || '') + ' · ' + marketLabel(market) + (q.industry ? ' · ' + esc(NameKo.ind(q.industry)) : '') + '</div>' +
      '<h2 style="margin:2px 0 0">' + esc(q.name || sym) + ' <span class="src">' + esc(sym) + '</span></h2>' +
      '<div class="big" style="margin-top:6px">' + px(lk ? lk.price : null, cur) + ' <span style="font-size:15px">' + chg(lk ? lk.chg : null, market) + '</span></div>' +
      '<div class="note" style="margin-top:2px">' + esc(lk ? (lk.note || '') : '') + (lk && lk.at ? ' · ' + Mkt.time(lk.at) : '') + '</div>' +
      '</div><div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      heartBtn(sym, q.name, true) +
      '<a class="btn sm ghost" href="#/rebalance">리밸런싱</a></div></div>';

    if (raw.high52 && raw.low52 && lk && lk.price != null && raw.high52 > raw.low52) {
      var pos = Math.max(0, Math.min(100, (lk.price - raw.low52) / (raw.high52 - raw.low52) * 100));
      h += '<div class="range52"><i style="left:calc(' + pos.toFixed(1) + '% - 1px)"></i></div>' +
        '<div class="note" style="display:flex;justify-content:space-between;margin:0">' +
        '<span>52주 최저 ' + Mkt.cur(raw.low52, cur) + '</span><span>52주 최고 ' + Mkt.cur(raw.high52, cur) + '</span></div>';
    }
    h += '</section>';

    h += '<section class="panel"><div class="card-h"><h2>캔들 차트</h2><span class="right"><span class="src" id="cspan">일봉</span></span></div>';
    h += '<div class="mkt-tabs mini" id="cspans">' +
      Candles.spans.map(function (s) {
        return '<button class="tab' + (s.key === 'day' ? ' on' : '') + '" data-cspan="' + s.key + '" type="button">' + s.label + '</button>';
      }).join('') + '</div>';
    h += '<div class="chart-box" id="cbox" style="margin-top:8px"><canvas></canvas></div>' +
      '<div class="chart-readout note" style="margin-top:6px">차트를 짚으면 그 봉의 값이 나옵니다.</div>' +
      '<div class="ma-legend" id="maleg"></div>' +
      '<div class="note" id="cnote"></div></section>';

    h += '<section class="panel"><div class="card-h"><h2>밸류에이션</h2></div><div class="kv">' +
      kv('시가총액', Mkt.cap(q.mcap, cur, Mkt.fx())) +
      kv('PER(TTM)', fmt(raw.per, 2)) +
      kv('PBR', fmt(raw.pbr, 2)) +
      kv('PSR', fmt(raw.psr, 2)) +
      kv('EPS', raw.eps == null ? '—' : Mkt.cur(raw.eps, cur)) +
      kv('배당수익률', raw.div == null ? '—' : raw.div.toFixed(2) + '%') +
      kv('거래량', Mkt.vol(raw.vol)) +
      kv('거래대금', Mkt.money(q.val, cur)) +
      '</div><div class="note">값이 없는 칸은 —입니다(무료 공개 소스에 없는 항목).</div></section>';

    h += '<section class="panel"><div class="card-h"><h2>기술적 지표</h2></div><div class="kv">' +
      kv('일간 RSI', fmt(raw.rsi, 1)) +
      kv('주간 RSI', fmt(raw.rsiW, 1)) +
      kv('20일선', maCell(raw.sma20, lk && lk.price, cur)) +
      kv('50일선', maCell(raw.sma50, lk && lk.price, cur)) +
      kv('200일선', maCell(raw.sma200, lk && lk.price, cur)) +
      kv('ATR', fmt(raw.atr, 2)) +
      kv('일 변동성', raw.volD == null ? '—' : raw.volD.toFixed(2) + '%') +
      kv('베타', fmt(raw.beta, 2)) +
      '</div></section>';

    h += '<section class="panel"><div class="card-h"><h2>성과·목표가</h2></div><div class="kv">' +
      kv('1주', pctCell(raw.perfW, market)) +
      kv('1개월', pctCell(raw.perfM, market)) +
      kv('1년', pctCell(raw.perfY, market)) +
      kv('연초 이후', pctCell(raw.perfYtd, market)) +
      kv('애널리스트 목표가', raw.target == null ? '—' : Mkt.cur(raw.target, cur)) +
      kv('목표가 여력', (raw.target != null && lk && lk.price) ? Mkt.pct((raw.target / lk.price - 1) * 100) : '—') +
      kv('투자의견', recoText(raw.reco)) +
      kv('다음 실적', raw.earnNext ? F.day(new Date(raw.earnNext * 1000).toISOString().slice(0, 10)) : '—') +
      '</div><div class="note">트레이딩뷰 스캐너 값(지연). 목표가는 참고 값이며 매수·매도 권유가 아닙니다.</div></section>';

    h += '<div class="note">값의 출처 — ' + esc(q.src || '') + ' · ' + esc(Mkt.snap ? Mkt.snap.delayNote : '') + '</div>';
    view.innerHTML = h;
    bindTop(view, false);
    bindDetail(view, sym, q);
    bindHearts(view);

    var maOff = maOffObj();
    Candles.loadFor(sym).then(function (bars) {
      renderChart(sym, q, bars, 'day', maOff);
    });
    stopTimer();
  }

  function kv(k, v) { return '<div><b>' + esc(k) + '</b><span>' + v + '</span></div>'; }
  function fmt(v, d) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toFixed(d == null ? 2 : d);
  }
  function pctCell(v, market) {
    if (v == null || isNaN(v)) return '—';
    return '<span class="' + Mkt.tone(v, market) + '">' + Mkt.pct(v) + '</span>';
  }
  function maCell(ma, price, cur) {
    if (ma == null) return '—';
    if (!price) return Mkt.cur(ma, cur);
    var gap = (price / ma - 1) * 100;
    return Mkt.cur(ma, cur) + ' <span class="' + (gap >= 0 ? 'ok' : 'bad') + '" style="font-size:11px">' + Mkt.pct(gap) + '</span>';
  }
  function recoText(v) {
    if (v == null || isNaN(v)) return '—';
    var t = Number(v);
    var label = t > 0.5 ? '매수 우위' : (t > 0.1 ? '약한 매수' : (t > -0.1 ? '중립' : (t > -0.5 ? '약한 매도' : '매도 우위')));
    return label + ' (' + t.toFixed(2) + ')';
  }

  function bindDetail(view, sym, q) {
    view.querySelectorAll('[data-cspan]').forEach(function (b) {
      b.addEventListener('click', function () {
        view.querySelectorAll('[data-cspan]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        var sp = b.getAttribute('data-cspan');
        renderChart(sym, q, Candles.cache && Candles.cache[sym], sp, maOffObj());
      });
    });
  }

  function maOffObj() {
    var o = {};
    String(st.maOff || '').split(',').forEach(function (k) { if (k) o[k] = 1; });
    return o;
  }

  function renderChart(sym, q, bars, spanKey, maOff) {
    var view = document.getElementById('view');
    if (!view) return;
    var box = view.querySelector('#cbox');
    if (!box) return;
    var cur = q.cur;
    var all = bars || [];
    var sp = Candles.spanOf(spanKey);
    var use = Candles.usable(all, spanKey);
    var note = view.querySelector('#cnote');
    if (!all.length) {
      box.querySelector('canvas').getContext('2d');
      box.style.height = '220px';
      if (note) note.textContent = '이 종목의 봉 자료가 스냅샷에 없습니다(상위 종목·지수 위주로 담았습니다). 값을 지어내지 않습니다.';
      var leg0 = view.querySelector('#maleg');
      if (leg0) leg0.innerHTML = '';
      return;
    }
    var res = Candles.draw(box, { bars: all, span: spanKey, market: q.market, maOff: maOff, height: 260, cur: cur });
    if (note) {
      note.textContent = res.bars.length + '개 ' + sp.label + ' · ' + (use.ok ? '' :
        '이 봉 단위는 자료가 ' + use.count + '개뿐입니다(약 ' + (sp.need) + '개 필요). 봉을 지어내지 않습니다. ') +
        '이동평균선 ' + sp.ma.join('/') + ' ' + sp.unit;
    }
    var leg = view.querySelector('#maleg');
    if (leg) {
      leg.innerHTML = sp.ma.map(function (p, i) {
        var off = maOff[sp.key + '|' + p];
        return '<button type="button" data-ma="' + p + '" class="' + (off ? 'off' : '') + '">' +
          '<span style="color:' + ['#8FBEDC', '#dcb05f', '#a294e0', '#6fcf97'][i % 4] + '">●</span> ' + p + sp.unit + '</button>';
      }).join('');
      leg.querySelectorAll('[data-ma]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = b.getAttribute('data-ma');
          var key = sp.key + '|' + p;
          var o = maOffObj();
          if (o[key]) delete o[key]; else o[key] = 1;
          st.maOff = Object.keys(o).join(',');
          localStorage.setItem('stockrebal.mkt.maoff', st.maOff);
          renderChart(sym, q, all, spanKey, o);
        });
      });
    }
  }

  /* ------------------------------------------------------------ 지수 캔들 화면 */
  function candlesView(view, sym) {
    var market = st.market;
    var idx = Mkt.indices(market, st.basis).filter(function (x) { return x.sym === sym; })[0];
    var name = idx ? idx.name : sym;
    var h = topBar(false);
    h += '<div class="crumb"><a href="#/market">← 증시</a> · ' + esc(name) + '</div>';
    h += '<section class="panel"><div class="card-h"><h2>' + esc(name) + ' <span class="src">' + esc(sym) + '</span></h2>' +
      '<span class="right">' + (idx ? px(idx.price, market === 'kr' ? 'KRW' : 'USD') + ' ' + chg(idx.chg, market) : '') + '</span></div>';
    h += '<div class="mkt-tabs mini" id="cspans">' +
      Candles.spans.map(function (s) {
        return '<button class="tab' + (s.key === 'day' ? ' on' : '') + '" data-cspan="' + s.key + '" type="button">' + s.label + '</button>';
      }).join('') + '</div>';
    h += '<div class="chart-box" id="cbox" style="margin-top:8px"><canvas></canvas></div>' +
      '<div class="chart-readout note" style="margin-top:6px">차트를 짚으면 그 봉의 값이 나옵니다.</div>' +
      '<div class="ma-legend" id="maleg"></div><div class="note" id="cnote"></div>' +
      '<div class="note">봉은 나스닥·네이버 일봉이고, 주·월·연봉은 브라우저가 같은 규칙으로 묶습니다. 이동평균선은 그 봉 단위의 종가로 계산합니다.</div></section>';
    view.innerHTML = h;
    bindTop(view, false);
    var q = { cur: market === 'kr' ? 'KRW' : 'USD', market: market };
    view.querySelectorAll('[data-cspan]').forEach(function (b) {
      b.addEventListener('click', function () {
        view.querySelectorAll('[data-cspan]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        renderChart(sym, q, Candles.cache && Candles.cache[sym], b.getAttribute('data-cspan'), maOffObj());
      });
    });
    Candles.loadFor(sym).then(function (bars) {
      renderChart(sym, q, bars, 'day', maOffObj());
    });
    stopTimer();
  }

  /* ------------------------------------------------------------ 5분 갱신 반영 */
  function startPoll(view) {
    stopTimer();
    st.timer = setInterval(function () {
      if (!document.getElementById('view') || location.hash.indexOf('#/market') !== 0) { stopTimer(); return; }
      Mkt.refreshLive().then(function (js) {
        if (!js) return;
        var at = js.updatedAt ? Date.parse(js.updatedAt) : 0;
        if (at && at !== st.lastLive) {
          st.lastLive = at;
          refresh(document.getElementById('view'));
        }
      });
    }, 120000);
  }

  function refresh(view) {
    var parts = (location.hash.replace(/^#/, '').split('/').filter(Boolean));
    route(view, parts);
  }

  /* ------------------------------------------------------------ 라우터 */
  function route(view, parts) {
    // parts: ['market'] / ['market','candles','SYM'] / ['market','sector','X'] / ['market','industry','S','I'] / ['market','stock','SYM']
    st.market = S.get('market.tab', st.market) || 'us';
    if (st.market !== 'kr' && st.market !== 'us') st.market = 'us';
    moveLegacyBasis();
    st.basis = basisKey();
    if (st.sort !== 'value' && st.sort !== 'gain' && st.sort !== 'loss' && st.sort !== 'cap') st.sort = 'cap';
    st.sort = S.get('market.sort', st.sort) || st.sort;
    if (st.sort !== 'value' && st.sort !== 'gain' && st.sort !== 'loss' && st.sort !== 'cap') st.sort = 'cap';

    if (parts.length === 1) return home(view);
    var kind = parts[1];
    if (kind === 'candles') return candlesView(view, decodeURIComponent(parts[2] || ''));
    if (kind === 'sector') return sectorView(view, decodeURIComponent(parts[2] || ''));
    if (kind === 'industry') return industryView(view, decodeURIComponent(parts[2] || ''), decodeURIComponent(parts[3] || ''));
    if (kind === 'stock') return detailView(view, decodeURIComponent(parts[2] || ''));
    return home(view);
  }

  function openSector(sectorEn) { location.hash = '#/market/sector/' + encodeURIComponent(sectorEn); }
  function openStock(sym) { location.hash = '#/market/stock/' + encodeURIComponent(sym); }
  function openIndustry(sectorEn, industryEn, name) {
    location.hash = '#/market/industry/' + encodeURIComponent(sectorEn) + '/' + encodeURIComponent(industryEn || name || '');
  }

  V.market = function (view, parts) {
    if (!Mkt.ready) {
      view.innerHTML = '<div class="loading">증시 자료를 불러오는 중…</div>';
      Mkt.load().then(function () {
        route(view, parts && parts.length ? ['market'].concat(parts) : ['market']);
      }).catch(function (e) {
        view.innerHTML = '<div class="empty">증시 자료(data/market.json)를 불러오지 못했습니다.<br>' +
          '<span class="small">' + esc(String((e && e.message) || e)) + '</span></div>';
      });
      return;
    }
    route(view, parts && parts.length ? ['market'].concat(parts) : ['market']);
  };

  w.MarketView = { route: route, state: st };
})(window);
