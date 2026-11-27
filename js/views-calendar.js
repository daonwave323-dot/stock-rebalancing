/* 일정 탭 — 원본 ScheduleScreen.kt + CalendarPane.kt 를 옮긴다.
     갈래 둘: **일정**(미국 시장 일정 달력: 주|월, 별 등급) · **브리핑**(앱에 든 마지막 글).
   미국 일정만 담는다(국내 일정 없음). 시각은 KST, 미국 동부 시각은 작게 병기한다. */
(function (w) {
  'use strict';
  var V = w.Views = w.Views || {};

  var KEY = '??';

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function iso(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function parse(s) { var a = String(s).split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function weekStart(d) { var x = new Date(d.getTime()); var dow = (x.getDay() + 6) % 7; return addDays(x, -dow); }
  function fmtMD(d) { return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }

  var KIND_TONE = {
    '연준·FOMC': '#dcb05f', '실적': '#6a9ae0', '상장·IPO': '#8FBEDC',
    '지표': '#43b795', '휴장·시간': '#949fb1'
  };
  var DOW = ['월', '화', '수', '목', '금', '토', '일'];

  var cal = { data: null, err: '', pane: 0, monthly: false, star: 0, mineOnly: false,
    weekStart: null, monthCursor: null, day: null, expanded: null, brief: null };

  function load() {
    return Promise.all([
      fetch('data/calendar.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('calendar.json ' + r.status);
        return r.json();
      }),
      fetch('data/brief.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
    ]).then(function (a) { cal.data = a[0]; cal.brief = a[1]; });
  }

  function build(view) {
    var h = '<div class="mkt-wrap">';
    h += '<div class="mkt-tabs">' +
      '<button class="tab' + (cal.pane === 0 ? ' on' : '') + '" data-pane="0" type="button">일정</button>' +
      '<button class="tab' + (cal.pane === 1 ? ' on' : '') + '" data-pane="1" type="button">브리핑</button></div>';
    h += (cal.pane === 0 ? calHtml() : briefHtml());
    h += '</div>';
    view.innerHTML = h;
    bind(view);
  }

  /* ------------------------------------------------------------ 일정 */
  function eventsOf() {
    return (cal.data && cal.data.events) || [];
  }

  function mineSymbols() {
    var out = {};
    ['us', 'kr'].forEach(function (m) {
      Mkt.watch(m).forEach(function (x) { out[String(x.sym).toUpperCase()] = 1; });
    });
    (function () {
      /* 보유는 미국장·국장 두 키에 나뉘어 있다(예전 한 벌 키도 함께 본다). */
      var hold = (S.get('holdings.us', []) || []).concat(S.get('holdings.kr', []) || []);
      if (!hold.length) hold = S.get('holdings', []) || [];
      hold.forEach(function (r) { if (r.sym) out[String(r.sym).toUpperCase()] = 1; });
    })();
    return out;
  }

  function levelOf(e, mine) {
    if (e.kind === '실적' && e.symbol && mine[e.symbol.toUpperCase()]) return 3;
    return e.importance || 1;
  }

  function calHtml() {
    var mine = mineSymbols();
    var ev = eventsOf();
    var ws = cal.weekStart || weekStart(parse(today()));
    var h = '';

    h += '<section class="panel"><div class="card-h"><h2>미국 일정</h2>' +
      '<span class="right"><span class="src">' + (cal.data ? '자료 ' + F.day(cal.data.asOf) + ' · ' + ev.length + '건' : '') + '</span></span></div>';

    // ① 주 | 월
    h += '<div class="mkt-tabs mini"><button class="tab' + (!cal.monthly ? ' on' : '') + '" data-monthly="0" type="button">주</button>' +
      '<button class="tab' + (cal.monthly ? ' on' : '') + '" data-monthly="1" type="button">월</button></div>';

    // ② 기간 이동
    var label;
    if (cal.monthly) {
      var mc = cal.monthCursor || new Date((cal.weekStart || parse(today())).getFullYear(), (cal.weekStart || parse(today())).getMonth(), 1);
      label = mc.getFullYear() + '년 ' + (mc.getMonth() + 1) + '월';
    } else {
      label = fmtMD(ws) + ' ~ ' + fmtMD(addDays(ws, 6));
    }
    h += '<div class="cal-bar" style="margin-top:10px">' +
      '<button class="btn sm" data-shift="-1" type="button">←</button>' +
      '<b style="flex:1;text-align:center;font-size:14px">' + esc(label) + '</b>' +
      '<button class="btn sm" data-shift="1" type="button">→</button>' +
      '<button class="btn sm ghost" data-shift="0" type="button">이번 주</button></div>';

    // ③ 별 등급·내 종목
    h += '<div class="pill-row" style="margin-top:8px">';
    [[0, '전체'], [2, '★★ 이상'], [3, '★★★']].forEach(function (o) {
      h += '<button class="chip' + (cal.star === o[0] ? ' on' : '') + '" data-star="' + o[0] + '" type="button">' + o[1] + '</button>';
    });
    h += '<button class="chip' + (cal.mineOnly ? ' on' : '') + '" data-mine="1" type="button">내 종목만</button>';
    h += '</div>';

    // ④ 범례
    h += '<div class="pill-row" style="margin-top:8px;font-size:10.5px">';
    Object.keys(KIND_TONE).forEach(function (k) {
      h += '<span class="src" style="display:inline-flex;align-items:center;gap:4px">' +
        '<span style="width:6px;height:6px;border-radius:2px;background:' + KIND_TONE[k] + '"></span>' +
        esc(k === '휴장·시간' ? '시간' : (k === '연준·FOMC' ? '연준·금리' : k)) + '</span>';
    });
    h += '</div>';

    if (cal.monthly) {
      h += monthGrid(mine);
      var sel = cal.day || today();
      h += '<div class="cal-list" style="margin-top:12px"><div class="card-h"><h2>' + F.day(sel) + '</h2></div>' +
        eventList(ev.filter(function (e) { return e.date === sel; }), mine, sel) + '</div>';
    } else {
      for (var i = 0; i < 7; i++) {
        var d = addDays(ws, i);
        var ds = iso(d);
        var list = ev.filter(function (e) { return e.date === ds; });
        h += '<div style="margin-top:12px"><div class="card-h"><h2>' + esc(DOW[i] + ' ' + fmtMD(d)) +
          (ds === today() ? ' <span class="daytag">오늘</span>' : '') + '</h2>' +
          '<span class="right"><span class="src">' + list.length + '건</span></span></div>' +
          eventList(list, mine, ds) + '</div>';
      }
    }
    h += '<div class="pill-row" style="margin-top:10px"><a class="chip" href="#/market">증시</a>' +
      '<a class="chip" href="#/tools">도구</a></div>';
    h += '<div class="note">' + esc(cal.data ? (cal.data.note || '') : '') +
      ' 일정은 ' + esc((cal.data && (cal.data.sources || []).join(' · ')) || '') + '.</div>';
    h += '</section>';
    return h;
  }

  function monthGrid(mine) {
    var ev = eventsOf();
    var base = cal.monthCursor || new Date((cal.weekStart || parse(today())).getFullYear(),
      (cal.weekStart || parse(today())).getMonth(), 1);
    var first = new Date(base.getFullYear(), base.getMonth(), 1);
    var start = weekStart(first);
    var h = '<div class="cal-grid">';
    DOW.forEach(function (d) { h += '<div class="dow">' + d + '</div>'; });
    for (var i = 0; i < 42; i++) {
      var d = addDays(start, i);
      var ds = iso(d);
      if (i >= 35 && d.getMonth() !== base.getMonth()) break;
      var list = ev.filter(function (e) { return e.date === ds; });
      var show = list.filter(function (e) {
        var lv = levelOf(e, mine);
        if (cal.star && lv < cal.star) return false;
        if (cal.mineOnly && !(e.symbol && mine[e.symbol.toUpperCase()])) return false;
        return true;
      });
      h += '<div class="day' + (d.getMonth() !== base.getMonth() ? ' out' : '') +
        (ds === today() ? ' today' : '') + (ds === (cal.day || today()) ? ' on' : '') +
        '" data-day="' + ds + '"><b>' + d.getDate() + '</b>';
      show.slice(0, 2).forEach(function (e) {
        h += '<span class="e">· ' + esc(e.title.length > 14 ? e.title.slice(0, 13) + '…' : e.title) + '</span>';
      });
      if (show.length > 2) h += '<span class="e src">+' + (show.length - 2) + '</span>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function eventList(list, mine, ds) {
    var out = list.filter(function (e) {
      var lv = levelOf(e, mine);
      if (cal.star && lv < cal.star) return false;
      if (cal.mineOnly && !(e.symbol && mine[e.symbol.toUpperCase()])) return false;
      return true;
    });
    if (!out.length) return '<div class="note" style="margin:4px 0">조건에 맞는 일정이 없습니다.</div>';
    var past = ds < today();
    var h = '';
    out.forEach(function (e) {
      var lv = levelOf(e, mine);
      var isMine = !!(e.symbol && mine[e.symbol.toUpperCase()]);
      var key = e.date + '|' + e.kind + '|' + e.title + '|' + (e.time || '');
      var open = cal.expanded === key;
      var tone = KIND_TONE[e.kind] || '#949fb1';
      h += '<div class="ev ' + (past ? 'past ' : '') + (isMine ? 'mine' : '') + '" data-ev="' + esc(key) + '">' +
        '<span class="t">' + esc(e.time || (e.kind === '실적' ? '장전/장후' : '시각 미정')) + '</span>' +
        '<span class="n">' + esc((e.kind === '실적' ? '' : (e.country || '') + ' · ') + e.title) + '</span>' +
        '<span class="k" style="border-color:' + tone + ';color:' + tone + '">' + esc(e.kind === '휴장·시간' ? '시간' : e.kind) + '</span>' +
        (isMine ? '<span class="k" style="border-color:#8FBEDC;color:#8FBEDC">내 종목</span>' : '') +
        '<span class="src">' + (lv >= 3 ? '★★★' : (lv === 2 ? '★★' : '★')) + '</span></div>';
      var detail = e.kind === '실적'
        ? [e.symbol ? '티커 ' + e.symbol : '', e.forecast ? 'EPS 예상 ' + e.forecast : '', e.previous ? '작년 ' + e.previous : '']
        : [e.forecast ? '예상 ' + e.forecast : '', e.previous ? '이전 ' + e.previous : '', e.actual ? '발표 ' + e.actual : ''];
      var line = detail.filter(Boolean).join(' · ');
      h += '<div class="note" style="margin:-4px 0 6px 52px">' + esc(line ? line + ' · ' : '') +
        '미국 일정' + (e.time ? ' · ' + esc(e.time) : '') + '</div>';
      if (open) {
        h += '<div class="block" style="margin:-2px 0 10px 52px;font-size:12.5px">';
        if (e.desc) h += '<p style="white-space:pre-line;margin:0 0 6px">' + esc(e.desc) + '</p>';
        if (e.why) h += '<p style="margin:0 0 6px"><b>왜 중요한가</b> · ' + esc(e.why) + '</p>';
        if (e.note) h += '<p class="note" style="margin:0 0 6px">' + esc(e.note) + '</p>';
        if (e.source) h += '<p class="note" style="margin:0">출처 · ' + esc(e.source) + '</p>';
        h += '</div>';
      }
    });
    return h;
  }

  /* ------------------------------------------------------------ 브리핑 */
  function briefHtml() {
    var b = cal.brief;
    var h = '<section class="panel"><div class="card-h"><h2>브리핑</h2><span class="right">' +
      '<span class="src">' + (b ? '갱신 ' + esc((b.updated || '').replace('T', ' ').slice(0, 16)) + ' · 내장 자료' : '자료 없음') +
      '</span></span></div>';
    if (!b || !(b.items || []).length) {
      h += '<div class="empty">브리핑 자료가 없습니다.</div></section>';
      return h;
    }
    b.items.forEach(function (it) {
      h += '<article class="block" style="margin-bottom:12px">';
      if (it.title) h += '<h3 style="margin:0 0 6px;font-size:15px">' + esc(it.title) + '</h3>';
      if (it.body) h += '<div style="white-space:pre-line;font-size:13.5px;line-height:1.65">' + esc(it.body) + '</div>';
      if (it.tags && it.tags.length) {
        h += '<div class="pill-row" style="margin-top:8px">' + it.tags.slice(0, 6).map(function (t) {
          return '<span class="chip" style="cursor:default">' + esc(t) + '</span>';
        }).join('') + '</div>';
      }
      h += '</article>';
    });
    h += '<div class="note">글은 받은 그대로 보여 줍니다(요약·재작성 없음). 원본 앱은 하루 두 번 원격에서 받아 오고, 웹은 마지막으로 받은 글을 정적 파일(data/brief.json)로 둡니다.</div></section>';
    return h;
  }

  /* ------------------------------------------------------------ 이벤트 */
  function bind(view) {
    view.querySelectorAll('[data-pane]').forEach(function (b) {
      b.addEventListener('click', function () {
        cal.pane = +b.getAttribute('data-pane');
        build(view);
      });
    });
    view.querySelectorAll('[data-monthly]').forEach(function (b) {
      b.addEventListener('click', function () {
        cal.monthly = b.getAttribute('data-monthly') === '1';
        build(view);
      });
    });
    view.querySelectorAll('[data-shift]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = +b.getAttribute('data-shift');
        if (d === 0) {
          cal.weekStart = weekStart(parse(today()));
          cal.monthCursor = null;
        } else if (cal.monthly) {
          var base = cal.monthCursor || new Date(parse(today()).getFullYear(), parse(today()).getMonth(), 1);
          cal.monthCursor = new Date(base.getFullYear(), base.getMonth() + d, 1);
        } else {
          cal.weekStart = addDays(cal.weekStart || weekStart(parse(today())), d * 7);
        }
        build(view);
      });
    });
    view.querySelectorAll('[data-star]').forEach(function (b) {
      b.addEventListener('click', function () {
        cal.star = +b.getAttribute('data-star');
        build(view);
      });
    });
    view.querySelectorAll('[data-mine]').forEach(function (b) {
      b.addEventListener('click', function () {
        cal.mineOnly = !cal.mineOnly;
        build(view);
      });
    });
    view.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () {
        cal.day = b.getAttribute('data-day');
        build(view);
      });
    });
    view.querySelectorAll('[data-ev]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-ev');
        cal.expanded = cal.expanded === k ? null : k;
        build(view);
      });
    });
  }

  V.calendar = function (view) {
    if (!cal.data && !cal.err) {
      view.innerHTML = '<div class="loading">일정 자료를 불러오는 중…</div>';
      load().then(function () { build(view); }).catch(function (e) {
        cal.err = String((e && e.message) || e);
        view.innerHTML = '<div class="empty">일정 자료(data/calendar.json)를 불러오지 못했습니다.<br>' +
          '<span class="small">' + esc(cal.err) + '</span></div>';
      });
      return;
    }
    build(view);
  };
})(window);
