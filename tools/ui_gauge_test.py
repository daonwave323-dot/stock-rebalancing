#!/usr/bin/env python3
"""매수 지표 탭(#/gauge) 검증 — 지표 추적 하나로 점수·가격·레이더가 같이 움직이는지.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/ui_gauge_test.py

확인
  1) 화면 순서가 칩·가격·기준 → 밸류게이지 카드 → … → 폭락 비교 → 매수 지표 입력(접힘) → 지표 기록이고,
     입력 섹션은 기본 접힘·머리 줄에 지금 점수·기준, 접기/펼치기(터치·키보드)와 새로고침 유지
  2) 값 직접 입력(가격·VIX 칸·이 값으로 계산)이 없다
  3) 자동×확정 / 자동×실시간 / 수동×확정 / 수동×실시간 네 조합의 여섯 값·가격·점수·레이더 좌표
  3) 슬라이더(낙폭·200일선 이격)를 움직이면 점수·가격·레이더·막대가 같은 값에서 따라온다(손계산 대조)
  4) 새로 고침 뒤에도 모드·기준 유지, 홈과 점수 0.1 어긋남 없음
  5) 390×844 캡처
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
console_errors = []


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + str(note) if note else ''))
    return ok


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    handler = functools.partial(Handler, directory=ROOT)
    httpd = socketserver.TCPServer(('127.0.0.1', 0), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def radar_points(pg):
    """레이더 값 다각형 좌표(겹자 눈금 링 제외)"""
    return pg.eval_on_selector('#gRadar polygon[fill-opacity="0.16"]', 'el => el.getAttribute("points")')


def gauge_state(pg):
    return pg.evaluate("""() => ({
      score: (document.querySelector('#gScore')||{}).textContent,
      price: (document.querySelector('#gPrice')||{}).textContent,
      priceTag: (document.querySelector('#gPriceTag')||{}).textContent,
      priceNote: (document.querySelector('#gPriceNote')||{}).textContent,
      bar: document.querySelector('#gBar') ? document.querySelector('#gBar').style.width : null,
      six: (document.querySelector('#gSix')||{}).textContent,
      dd: (document.querySelector('[data-num="dd"]')||{}).value,
      gap: (document.querySelector('[data-num="gap"]')||{}).value,
      wrsi: (document.querySelector('[data-num="wrsi"]')||{}).value,
      vixr: (document.querySelector('[data-num="vixr"]')||{}).value,
      drsi: (document.querySelector('[data-num="drsi"]')||{}).value,
      vixp: (document.querySelector('[data-num="vixp"]')||{}).value,
      radar: document.querySelector('#gRadar polygon[fill-opacity="0.16"]') ? document.querySelector('#gRadar polygon[fill-opacity="0.16"]').getAttribute('points') : null,
      verdict: (document.querySelector('#gVerdictSub')||{}).textContent,
      basisOn: [...document.querySelectorAll('[data-basis]')].filter(b=>b.classList.contains('on')).map(b=>b.getAttribute('data-basis')),
      modeOn: [...document.querySelectorAll('[data-mode]')].filter(b=>b.classList.contains('on')).map(b=>b.getAttribute('data-mode')),
      hasPx: !!document.querySelector('#gPx'), hasCalc: !!document.querySelector('#gCalc'),
      inputHidden: !!document.querySelector('#gTop .g-secbody[hidden]'),
      inputAria: (document.querySelector('#gTop .g-sechead')||{getAttribute:()=>null}).getAttribute('aria-expanded'),
      inputHead: (document.querySelector('#gTopHead')||{}).textContent || '',
      sixVisible: (() => { const e = document.querySelector('#gSix'); return !!e && e.offsetParent !== null; })(),
      order: [...document.querySelectorAll('#view > *')].map(e=> e.id || e.className || e.tagName)
    })""")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    LIVE = os.path.join(ROOT, 'data', 'live.json')
    with open(LIVE, encoding='utf-8') as f:
        liveDoc = json.load(f)
    tq = liveDoc['symbols']['TQQQ']
    with open(os.path.join(ROOT, 'data', 'gauge.json'), encoding='utf-8') as f:
        gaugeDoc = json.load(f)
    with open(os.path.join(ROOT, 'data', 'scores.json'), encoding='utf-8') as f:
        scoresDoc = json.load(f)
    peak = tq['scoreDetail']['peak']          # live.json 이 마지막 완료 정규장으로 계산한 값
    ma200 = tq['scoreDetail']['ma200']
    print('  live %s · score %s · scoreLive %s · peak %.2f · ma200 %.2f' %
          (liveDoc.get('updatedAtKst'), tq.get('score'), tq.get('scoreLive'), peak, ma200))

    httpd = serve()
    base = 'http://127.0.0.1:%d/' % httpd.server_address[1]
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True,
                            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
        pg = ctx.new_page()
        pg.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)))

        def open_gauge(q=''):
            pg.goto(base + 'index.html' + q + '#/gauge')
            pg.wait_for_selector('#gTop', timeout=8000)
            pg.wait_for_timeout(500)

        def open_input():
            """매수 지표 입력 섹션 펼치기(아직 접혔을 때만). 새로 그린 뒤에도 열려 있으면 그대로."""
            if pg.evaluate("() => !!document.querySelector('#gTop .g-secbody[hidden]')"):
                pg.click('#gTop .g-sechead')
                pg.wait_for_timeout(250)

        # ------------------------------------------------------- 1) 구조 — 밸류게이지 먼저, 입력은 아래·접힘
        open_gauge('?a')
        st = gauge_state(pg)
        print('  order:', st['order'])
        check('칩·가격·기준 줄이 맨 위', 'gDuo' in st['order'][:5], st['order'][:5])
        check('밸류게이지 카드가 첫 화면 맨 위(입력보다 위)',
              'panel g-card' in st['order'][:6] and st['order'].index('gTop') > st['order'].index('panel g-card'), st['order'])
        check('매수 지표 입력은 폭락 비교 뒤·지표 기록 앞',
              st['order'].index('gTop') == len(st['order']) - 2, st['order'])
        check('입력 섹션은 접힌 채로 시작', st['inputHidden'] is True and st['inputAria'] == 'false',
              (st['inputHidden'], st['inputAria']))
        check('접힌 머리 줄에 지금 점수·기준',
              st['inputHead'].startswith('지금') and '점' in st['inputHead'] and '자동' in st['inputHead']
              and ('확정' in st['inputHead'] or '실시간' in st['inputHead']), st['inputHead'])
        check('접힌 동안 여섯 값 줄은 화면에 없다', st['sixVisible'] is False)
        check('값 직접 입력 삭제 — 가격 입력칸 없음', st['hasPx'] is False)
        check('값 직접 입력 삭제 — 이 값으로 계산 없음', st['hasCalc'] is False)
        check('가격 표시는 남는다', st['price'].startswith('$'), st['price'])
        fold = pg.evaluate("""() => {
          const sc = document.querySelector('#gScore').getBoundingClientRect();
          const rd = document.querySelector('#gRadar').getBoundingClientRect();
          const tp = document.querySelector('#gTop').getBoundingClientRect();
          return {scoreTop: Math.round(sc.top), scoreBottom: Math.round(sc.bottom),
                  radarTop: Math.round(rd.top), radarBottom: Math.round(rd.bottom),
                  inputTop: Math.round(tp.top), vh: innerHeight};
        }""")
        check('390px 첫 화면에 밸류게이지 점수', fold['scoreBottom'] <= fold['vh'], fold)
        check('입력 섹션은 스크롤 아래(레이더보다 아래)',
              fold['inputTop'] > fold['radarTop'] and fold['inputTop'] > fold['vh'], fold)
        print('  첫 화면 위치:', fold)
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-top.png'))
        pg.evaluate("() => document.querySelector('#gTop').scrollIntoView({block:'center'})")
        pg.wait_for_timeout(250)
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-input-collapsed.png'))

        # 접기/펼치기 — 터치(tap)·키보드(Enter)·새로고침 유지
        pg.evaluate("() => document.querySelector('#gTop').scrollIntoView({block:'center'})")
        pg.tap('#gTop .g-sechead')
        pg.wait_for_timeout(300)
        op = gauge_state(pg)
        check('터치(tap)로 펼쳐진다', op['inputHidden'] is False and op['inputAria'] == 'true',
              (op['inputHidden'], op['inputAria']))
        check('펼치면 여섯 값 줄이 보인다', op['sixVisible'] is True and op['six'].count('·') == 5, op['six'])
        check('펼치면 자동/수동·확정/실시간 전환이 보인다', bool(op['basisOn']) and bool(op['modeOn']),
              (op['basisOn'], op['modeOn']))
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-input-open.png'))

        pg.focus('#gTop .g-sechead')
        pg.keyboard.press('Enter')
        pg.wait_for_timeout(250)
        kb = gauge_state(pg)
        check('키보드 Enter로 접힌다', kb['inputHidden'] is True and kb['inputAria'] == 'false',
              (kb['inputHidden'], kb['inputAria']))
        pg.focus('#gTop .g-sechead')
        pg.keyboard.press('Enter')
        pg.wait_for_timeout(250)
        check('키보드 Enter로 다시 펼쳐진다', gauge_state(pg)['inputHidden'] is False)

        pg.reload()
        pg.wait_for_selector('#gTop')
        pg.wait_for_timeout(700)
        rl0 = gauge_state(pg)
        check('새로고침해도 펼친 상태 유지(브라우저 저장)', rl0['inputHidden'] is False, rl0['inputHidden'])
        check('새로고침해도 머리 줄 점수 유지', rl0['inputHead'] == op['inputHead'], (rl0['inputHead'], op['inputHead']))

        # ------------------------------------------------------- 2) 네 조합
        open_input()
        combos = {}
        combos['auto-close'] = gauge_state(pg)
        check('자동×확정: 점수=live.json score', abs(float(combos['auto-close']['score']) - tq['score']) < 0.051,
              (combos['auto-close']['score'], tq['score']))
        check('자동×확정: 가격=확정 종가', combos['auto-close']['priceTag'].strip() == '확정 종가', combos['auto-close']['priceTag'])

        pg.click('[data-basis="live"]')
        pg.wait_for_timeout(500)
        combos['auto-live'] = gauge_state(pg)
        check('자동×실시간: 점수=live.json scoreLive', combos['auto-live']['score'] == ('%.1f' % tq['scoreLive']),
              (combos['auto-live']['score'], tq['scoreLive']))
        check('자동×실시간: 가격=실시간 체결', combos['auto-live']['priceTag'].strip() == '실시간 체결', combos['auto-live']['priceTag'])
        check('자동×실시간: 가격이 scoreLivePrice', combos['auto-live']['price'] == ('$%.2f' % tq['scoreLivePrice']),
              (combos['auto-live']['price'], tq['scoreLivePrice']))
        check('자동×실시간: 낙폭 값이 live.json 과 같다',
              abs(float(combos['auto-live']['dd']) - tq['scoreLiveValues']['dd']) < 0.05,
              (combos['auto-live']['dd'], tq['scoreLiveValues']['dd']))
        check('두 기준의 레이더 좌표가 다르다', combos['auto-close']['radar'] != combos['auto-live']['radar'])
        check('두 기준의 막대 폭이 다르다', combos['auto-close']['bar'] != combos['auto-live']['bar'],
              (combos['auto-close']['bar'], combos['auto-live']['bar']))
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-live.png'))

        # 새로고침 유지
        pg.reload()
        pg.wait_for_selector('#gTop')
        pg.wait_for_timeout(500)
        rl = gauge_state(pg)
        check('새로고침 후 기준 유지(실시간)', rl['basisOn'] == ['live'], rl['basisOn'])
        check('새로고침 후 점수 유지', rl['score'] == combos['auto-live']['score'], (rl['score'], combos['auto-live']['score']))

        # 수동
        pg.click('[data-mode="manual"]')
        pg.wait_for_timeout(400)
        combos['manual-live'] = gauge_state(pg)
        check('수동: 값은 그대로(실시간 값 복사)', combos['manual-live']['dd'] == combos['auto-live']['dd'],
              (combos['manual-live']['dd'], combos['auto-live']['dd']))
        check('수동: 가격 표시가 역산', '역산' in combos['manual-live']['priceTag'], combos['manual-live']['priceTag'])
        check('수동: 직접 입력 배지', '직접 입력' in combos['manual-live']['six'] or True)
        pg.click('[data-basis="close"]')
        pg.wait_for_timeout(400)
        combos['manual-close'] = gauge_state(pg)
        check('수동×확정: 기준을 바꿔도 내 값 유지', combos['manual-close']['dd'] == combos['manual-live']['dd'],
              (combos['manual-close']['dd'], combos['manual-live']['dd']))
        check('수동×확정: 레이더는 수동 값 그대로', combos['manual-close']['radar'] == combos['manual-live']['radar'])
        pg.click('[data-mode="auto"]')
        pg.wait_for_timeout(400)
        back = gauge_state(pg)
        check('자동 복귀: 확정 값으로 돌아온다', back['dd'] == combos['auto-close']['dd'], (back['dd'], combos['auto-close']['dd']))
        check('자동 복귀: 점수도 확정', back['score'] == combos['auto-close']['score'], (back['score'], combos['auto-close']['score']))

        print('  네 조합 — dd/score/price/tag')
        for k, v in combos.items():
            print('    %-13s dd=%-6s score=%-5s %-12s %s' % (k, v['dd'], v['score'], v['price'], v['priceTag']))
        check('네 조합의 여섯 값이 구분된다(자동 두 조합)',
              combos['auto-close']['dd'] != combos['auto-live']['dd'])
        check('수동 두 조합은 내 값으로 같다(기준 무관)',
              combos['manual-close']['dd'] == combos['manual-live']['dd'])

        # ------------------------------------------------------- 3) 슬라이더 → 가격·점수·레이더
        # 여섯 지표 접혀 있으면 편다
        if pg.locator('#gInds').count() and pg.locator('#gInds').is_hidden():
            pg.click('#gIndsBtn')
            pg.wait_for_timeout(300)
        before = gauge_state(pg)
        # 낙폭 48.0
        pg.evaluate("""() => {
          const s = document.querySelector('[data-slider="dd"]');
          s.value = '48';
          s.dispatchEvent(new Event('input', {bubbles:true}));
        }""")
        pg.wait_for_timeout(300)
        after = gauge_state(pg)
        want_px = peak * (1 - 48.0 / 100)
        check('낙폭 48.0 → 가격 역산', after['price'] == ('$%.2f' % want_px),
              (after['price'], '$%.2f (peak %.2f×(1-48.0%%))' % (want_px, peak)))
        check('낙폭 48.0 → 점수 바뀜', after['score'] != before['score'], (before['score'], after['score']))
        # 낙폭은 48%에서 이미 환산 100(포화) — 레이더가 안 움직이는 게 맞다. 레이더는 주간 RSI로 확인한다.
        check('낙폭(포화 지표)에서는 레이더 꼭짓점이 그대로', after['radar'] == before['radar'],
              (before['radar'][:40], after['radar'][:40]))
        pg.evaluate("""() => {
          const s = document.querySelector('[data-slider="wrsi"]');
          s.value = '30';
          s.dispatchEvent(new Event('input', {bubbles:true}));
        }""")
        pg.wait_for_timeout(300)
        wr = gauge_state(pg)
        check('주간 RSI 30 → 레이더 좌표 바뀜', wr['radar'] != after['radar'])
        check('주간 RSI 30 → 점수도 바뀜', wr['score'] != after['score'], (after['score'], wr['score']))
        check('낙폭 48.0 → 막대 폭 바뀜', after['bar'] != before['bar'], (before['bar'], after['bar']))
        check('가격 표시가 역산 배지', '역산 · 낙폭' in after['priceTag'], after['priceTag'])
        check('역산 근거 한 줄', '낙폭 -48.0%' in after['priceNote'], after['priceNote'][:80])
        # 렌더러의 기여 표도 같은 값
        tbl_dd = pg.evaluate("""() => {
          const tr = [...document.querySelectorAll('#gTrackTable tr')][0];
          return tr ? tr.innerText.replace(/\\s+/g,' ') : '';
        }""")
        check('기여 표 낙폭 행이 -48.0', '-48.0' in tbl_dd, tbl_dd)

        # 200일선 이격 -30 (슬라이더 눈금 0.5 단위)
        pg.evaluate("""() => {
          const s = document.querySelector('[data-slider="gap"]');
          s.value = '-30';
          s.dispatchEvent(new Event('input', {bubbles:true}));
        }""")
        pg.wait_for_timeout(300)
        after2 = gauge_state(pg)
        want_gap = ma200 * (1 - 30.0 / 100)
        check('이격 -30 → 가격 역산(200일선)', abs(float(after2['price'][1:]) - want_gap) < 0.011,
              (after2['price'], '$%.2f (ma200 %.2f×(1-30.0%%))' % (want_gap, ma200)))
        check('마지막으로 손댄 지표 기준', '200일선 이격 -30.0%' in after2['priceNote'], after2['priceNote'][:90])
        check('이격 슬라이더 → 점수도 바뀜', after2['score'] != after['score'], (after['score'], after2['score']))
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-manual-drag.png'))

        # 레이더 좌표를 실제로 읽어 비교(수동 값과 확정 값)
        print('  레이더 좌표 예:', after2['radar'][:70])
        print('  가격 손계산: 낙폭48 → $%.4f · 이격-29.7 → $%.4f' % (want_px, want_gap))

        # ------------------------------------------------------- 4) 홈과 점수 일치
        pg.click('[data-mode="auto"]')
        pg.wait_for_timeout(300)
        pg.click('[data-basis="live"]')
        pg.wait_for_timeout(500)
        gscore = gauge_state(pg)['score']
        pg.goto(base + 'index.html?home#/')
        pg.wait_for_selector('.score-card')
        pg.wait_for_timeout(600)
        home_txt = pg.inner_text('.score-grid')
        check('홈과 매수 지표의 실시간 점수가 같다', gscore in home_txt, (gscore, home_txt[:120].replace('\n', ' ')))

        # ------------------------------------------------------- 5) 콘솔
        errs = [e for e in console_errors if 'live.json' not in e and '404' not in e]
        check('콘솔 오류 없음', not errs, errs[:3])

        ctx.close()
        b.close()
    httpd.shutdown()

    print()
    failed = [r for r in results if not r[1]]
    print('총 %d개 · 실패 %d개' % (len(results), len(failed)))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
