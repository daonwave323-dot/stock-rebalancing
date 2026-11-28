#!/usr/bin/env python3
"""반도체(SOXL) 리뉴얼 검증 — 2단계 업황·금리 브레이크 · SOX 8대 폭락장 · 현재(SOX) 상세 · 나스닥 보존.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/ui_soxl_test.py [base_url]

확인
  1) 매수 지표에서 '반도체 SOXL'을 고르면 기존 여섯 지표 점수(원강 님 앱 식)는 그대로이고,
     그 아래 2단계 브레이크(SOX 고점 대비 낙폭·경과 개월·금리 경보)가 data/crashes_sox.json 값과 같게 나온다
  2) 90점을 넘겨도(수동 입력) 반도체는 '매수'가 아니라 '90점 돌파 · 경보'로 내려간다 — 나스닥은 그대로 '계획의 50% 투입'
  3) 희귀도·백테스트 표에 보고서 수치(24건·+8.68%·59.1%)와 재계산·필터 A·B 수치가 같이 있다
  4) 폭락 비교가 SOX 8사례 + 현재로 바뀌고(유형 배지 업황 사이클/경제 위기), 표·카드·겹쳐 보기·경로 표가 모두 SOX 값
  5) 사례 상세(#/gauge/crash/sox-2022)와 현재 상세(#/gauge/crash/sox-now)가 열리고 SOX 값으로 채워진다
  6) 나스닥으로 돌아오면 6사례·^NDX 현재 값 그대로(반도체 자료가 섞이지 않는다) — 왕복 3회 뒤에도 같다
  7) 홈 SOXL 카드·점수 상세(#/score/sox)에 같은 판정·같은 브레이크 수치가 있다(나스닥에는 없다)
  8) 390px·1280px 콘솔 오류 0 · 가로 넘침 0 · 404 0
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'screens-soxl')
results = []
console_errors = []
bad_responses = []


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + str(note) if note else ''))
    return ok


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Handler, directory=ROOT))
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def set_manual_max(pg):
    """수동 모드로 바꾸고 여섯 값을 최대로 — 점수 100을 만든다(2단계 판정 규칙 확인용)."""
    pg.click('[data-toggle="input"]')
    pg.wait_for_timeout(250)
    pg.click('[data-mode="manual"]')
    pg.wait_for_timeout(400)
    if pg.evaluate("()=>{const b=document.querySelector('#gIndsBtn'); return b && b.getAttribute('aria-expanded')==='false'}"):
        pg.click('#gIndsBtn')
        pg.wait_for_timeout(300)
    for key, val in (('dd', '95'), ('wrsi', '10'), ('gap', '-95'), ('drsi', '10'), ('vixr', '3'), ('vixp', '100')):
        pg.evaluate("""(kv) => {
          const el = document.querySelector('[data-num="' + kv[0] + '"]');
          if (!el) return;
          el.value = kv[1];
          el.dispatchEvent(new Event('input', {bubbles: true}));
        }""", [key, val])
        pg.wait_for_timeout(120)
    pg.wait_for_timeout(400)


def main():
    from playwright.sync_api import sync_playwright
    os.makedirs(SHOTS, exist_ok=True)
    sox = json.load(open(os.path.join(ROOT, 'data', 'crashes_sox.json'), encoding='utf-8'))
    scores = json.load(open(os.path.join(ROOT, 'data', 'scores.json'), encoding='utf-8'))
    gauge = json.load(open(os.path.join(ROOT, 'data', 'gauge.json'), encoding='utf-8'))
    soxScore = scores['targets']['sox']['score']
    brake = sox['brake']
    bt = sox['backtest']
    now = sox['now']

    httpd = serve()
    base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:%d/' % httpd.server_address[1]
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=['--no-sandbox'])
            for width in (390, 1280):
                pg = browser.new_page(viewport={'width': width, 'height': 844 if width == 390 else 950})
                pg.add_init_script("try{localStorage.clear()}catch(e){}")   # 앞 시험이 남긴 수동 입력값과 섞이지 않게
                pg.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
                pg.on('pageerror', lambda e: console_errors.append('PAGEERROR ' + str(e)))
                pg.on('response', lambda r: bad_responses.append(r.url) if r.status >= 400 else None)

                # ---------------------------------------------- 1) 매수 지표 · 반도체
                pg.goto(base + '#/gauge', wait_until='networkidle')
                pg.wait_for_timeout(900)
                pg.click('[data-target="sox"]')
                pg.wait_for_timeout(800)
                score_txt = pg.inner_text('#gScore')
                check('[%d] 반도체 점수는 원본 앱 식 그대로' % width, score_txt == ('%g' % soxScore), (score_txt, soxScore))

                gb = pg.evaluate("""() => {
                  const e = document.querySelector('#gBrake');
                  return e ? e.innerText : null;
                }""")
                check('[%d] 2단계 브레이크 블록 있음' % width, bool(gb))
                gb = gb or ''
                check('[%d] 브레이크: SOX 낙폭 값이 자료와 같다' % width, ('%.1f' % brake['dd']) in gb.replace('−', '-'), brake['dd'])
                check('[%d] 브레이크: 경과 개월이 자료와 같다' % width, ('%.1f' % brake['months']) in gb, brake['months'])
                check('[%d] 브레이크: 경보 유지 표시' % width, ('경보 유지' in gb) == (not brake['pass']), brake['pass'])
                check('[%d] 브레이크: 금리·경보 문구' % width, '90점은 매수 신호가 아닌 경보' in gb)

                # ---------------------------------------------- 3) 백테스트 표
                btx = pg.evaluate("()=>{const e=document.querySelector('#gBacktest');return e?e.innerText:null}")
                check('[%d] 백테스트 표 있음' % width, bool(btx))
                btx = btx or ''
                check('[%d] 백테스트: 보고서 수치(24건·+8.68%%·59.1%%)' % width,
                      '24' in btx and '+8.68%' in btx and '59.1%' in btx)
                check('[%d] 백테스트: 재계산·필터 A·필터 B 수치' % width,
                      ('%+.2f%%' % bt['filterA']['213']['mean']) in btx and ('%d건' % bt['filterA']['213']['n']) in btx,
                      bt['filterA']['213'])
                check('[%d] 백테스트: 걸러진 날 목록' % width, bt['filterA']['dates'][0].replace('-', '.') in btx)
                btfit = pg.evaluate("()=>{const e=document.querySelector('#gBacktest .tbl-wrap');return e?{cw:e.clientWidth,sw:e.scrollWidth}:null}")
                check('[%d] 백테스트 표가 390px 화면 안에 들어온다(가로 스크롤 없음)' % width,
                      btfit and btfit['sw'] <= btfit['cw'], btfit)
                check('[%d] 반도체 안내 문구(점수 단독 매수 금지)' % width,
                      pg.evaluate("()=>{const e=document.querySelector('#gSoxNote');return e?e.innerText.includes('점수만으로 매수하지 않습니다'):false}"))

                # ---------------------------------------------- 2) 90점 판정 규칙
                set_manual_max(pg)
                sc_manual = pg.inner_text('#gScore')
                v_manual = pg.inner_text('#gVerdict')
                badge_manual = pg.inner_text('#gBadge')
                check('[%d] 반도체 90점대: 판정이 경보로 내려간다' % width,
                      float(sc_manual) >= 90 and '경보' in v_manual and badge_manual == '경보', (sc_manual, v_manual, badge_manual))
                pg.screenshot(path=os.path.join(SHOTS, 'soxl-verdict-alert-%d.png' % width))

                # ---------------------------------------------- 2b) 수동 입력 → 2단계 브레이크 연동
                base_dd = abs(scores['targets']['sox']['rows'][0]['raw'])   # 확정 SOXL 낙폭(%)
                gb = pg.inner_text('#gBrake')
                derived = abs(brake['dd']) * 95.0 / base_dd
                check('[%d] 수동 낙폭 95%% → SOX 추정 낙폭 비례 환산' % width,
                      ('%.1f' % derived) in gb.replace('−', '-') and '추정' in gb, (derived, gb[:80]))
                check('[%d] 시뮬레이션 입력칸(SOX 낙폭·경과) 있음' % width,
                      pg.evaluate("()=>!!document.querySelector('[data-sim=\"dd\"]') && !!document.querySelector('[data-sim=\"months\"]')"))

                # 경과 9개월로 바꾸면 두 조건 모두 충족 → 판정이 매수 쪽으로
                pg.evaluate("""() => { const el = document.querySelector('[data-sim="months"]');
                  el.value = '9'; el.dispatchEvent(new Event('input', {bubbles:true})); }""")
                pg.wait_for_timeout(500)
                gb2 = pg.inner_text('#gBrake')
                v2 = pg.inner_text('#gVerdict')
                check('[%d] 경과 9개월 → 2단계 조건 충족' % width, '조건 충족' in gb2, gb2[:60])
                check('[%d] 조건 충족 + 100점 → 판정이 계획의 50%% 투입' % width, v2 == '계획의 50% 투입', v2)

                # SOX 낙폭을 20%로 낮추면 바닥권 이탈 → 다시 경보
                pg.evaluate("""() => { const el = document.querySelector('[data-sim="dd"]');
                  el.value = '20'; el.dispatchEvent(new Event('input', {bubbles:true})); }""")
                pg.wait_for_timeout(500)
                gb3 = pg.inner_text('#gBrake')
                v3 = pg.inner_text('#gVerdict')
                check('[%d] SOX 낙폭 20%% → 바닥권 아님 · 경보로 내려감' % width,
                      '경보 유지' in gb3 and '경보' in v3, (gb3[:50], v3))

                # 실제 값으로 되돌리기
                pg.click('#gSimReset')
                pg.wait_for_timeout(500)
                gb4 = pg.inner_text('#gBrake')
                check('[%d] 실제 ^SOX 값 보기 → 자료의 낙폭·경과로 복귀(추정 배지 없음)' % width,
                      ('%.1f' % abs(brake['dd'])) in gb4.replace('−', '-') and ('%.1f' % brake['months']) in gb4 and '추정' not in gb4, gb4[:70])

                # 자동으로 돌리면 실제 값 유지(추정 배지 없음)
                pg.click('[data-mode="auto"]')
                pg.wait_for_timeout(600)
                gb5 = pg.inner_text('#gBrake')
                check('[%d] 자동 복귀 → 추정 배지 없이 실제 값' % width,
                      '추정' not in gb5 and ('%.1f' % abs(brake['dd'])) in gb5.replace('−', '-'), gb5[:60])

                # ---------------------------------------------- 4) 폭락 비교 = SOX 8사례 + 현재
                pg.reload(wait_until='networkidle')
                pg.wait_for_timeout(900)
                if pg.evaluate("()=>document.querySelector('[data-target=\"sox\"]') && !document.querySelector('[data-target=\"sox\"]').classList.contains('on')"):
                    pg.click('[data-target="sox"]')
                    pg.wait_for_timeout(700)
                if pg.evaluate("()=>{const b=document.querySelector('[data-toggle=\"crash\"]');return b && b.getAttribute('aria-expanded')==='false'}"):
                    pg.click('[data-toggle="crash"]')
                    pg.wait_for_timeout(900)
                ids = pg.evaluate("()=>[...document.querySelectorAll('.case-card')].map(a=>a.getAttribute('href').replace('#/gauge/crash/',''))")
                want = [c['id'] for c in sox['cases']] + ['sox-now']
                check('[%d] 카드가 SOX 8사례 + 현재' % width, ids == want, ids)
                badges = pg.evaluate("()=>[...document.querySelectorAll('.g-sec[data-sec=crash] .badge')].map(b=>b.textContent)")
                check('[%d] 유형 배지(업황 사이클/경제 위기) 8개 이상' % width,
                      badges.count('업황 사이클') >= 6 and badges.count('경제 위기') >= 2,
                      (badges.count('업황 사이클'), badges.count('경제 위기')))
                dd_now = pg.inner_text('#ovNowDd')
                check('[%d] 겹쳐 보기 현재 낙폭 = ^SOX 값' % width, dd_now == '%+.1f%%' % now['dd_now'], (dd_now, now['dd_now']))
                ovsrc = pg.inner_text('#ovBasis')
                check('[%d] 겹쳐 보기 기준 줄이 ^SOX' % width, '^SOX' in ovsrc, ovsrc[:60])
                rows = pg.evaluate("()=>[...document.querySelectorAll('.g-sec[data-sec=crash] table tbody tr')].length")
                check('[%d] 닮은 날 표 9 + 경로 표 9 = 18행' % width, rows == 18, rows)
                check('[%d] 오늘(현재) 줄이 진행 중 · SOX' % width,
                      pg.evaluate("()=>{const r=[...document.querySelectorAll('.g-nowrow')];return r.length? r.every(x=>x.innerText.includes('SOX')):false}"))

                # 닮은 날 거리가 자료와 같다
                near = min([c for c in sox['cases']], key=lambda c: c['now_match']['distance'])
                matchtxt = pg.inner_text('#gNowMatch')
                check('[%d] 가장 닮은 날이 자료와 같다' % width,
                      near['now_match']['date'].replace('-', '.') in matchtxt and ('%.2f' % near['now_match']['distance']) in matchtxt,
                      (near['id'], near['now_match']['date'], near['now_match']['distance']))

                # ---------------------------------------------- 5) 상세 페이지
                pg.goto(base + '#/gauge/crash/sox-2022', wait_until='networkidle')
                pg.wait_for_timeout(900)
                h1 = pg.inner_text('h1') if pg.query_selector('h1') else ''
                det = pg.evaluate("()=>{const e=document.querySelector('#gCase');return e?e.innerText:''}")
                chart = pg.evaluate("()=>{const e=document.querySelector('#gCaseChart');return e?e.innerHTML.length:0}")
                c22 = [c for c in sox['cases'] if c['id'] == 'sox-2022'][0]
                check('[%d] 사례 상세 sox-2022 열림' % width, '2022' in h1 and ('%.1f' % c22['dd']) in det, h1)
                check('[%d] 사례 상세 경로 차트 그려짐' % width, chart > 800, chart)
                check('[%d] 사례 상세: SOXL 90점 첫 돌파 값' % width, '90점 첫 돌파' in det and (c22['first90'] or '') in det)
                nav = pg.evaluate("()=>[...document.querySelectorAll('.btn.ghost.sm')].map(a=>a.getAttribute('href'))")
                check('[%d] 사례 상세 이전/다음이 SOX 안에서만' % width,
                      all((h is None) or ('#/gauge/crash/sox-' in h or h == '#/gauge/crash') for h in nav), nav[:4])

                pg.goto(base + '#/gauge/crash/sox-now', wait_until='networkidle')
                pg.wait_for_timeout(900)
                hh = pg.evaluate("()=>document.querySelector('h1')?document.querySelector('h1').textContent:''")
                body = pg.inner_text('body')
                chart2 = pg.evaluate("()=>{const e=document.querySelector('#gCaseChart');return e?e.innerHTML.length:0}")
                check('[%d] 현재 상세(SOX) 열림' % width, '현재' in hh and ('^SOX' in body))
                check('[%d] 현재 상세: SOX 고점·저점 값' % width,
                      ('%.1f' % now['dd']) in body.replace('−', '-') and ('%.1f' % now['dd_now']) in body.replace('−', '-'))
                check('[%d] 현재 상세 경로 차트 그려짐' % width, chart2 > 800, chart2)
                chart_txt = pg.evaluate("()=>{const e=document.querySelector('#gCaseChart');return e?e.innerText:''}")
                check('[%d] 현재 상세 차트가 SOX 저점·최저 낙폭을 찍는다' % width,
                      ('%.1f%%' % abs(now['dd'])).replace('-', '') in chart_txt.replace('−', '-'),
                      chart_txt[:60])
                check('[%d] 현재 상세: 고점 이후 거래일·저점 날짜' % width,
                      ('%d거래일' % (now['lastI'] - now['peakI'])) in body and now['trough'].replace('-', '.') in body,
                      (now['lastI'] - now['peakI'], now['trough']))

                # ---------------------------------------------- 6) 나스닥 복귀
                pg.goto(base + '#/gauge', wait_until='networkidle')
                pg.wait_for_timeout(900)
                pg.click('[data-target="ndx"]')
                pg.wait_for_timeout(800)
                if pg.evaluate("()=>{const b=document.querySelector('[data-toggle=\"crash\"]');return b && b.getAttribute('aria-expanded')==='false'}"):
                    pg.click('[data-toggle="crash"]')
                    pg.wait_for_timeout(800)
                nids = pg.evaluate("()=>[...document.querySelectorAll('.case-card')].map(a=>a.getAttribute('href').replace('#/gauge/crash/',''))")
                check('[%d] 나스닥은 기존 6사례 + 현재' % width, nids == ['c1929', 'c1987', 'c2000', 'c2008', 'c2020', 'c2025', 'now'], nids)
                ndd = pg.inner_text('#ovNowDd')
                check('[%d] 나스닥 현재 낙폭 = ^NDX 값' % width, ndd != dd_now, (ndd, dd_now))
                check('[%d] 나스닥에는 2단계 브레이크·백테스트 없음' % width,
                      pg.evaluate("()=>!document.querySelector('#gBrake') && !document.querySelector('#gBacktest')"))

                # 왕복 3회 — 값이 섞이지 않는지
                mixed = []
                for i in range(3):
                    pg.click('[data-target="sox"]')
                    pg.wait_for_timeout(450)
                    s = (pg.inner_text('#gScore'), pg.inner_text('#ovNowDd'),
                         pg.evaluate("()=>document.querySelectorAll('.case-card').length"))
                    pg.click('[data-target="ndx"]')
                    pg.wait_for_timeout(450)
                    n = (pg.inner_text('#gScore'), pg.inner_text('#ovNowDd'),
                         pg.evaluate("()=>document.querySelectorAll('.case-card').length"))
                    mixed.append((s, n))
                check('[%d] SOXL↔TQQQ 왕복 3회 값 고정' % width,
                      len(set(tuple(m) for m in mixed)) == 1 and mixed[0][0][2] == 9 and mixed[0][1][2] == 7, mixed[0])

                # ---------------------------------------------- 7) 홈 카드 · 점수 상세
                pg.goto(base + '#/', wait_until='networkidle')
                pg.wait_for_timeout(900)
                home = pg.evaluate("()=>{const c=document.querySelector('.score-card.sox');return c?c.innerText:''}")
                check('[%d] 홈 SOXL 카드에 2단계 요약' % width,
                      '2단계' in home and ('%.1f' % abs(brake['dd'])) in home.replace('−', '-') and ('%.1f' % brake['months']) in home)
                check('[%d] 홈 SOXL 카드가 매수 지표와 같은 점수' % width, ('%g' % soxScore) in home, home[:40])
                homeN = pg.evaluate("()=>{const c=document.querySelector('.score-card');return c?c.innerText:''}")
                check('[%d] 홈 TQQQ 카드에는 2단계 없음' % width, '2단계' not in homeN)

                pg.goto(base + '#/score/sox', wait_until='networkidle')
                pg.wait_for_timeout(900)
                body = pg.inner_text('body')
                check('[%d] 점수 상세 SOX: 브레이크·백테스트 패널' % width,
                      '2단계 · 업황·금리 브레이크' in body and '+8.68%' in body and '필터 A' in body)
                check('[%d] 점수 상세 SOX: 점수가 매수 지표와 같다' % width, pg.inner_text('.score-big').startswith('%g' % soxScore))
                pg.goto(base + '#/score/ndx', wait_until='networkidle')
                pg.wait_for_timeout(700)
                check('[%d] 점수 상세 나스닥에는 브레이크 없음' % width,
                      '2단계 · 업황·금리 브레이크' not in pg.inner_text('body'))

                # ---------------------------------------------- 8) 넘침·오류
                pg.goto(base + '#/gauge', wait_until='networkidle')
                pg.wait_for_timeout(700)
                pg.click('[data-target="sox"]')
                pg.wait_for_timeout(700)
                pg.click('[data-toggle="crash"]')
                pg.wait_for_timeout(800)
                ov = pg.evaluate("()=>document.documentElement.scrollWidth - document.documentElement.clientWidth")
                check('[%d] 가로 넘침 0' % width, ov <= 0, ov)
                pg.locator('.g-card').scroll_into_view_if_needed()
                pg.screenshot(path=os.path.join(SHOTS, 'soxl-test-gauge-%d.png' % width))
                pg.locator('.g-sec[data-sec=crash]').scroll_into_view_if_needed()
                pg.screenshot(path=os.path.join(SHOTS, 'soxl-test-crash-%d.png' % width))
                pg.close()
            browser.close()
    finally:
        httpd.shutdown()

    check('콘솔 오류 0', not console_errors, console_errors[:4])
    check('404 0', not bad_responses, bad_responses[:4])
    fails = [r for r in results if not r[1]]
    print('\n총 %d개 · 실패 %d개' % (len(results), len(fails)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
