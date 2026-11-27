/* 점수 알림 — 원본 Notify.kt 의 웹 대체.
   원본은 기기 알림(알림 채널·조용한 시간·임계 점수)을 스스로 띄운다. 웹은 서버가 없으므로
   **이 페이지를 열어 둔 동안** 브라우저 알림으로 같은 임계·조용한 시간 규칙을 지킨다.
   하루에 한 번, 점수가 임계를 넘었을 때만 알린다(원본 NotifyRules.decide 의 '같은 값 반복 금지'). */
(function (w) {
  'use strict';

  var CHECK_MS = 5 * 60 * 1000;

  function settings() {
    return S.get('notify', null) || { on: true, thNdx: 90, thSox: 90, quietOn: true, quietStart: 1380, quietEnd: 420 };
  }

  function minutesNow() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function quiet(set) {
    if (!set.quietOn) return false;
    var now = minutesNow(), a = set.quietStart, b = set.quietEnd;
    if (a === b) return false;
    return a < b ? (now >= a && now < b) : (now >= a || now < b);
  }

  function todayKey() {
    return F.today();
  }

  function check() {
    var set = settings();
    if (!set.on || !w.Notification || Notification.permission !== 'granted') return;
    if (!w.Data || !Data.ready || !Data.scores) return;
    if (quiet(set)) return;
    var t = Data.scores.targets;
    var fired = S.get('notify.fired', {}) || {};
    var day = todayKey();
    var sent = [];
    [['ndx', 'TQQQ', set.thNdx], ['sox', 'SOXL', set.thSox]].forEach(function (row) {
      var d = t[row[0]];
      if (!d) return;
      var score = d.score;
      if (score == null || score < row[2]) return;
      var key = row[1] + '@' + day;
      if (fired[key]) return;
      fired[key] = score;
      sent.push(row[1] + ' ' + F.num(score) + '점');
    });
    if (!sent.length) return;
    S.set('notify.fired', fired);
    try {
      new Notification('스톡 리밸런싱 · 매수 구간 알림', {
        body: sent.join(' · ') + ' — ' + Data.asOf() + ' 기준 (임계 ' + set.thNdx + '/' + set.thSox + '점)',
        tag: 'score-' + day
      });
    } catch (e) { /* 알림 실패는 화면을 막지 않는다 */ }
  }

  function boot() {
    if (!w.Data) return;
    var run = function () {
      if (Data.ready) check();
      else setTimeout(run, 1500);
    };
    run();
    setInterval(function () { if (Data.ready) check(); }, CHECK_MS);
    w.addEventListener('hashchange', function () { setTimeout(check, 800); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
