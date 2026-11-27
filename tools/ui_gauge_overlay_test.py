#!/usr/bin/env python3
"""매수 지표 — 최근 한 달 일봉 · 겹쳐 보기(날짜 축·창 슬라이더) 검증.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/ui_gauge_overlay_test.py

확인
  1) 최근 한 달 일봉: 봉 수·첫/끝 날짜가 자료와 같고, 지표를 손대면 '지금' 점이 움직인다
  2) 겹쳐 보기: 여섯 사례가 처음부터 모두 켜짐, 제목이 사례 수와 맞음
  3) 날짜 축이 기본 — 연도 눈금, 사례 선 + 오늘 선, 오늘 위치 2026
  4) 저점 기준 창 슬라이더 1·2·3년 — 축 범위·눈금·오늘 점이 함께 바뀐다
  5) 새로 고침 후 보기·창 유지
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, 'screens-gauge')
results = []
errs = []


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + str(note) if note else ''))
    return ok


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    h = functools.partial(Handler, directory=ROOT)
    httpd = socketserver.TCPServer(('127.0.0.1', 0), h)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def trading_days(iso, n):
    d = date.fromisoformat(iso)
    step = 1 if n >= 0 else -1
    left = abs(n)
    while left:
        d += timedelta(days=step)
        if d.weekday() < 5:
            left -= 1
    return d


def main():
    os.makedirs(SHOTS, exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'live.json'), encoding='utf-8') as f:
        live = json.load(f)
    with open(os.path.join(ROOT, 'data', 'gauge.json'), encoding='utf-8') as f:
        gauge = json.load(f)
    with open(os.path.join(ROOT, 'data', 'crashes.json'), encoding='utf-8') as f:
        crashes = json.load(f)
    tq = live['symbols']['TQQQ']
    peak = tq['scoreDetail']['peak']
    bars_src = tq.get('dayBars') or [{'d': b[0], 'o': b[1], 'h': b[2], 'l': b[3], 'c': b[4]}
                                     for b in gauge['candles']['ndx']]
    print('  일봉 출처: %s · %d개 %s~%s' % ('live.dayBars' if tq.get('dayBars') else 'gauge.candles(폴백)',
                                       len(bars_src), bars_src[0]['d'], bars_src[-1]['d']))

    httpd = serve()
    base = 'http://127.0.0.1:%d/' % httpd.server_address[1]
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844},
                            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
        pg = ctx.new_page()
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))

        def open_gauge(q=''):
            pg.goto(base + 'index.html' + q + '#/gauge')
            pg.wait_for_selector('#gTop', timeout=8000)
            pg.wait_for_timeout(600)

        open_gauge('?ov1')
        # ---------------------------------------------------- 1) 최근 한 달 일봉
        st = pg.evaluate("""() => {
          const host = document.querySelector('#gBars');
          return {
            rects: host ? host.querySelectorAll('rect').length : 0,
            sum: (document.querySelector('#gBarsSum')||{}).textContent || '',
            month: !!document.querySelector('#gMonth svg'),
            xoverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
          };
        }""")
        check('일봉 봉 수가 자료와 같다', st['rects'] == len(bars_src), (st['rects'], len(bars_src)))
        check('일봉 첫·끝 날짜 표기', bars_src[0]['d'] in st['sum'] and bars_src[-1]['d'] in st['sum'], st['sum'][:90])
        check('일봉 요약(시작·끝·최고·최저)', all(k in st['sum'] for k in ('시작', '끝', '최고', '최저')), st['sum'])
        check('점수 선 차트 있음', st['month'])
        check('390px 가로 넘침 0', st['xoverflow'] <= 0, st['xoverflow'])

        lab0 = pg.evaluate("() => [...document.querySelectorAll('#gBars text')].map(e=>e.textContent).filter(x=>x.startsWith('지금')).join('|')")
        pg.evaluate("""() => { const s=document.querySelector('[data-slider="dd"]'); s.value='30'; s.dispatchEvent(new Event('input',{bubbles:true})); }""")
        pg.wait_for_timeout(300)
        lab1 = pg.evaluate("() => [...document.querySelectorAll('#gBars text')].map(e=>e.textContent).filter(x=>x.startsWith('지금')).join('|')")
        want = peak * 0.7
        check('지표 손대면 1개월 차트 지금 점 이동', lab0 != lab1 and lab1 != '', (lab0[:40], lab1[:40]))
        check('지금 점이 역산 가격과 같다', ('$%.2f' % want) in lab1, (lab1, want))
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-month.png'))

        # ---------------------------------------------------- 2) 겹쳐 보기 열기
        open_gauge('?ov2')
        pg.evaluate("() => document.querySelector('[data-toggle=\"crash\"]').click()")
        pg.wait_for_timeout(700)
        chips = pg.evaluate("""() => {
          const all = [...document.querySelectorAll('#ovChips [data-ovcase]')];
          return {n: all.length, on: all.filter(b=>b.classList.contains('on')).length,
                  title: (document.querySelector('#sec-crash .g-sub')||document.querySelector('.g-sub')||{}).textContent};
        }""")
        check('사례 칩 6개 모두 켜짐', chips['n'] == len(crashes['cases']) and chips['on'] == chips['n'], chips)
        body = pg.inner_text('#view')
        check('제목이 사례 수(6개 시점)와 맞다', '%d개 시점' % len(crashes['cases']) in body)

        # ---------------------------------------------------- 3) 날짜 축 기본
        d0 = pg.evaluate("""() => {
          const svg = document.querySelector('#ovChart svg');
          const texts = [...svg.querySelectorAll('text')].map(e=>e.textContent);
          return {paths: svg.querySelectorAll('path').length, texts,
                  scale: [...document.querySelectorAll('[data-ovscale]')].filter(b=>b.classList.contains('on')).map(b=>b.getAttribute('data-ovscale')),
                  basis: (document.querySelector('#ovBasis')||{}).textContent};
        }""")
        check('기본 보기가 날짜', d0['scale'] == ['date'], d0['scale'])
        check('날짜 축: 사례 6 + 오늘 1 = 선 7개', d0['paths'] == len(crashes['cases']) + 1, d0['paths'])
        check('날짜 축: 연도 눈금', any(t.isdigit() and len(t) == 4 for t in d0['texts']), d0['texts'][:10])
        check('날짜 축: 오늘 이름표', any(t == '오늘' for t in d0['texts']), d0['texts'][-8:])
        check('오늘 위치가 2026-11-28 근처', '2026' in (d0['basis'] or ''), d0['basis'])

        # 각 사례 선의 시작·끝 연도가 peak·trough 와 맞는지(거래일 근사 ±10일)
        geo = pg.evaluate("""() => {
          const svg = document.querySelector('#ovChart svg');
          const w = svg.viewBox.baseVal.width;
          return [...svg.querySelectorAll('path')].map(p => p.getAttribute('d'));
        }""")
        def d_start_end(d):
            import re
            pts = re.findall(r'[ML]([\\d.]+) ([\\d.]+)', d)
            return (pts[0][0], pts[-1][0]) if pts else None
        # x축 범위는 그림에서 역산하기 어려우므로, 사례별 첫 점 날짜를 브라우저에서 직접 계산
        ext = pg.evaluate("""() => {
          const o = document.querySelector('#ovChart').__ov;
          if (!o || o.kind !== 'date') return null;
          const W = o.W, pad = o.pad;
          const toMs = x => o.x0 + (x - pad.l) / (W - pad.l - pad.r) * (o.x1 - o.x0);
          return [...document.querySelectorAll('#ovChart path')].map(p => {
            const m = p.getAttribute('d').match(/[ML]([\\d.]+) /g) || [];
            const xs = p.getAttribute('d').match(/[ML]([\\d.]+) /g).map(s => parseFloat(s.slice(1)));
            return {first: new Date(toMs(xs[0])).toISOString().slice(0, 10),
                    last: new Date(toMs(xs[xs.length-1])).toISOString().slice(0,10)};
          });
        }""")
        ok_span = True
        detail = []
        if ext:
            for c, e in zip(crashes['cases'], ext):
                lim = 252  # 창 1년 — 자료가 있는 범위(고점 ±252거래일)
                lo = trading_days(c['peak'], -lim)
                hi = trading_days(c['peak'], lim)
                a = date.fromisoformat(e['first']); b2 = date.fromisoformat(e['last'])
                good = abs((a - lo).days) <= 12 and abs((b2 - hi).days) <= 12
                detail.append((c['short'], c['peak'], e['first'], str(lo), e['last'], str(hi), good))
                ok_span = ok_span and good
        for r in detail:
            print('    %-5s peak %s · 선 %s (기대 %s) · 끝 %s (기대 %s) %s' % (r[0], r[1], r[2], r[3], r[4], r[5], 'OK' if r[6] else 'X'))
        check('사례 선 시작·끝이 고점±1년(자료 범위)과 맞다', ok_span, len(detail))
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-date.png'))

        # ---------------------------------------------------- 4) 창 슬라이더 1→3년
        def window_state():
            return pg.evaluate("""() => {
              const svg = document.querySelector('#ovChart svg');
              const texts = [...svg.querySelectorAll('text')].map(e=>e.textContent);
              const o = document.querySelector('#ovChart').__ov;
              const W = o.W, pad = o.pad;
              const toMs = x => o.x0 + (x - pad.l) / (W - pad.l - pad.r) * (o.x1 - o.x0);
              const paths = [...document.querySelectorAll('#ovChart path')].map(p=>{
                const xs = p.getAttribute('d').match(/[ML]([\\d.]+) /g).map(s=>parseFloat(s.slice(1)));
                return {first:new Date(toMs(xs[0])).toISOString().slice(0,10), last:new Date(toMs(xs[xs.length-1])).toISOString().slice(0,10), n: xs.length};
              });
              return {win: (document.querySelector('#ovWinLab')||{}).textContent, texts, paths,
                      readout: (document.querySelector('#ovReadout')||{}).textContent};
            }""")
        w1 = window_state()
        pg.evaluate("() => { const s=document.querySelector('#ovWin'); s.value='2'; s.dispatchEvent(new Event('input',{bubbles:true})); }")
        pg.wait_for_timeout(500)
        w2 = window_state()
        pg.evaluate("() => { const s=document.querySelector('#ovWin'); s.value='3'; s.dispatchEvent(new Event('input',{bubbles:true})); }")
        pg.wait_for_timeout(500)
        w3 = window_state()
        check('창 1년 라벨', w1['win'] == '1년', w1['win'])
        check('창 2년 라벨', w2['win'] == '2년', w2['win'])
        check('창 3년 라벨', w3['win'] == '3년', w3['win'])
        check('창 3년에서도 오늘 선 유지', any(t == '오늘' for t in w3['texts']))
        # 저점 기준 보기에서는 축이 ±1→±3년으로 늘어난다
        pg.click('[data-ovscale="trough"]')
        pg.wait_for_timeout(500)
        tr3 = pg.evaluate("() => [...document.querySelectorAll('#ovChart svg text')].map(e=>e.textContent)")
        check('저점 보기 축이 ±3년', any('−3년' in x for x in tr3) and any('+3년' in x for x in tr3), tr3[:8])
        pg.evaluate("() => { const s=document.querySelector('#ovWin'); s.value='1'; s.dispatchEvent(new Event('input',{bubbles:true})); }")
        pg.wait_for_timeout(400)
        tr1 = pg.evaluate("() => [...document.querySelectorAll('#ovChart svg text')].map(e=>e.textContent)")
        check('저점 보기 축이 ±1년으로 줄어든다', any('−1년' in x for x in tr1) and not any('−3년' in x for x in tr1), tr1[:8])
        # 다시 날짜 보기로
        pg.click('[data-ovscale="date"]')
        pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-date-3y.png'))

        # 읽기줄 격차 — 브라우저에서 날짜 하나를 짚어 확인
        rd = pg.evaluate("""() => {
          const o = document.querySelector('#ovChart').__ov;
          const ms = Date.parse('2008-10-10T00:00:00Z');
          const el = document.querySelector('#ovReadout');
          el.innerHTML = '';
          const ev = new MouseEvent('mousemove', {clientX: 0, bubbles: true});
          return null;
        }""")
        # 짚어보기는 좌표가 필요하므로 직접 ovDateReadout 계산 대신, 실제 마우스 이동으로 확인
        pg.eval_on_selector('#ovChart', 'el => el.scrollIntoView({block:"center"})')
        pg.wait_for_timeout(300)
        box = pg.eval_on_selector('#ovChart svg', 'el => { const r = el.getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; }')
        tx = pg.evaluate("() => { const o=document.querySelector('#ovChart').__ov; return o.sx(Date.parse('2008-09-15T00:00:00Z')); }")
        pg.mouse.move(box['x'] + (tx / 760.0) * box['w'], box['y'] + box['h'] * 0.5)
        pg.wait_for_timeout(300)
        readout = pg.inner_text('#ovReadout')
        check('날짜 축 짚어보기 — 2008 값', '2008' in readout and '%' in readout, readout[:140])
        print('    날짜축 읽기:', readout[:140])

        # 저점 기준 보기에서는 같은 경과일끼리 격차가 읽힌다
        pg.click('[data-ovscale="pct"]')
        pg.wait_for_timeout(400)
        tv = pg.evaluate("() => { const o=document.querySelector('#ovChart').__ov; return {kind:o.kind||'day', n:(document.querySelector('#ovReadout')||{}).textContent}; }")
        rd2 = pg.inner_text('#ovReadout')
        check('경과일 보기 읽기줄에 격차', '격차' in rd2, rd2[:160])
        pg.click('[data-ovscale="date"]')
        pg.wait_for_timeout(400)

        # ---------------------------------------------------- 5) 새로고침 유지
        pg.evaluate("() => document.querySelector('[data-ovscale=\"pct\"]').click()")
        pg.wait_for_timeout(300)
        pg.reload()
        pg.wait_for_selector('#gTop')
        pg.wait_for_timeout(800)
        pg.evaluate("() => { const b=document.querySelector('[data-toggle=\"crash\"]'); if(b) b.click(); }")
        pg.wait_for_timeout(600)
        kept = pg.evaluate("""() => ({
          scale: [...document.querySelectorAll('[data-ovscale]')].filter(b=>b.classList.contains('on')).map(b=>b.getAttribute('data-ovscale')),
          win: (document.querySelector('#ovWinLab')||{}).textContent,
          on: [...document.querySelectorAll('#ovChips [data-ovcase]')].filter(b=>b.classList.contains('on')).length
        })""")
        check('보기 선택 새로고침 후 유지', kept['scale'] == ['pct'], kept)
        check('창(1년) 새로고침 후 유지', kept['win'] == '1년', kept)
        check('새로고침 뒤에도 사례 전부 켜짐', kept['on'] == len(crashes['cases']), kept)

        e2 = [e for e in errs if 'live.json' not in e and '404' not in e]
        check('콘솔 오류 없음', not e2, e2[:3])
        ctx.close()
        b.close()
    httpd.shutdown()
    print()
    failed = [r for r in results if not r[1]]
    print('총 %d개 · 실패 %d개' % (len(results), len(failed)))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
