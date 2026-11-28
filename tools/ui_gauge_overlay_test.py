#!/usr/bin/env python3
"""매수 지표 — 최근 한 달 일봉 · 겹쳐 보기(낙폭 % / 고점=100 / 저점=100 · 현재 선 · 창 슬라이더) 검증.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/ui_gauge_overlay_test.py

확인
  1) 최근 한 달 일봉: 봉 수·첫/끝 날짜가 자료와 같고, 지표를 손대면 '지금' 점이 움직인다
  2) 겹쳐 보기: 칩줄이 [전체] 1929→2025 [현재] 순서, 처음엔 모두 켜짐, 제목이 사례 수와 맞음
  3) 보기 눈금은 낙폭 %(기본) · 고점=100 · 저점=100 셋 — '날짜' 보기는 없다
  4) '현재' 선은 사례 선과 같은 ^NDX 계열 — 수직 낙하 없이 이어지고, TQQQ/SOXL을 바꿔도 그대로
  5) '현재' 칩을 끄면 선·라벨·현재 낙폭 숫자가 함께 사라지고, 다시 켜면 돌아온다
  6) 창 슬라이더 6개월~3년 — 축 범위·눈금·캡션이 함께 바뀐다
  7) 새로 고침 후 보기·창 유지
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

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
    now_dd = crashes['now']['dd']

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
            pg.wait_for_selector('#gTop', timeout=15000)
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
        pg.wait_for_timeout(900)
        chips = pg.evaluate("""() => {
          const all = [...document.querySelectorAll('#ovChips .chip')];
          return {names: all.map(b => b.textContent.trim()), n: all.length,
                  on: all.filter(b=>b.classList.contains('on')).length,
                  casesOn: [...document.querySelectorAll('#ovChips [data-ovcase]')].filter(b=>b.classList.contains('on')).length};
        }""")
        years = [c['short'] for c in sorted(crashes['cases'], key=lambda c: c['peak'])]
        check('칩줄 순서 [전체] 연도 오름차순 [현재]',
              chips['names'] == ['전체'] + years + ['현재'], chips['names'])
        check('사례 칩 6개 모두 켜짐', chips['casesOn'] == len(crashes['cases']), chips)
        check('처음엔 전체·현재도 켜짐', chips['on'] == chips['n'], chips)
        body = pg.inner_text('#view')
        check('제목이 사례 수(6개 시점)와 맞다', '%d개 시점' % len(crashes['cases']) in body)

        # ---------------------------------------------------- 3) 보기 눈금
        d0 = pg.evaluate("""() => {
          const svg = document.querySelector('#ovChart svg');
          const texts = [...svg.querySelectorAll('text')].map(e=>e.textContent);
          const o = document.querySelector('#ovChart').__ov;
          return {paths: svg.querySelectorAll('path').length, texts,
                  scales: [...document.querySelectorAll('[data-ovscale]')].map(b=>b.getAttribute('data-ovscale')),
                  on: [...document.querySelectorAll('[data-ovscale]')].filter(b=>b.classList.contains('on')).map(b=>b.getAttribute('data-ovscale')),
                  todayPts: o.todayPts.slice(-2), confOffset: o.today.confOffset, offset: o.today.offset };
        }""")
        check("'날짜' 보기 버튼이 없다", 'date' not in d0['scales'], d0['scales'])
        check('보기 눈금 셋(저점·고점·낙폭%)', d0['scales'] == ['trough', 'peak', 'pct'], d0['scales'])
        check('기본 보기가 낙폭 %', d0['on'] == ['pct'], d0['on'])
        check('낙폭 %: 사례 6 + 현재 1 = 선 7개', d0['paths'] == len(crashes['cases']) + 1, d0['paths'])
        check("'현재' 이름표 있음", '현재' in d0['texts'], d0['texts'][-6:])
        check('현재 낙폭 큰 숫자가 차트 현재 점과 같다',
              abs(float(pg.inner_text('#ovNowDd').replace('%', '').replace('+', '')) - d0['todayPts'][-1][1]) < 0.06,
              (pg.inner_text('#ovNowDd'), d0['todayPts'][-1][1]))
        # 수직 낙하 없음 — 마지막 확정 점과 현재 점의 차이
        gap = pg.evaluate("""() => {
          const o = document.querySelector('#ovChart').__ov;
          const a = o.today.peak[o.today.confOffset], b = o.today.peak[o.today.offset];
          return Math.abs(b[1] - a[1]);
        }""")
        check('현재 점이 마지막 확정 점에서 수직 낙하하지 않는다(±3%p 안)', gap < 3, round(gap, 2))
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-overlay.png'))

        # 대상 칩을 바꾸면 폭락 비교도 그 대상의 자료로 바뀐다(2026-11-28 반도체 리뉴얼)
        #   나스닥 = ^NDX 6사례 · 현재 낙폭 ^NDX / 반도체 = SOX 8사례 · 현재 낙폭 ^SOX(자료값)
        before = pg.inner_text('#ovNowDd')
        pg.click('[data-target="sox"]')
        pg.wait_for_timeout(700)
        after = pg.inner_text('#ovNowDd')
        soxNow = json.load(open(os.path.join(ROOT, 'data', 'crashes_sox.json'), encoding='utf-8'))['now']['dd_now']
        check('반도체로 바꾸면 현재 낙폭이 ^SOX 값으로 바뀐다', after == '%+.1f%%' % soxNow, (before, after, soxNow))
        chipsS = pg.evaluate("()=>[...document.querySelectorAll('[data-ovcase]')].map(b=>b.getAttribute('data-ovcase'))")
        check('반도체로 바꾸면 겹쳐 보기 사례 칩이 SOX 8사례', chipsS == ['sox-1996', 'sox-1998', 'sox-2000', 'sox-2004', 'sox-2008', 'sox-2020', 'sox-2022', 'sox-2025'], chipsS)
        pg.click('[data-target="ndx"]')
        pg.wait_for_timeout(600)
        back = pg.inner_text('#ovNowDd')
        chipsN = pg.evaluate("()=>[...document.querySelectorAll('[data-ovcase]')].map(b=>b.getAttribute('data-ovcase'))")
        check('나스닥으로 돌아오면 현재 낙폭·사례 칩이 원래대로', back == before and len(chipsN) == 6, (back, before, len(chipsN)))

        # ---------------------------------------------------- 4) 현재 토글
        pg.click('[data-ovtoday]')
        pg.wait_for_timeout(500)
        off = pg.evaluate("""() => {
          const o = document.querySelector('#ovChart').__ov;
          return {n: o.todayPts.length, texts: [...document.querySelectorAll('#ovChart svg text')].map(t=>t.textContent),
                  big: document.querySelector('#ovNowBig').style.display,
                  readout: document.querySelector('#ovReadout').textContent};
        }""")
        check('현재 끄면 선 사라짐', off['n'] == 0 and '현재' not in off['texts'], off['texts'][-5:])
        check('현재 끄면 현재 낙폭 숫자도 숨김', off['big'] == 'none', off['big'])
        check('현재 끄면 판독값에도 현재 없음', '현재' not in off['readout'], off['readout'][:60])
        pg.click('[data-ovtoday]')
        pg.wait_for_timeout(500)
        on = pg.evaluate("""() => ({n: document.querySelector('#ovChart').__ov.todayPts.length,
          big: document.querySelector('#ovNowBig').style.display,
          chip: document.querySelector('[data-ovtoday]').classList.contains('on')})""")
        check('다시 켜면 선·숫자 복귀', on['n'] > 1 and on['big'] != 'none' and on['chip'], on)

        # 전체 토글
        pg.click('[data-ovall]')
        pg.wait_for_timeout(400)
        alloff = pg.evaluate("() => [...document.querySelectorAll('#ovChips .chip')].map(b=>b.classList.contains('on'))")
        check('전체 누르면 모두 꺼짐', not any(alloff), alloff)
        pg.click('[data-ovall]')
        pg.wait_for_timeout(400)
        allon = pg.evaluate("""() => ({chips: [...document.querySelectorAll('#ovChips .chip')].map(b=>b.classList.contains('on')),
          n: document.querySelector('#ovChart').__ov.series.length})""")
        check('전체 다시 누르면 모두 켜짐', all(allon['chips']) and allon['n'] == len(crashes['cases']), allon)

        # ---------------------------------------------------- 5) 창 슬라이더 6개월~3년
        def window_state():
            return pg.evaluate("""() => {
              const texts = [...document.querySelectorAll('#ovChart svg text')].map(e=>e.textContent);
              return {win: (document.querySelector('#ovWinLab')||{}).textContent, texts,
                      cap: (document.querySelector('#ovCaption')||{}).textContent,
                      saved: localStorage.getItem('stockrebal.crashWin')};
            }""")
        w1 = window_state()
        check('창 기본 1년', w1['win'] == '1년', w1['win'])
        for val, lab in (('0.5', '6개월'), ('1.5', '1년 6개월'), ('2', '2년'), ('3', '3년')):
            pg.evaluate("() => { const s=document.querySelector('#ovWin'); s.value='%s'; s.dispatchEvent(new Event('input',{bubbles:true})); }" % val)
            pg.wait_for_timeout(500)
            wv = window_state()
            check('창 %s 슬라이더' % lab, wv['win'] == lab and wv['saved'] in ('"%s"' % val, val), (wv['win'], wv['saved']))
        # 저점 보기에서 축·캡션이 고른 기간을 따른다
        pg.click('[data-ovscale="trough"]')
        pg.wait_for_timeout(500)
        tr3 = pg.evaluate("() => [...document.querySelectorAll('#ovChart svg text')].map(e=>e.textContent)")
        check('저점 보기 축이 ±3년', any('−3년' in x for x in tr3) and any('+3년' in x for x in tr3), tr3[:8])
        check('저점 보기 캡션에 3년', '3년' in pg.inner_text('#ovCaption'), pg.inner_text('#ovCaption')[:70])
        pg.evaluate("() => { const s=document.querySelector('#ovWin'); s.value='0.5'; s.dispatchEvent(new Event('input',{bubbles:true})); }")
        pg.wait_for_timeout(500)
        tr05 = pg.evaluate("() => [...document.querySelectorAll('#ovChart svg text')].map(e=>e.textContent)")
        check('저점 보기 축이 ±6개월', any('−6개월' in x for x in tr05) and any('+6개월' in x for x in tr05), tr05[:8])
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-overlay-6m.png'))
        pg.evaluate("() => { const s=document.querySelector('#ovWin'); s.value='1'; s.dispatchEvent(new Event('input',{bubbles:true})); }")
        pg.wait_for_timeout(400)
        pg.evaluate("() => document.querySelector('[data-ovscale=\"pct\"]').click()")
        pg.wait_for_timeout(400)

        # ---------------------------------------------------- 6) 새로고침 유지
        pg.reload()
        pg.wait_for_selector('#gTop')
        pg.wait_for_timeout(900)
        pg.evaluate("() => { const b=document.querySelector('[data-toggle=\"crash\"]'); if(b) b.click(); }")
        pg.wait_for_timeout(900)
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
