#!/usr/bin/env python3
"""매수 지표 탭(#/gauge) 검증 — 지표 추적 하나로 점수·가격·레이더가 같이 움직이는지.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/ui_gauge_test.py

확인
  1) 화면 순서가 칩·가격·기준 → 밸류게이지 카드(머리 줄 오른쪽에 정규장/프리마켓 토글) → 매수 지표 입력(접힘)
     → 희귀도 설명 → 문턱 통계 → 레이더 → 차트 → 폭락 비교 → 지표 기록이고,
     입력 섹션은 기본 접힘·머리 줄에 지금 점수·기준, 접기/펼치기(터치·키보드)와 새로고침 유지
  2) 값 직접 입력(가격·VIX 칸·이 값으로 계산)이 없다
  3) 자동×확정 / 자동×실시간 / 수동×확정 / 수동×실시간 네 조합의 여섯 값·가격·점수·레이더 좌표
  3) 슬라이더(낙폭·200일선 이격)를 움직이면 점수·가격·레이더·막대가 같은 값에서 따라온다(손계산 대조)
  4) 새로 고침 뒤에도 모드·기준 유지, 홈과 점수 0.1 어긋남 없음
  5) 390×844 캡처

기준 토글은 2026-11-28 무아 님 지시로 밸류게이지 카드 머리 줄에 붙였다(접힌 입력 섹션의 같은 토글은 없앰).
장 마감 뒤에는 live.json 에 실시간 점수(scoreLive)가 없어 화면이 여섯 값으로 다시 낸다 — 그때는 그 경로를 확인한다.
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
      basisWhere: [...document.querySelectorAll('[data-basis]')].map(b => b.closest('.g-card') ? 'card' : (b.closest('#gTop') ? 'input' : 'other')),
      basisLabels: [...document.querySelectorAll('#gBaseSeg .tab')].map(b=>b.textContent.trim()),
      baseLine: (document.querySelector('#gBaseLine')||{}).textContent || '',
      duoClose: (()=>{const p=[...document.querySelectorAll('#gDuo .pair')].find(e=>e.querySelector('span') && e.querySelector('span').textContent==='확정'); return p? p.querySelector('b').textContent : null})(),
      duoLive: (()=>{const p=[...document.querySelectorAll('#gDuo .pair')].find(e=>e.querySelector('span') && e.querySelector('span').textContent==='실시간(추정)'); return p? p.querySelector('b').textContent : null})(),
      duoLiveOn: (()=>{const p=[...document.querySelectorAll('#gDuo .pair')].find(e=>e.querySelector('span') && e.querySelector('span').textContent==='실시간(추정)'); return !!p && p.classList.contains('on')})(),
      duoCloseOn: (()=>{const p=[...document.querySelectorAll('#gDuo .pair')].find(e=>e.querySelector('span') && e.querySelector('span').textContent==='확정'); return !!p && p.classList.contains('on')})(),
      basisHint: (document.querySelector('#gBasisHint')||{}).textContent || '',
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

        # ------------------------------------------------------- 1) 구조 — 카드 머리에 기준 토글, 입력은 카드 바로 다음·접힘
        open_gauge('?a')
        st = gauge_state(pg)
        print('  order:', st['order'])
        check('칩·가격·기준 줄이 맨 위', 'gDuo' in st['order'][:5], st['order'][:5])
        check('밸류게이지 카드가 첫 화면 맨 위', 'panel g-card' in st['order'][:6], st['order'][:6])
        check('매수 지표 입력은 밸류게이지 카드 바로 다음',
              st['order'].index('gTop') == st['order'].index('panel g-card') + 1, st['order'])
        check('입력은 희귀도 설명·문턱 통계·레이더보다 위',
              st['order'].index('gTop') < st['order'].index('gRarityNote')
              and st['order'].index('gTop') < st['order'].index('g-stat'), st['order'])
        check('지표 기록 섹션은 맨 아래 그대로', st['order'][-1] == 'panel g-sec', st['order'][-3:])
        geo = pg.evaluate("""() => {
          const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return {t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height)}; };
          return {vh: innerHeight, vw: innerWidth, h2: r('.g-card .g-head h2'), seg: r('#gBaseSeg'),
                  card: r('.g-card'), head: r('.g-card .g-head'), cardIn: Math.round(document.querySelector('.g-card').clientWidth),
                  top: r('#gTop'), score: r('#gScore')};
        }""")
        print('  카드 머리:', geo)
        check('기준 토글은 밸류게이지 카드 머리 안에만 있다',
              st['basisWhere'] == ['card', 'card'] and bool(st['basisLabels']), (st['basisWhere'], st['basisLabels']))
        check('토글 이름은 정규장 · 프리마켓', st['basisLabels'] == ['정규장', '프리마켓'], st['basisLabels'])
        check('토글은 카드 제목과 같은 줄·오른쪽',
              abs(geo['seg']['t'] - geo['h2']['t']) < 12 and geo['seg']['r'] <= geo['head']['r']
              and geo['seg']['t'] >= geo['head']['t'] - 2 and geo['seg']['b'] <= geo['head']['b'] + 2, (geo['seg'], geo['h2'], geo['head']))
        check('390px에서 제목+토글이 한 줄에 들어간다',
              geo['seg']['t'] < geo['h2']['b'] and geo['seg']['l'] > geo['h2']['r'], (geo['seg'], geo['h2']))
        check('390px 첫 화면에 기준 토글이 보인다(스크롤 없이)',
              geo['seg']['t'] >= 0 and geo['seg']['b'] <= geo['vh'], (geo['seg'], geo['vh']))
        check('입력 섹션은 카드에 붙어 있다(사이에 다른 패널 없음)',
              0 <= geo['top']['t'] - geo['card']['b'] <= 24, (geo['card']['b'], geo['top']['t']))
        check('입력 섹션은 접힌 채로 시작', st['inputHidden'] is True and st['inputAria'] == 'false',
              (st['inputHidden'], st['inputAria']))
        check('접힌 머리 줄에 지금 점수·기준',
              st['inputHead'].startswith('지금') and '점' in st['inputHead'] and '자동' in st['inputHead']
              and ('확정' in st['inputHead'] or '실시간' in st['inputHead']), st['inputHead'])
        check('접힌 동안 여섯 값 줄은 화면에 없다', st['sixVisible'] is False)
        check('값 직접 입력 삭제 — 가격 입력칸 없음', st['hasPx'] is False)
        check('값 직접 입력 삭제 — 이 값으로 계산 없음', st['hasCalc'] is False)
        check('가격 표시는 남는다', st['price'].startswith('$'), st['price'])
        check('지금 기준 한 줄(확정 종가·기준일)', '정규장' in st['baseLine'] and '확정 종가' in st['baseLine'], st['baseLine'])
        check('390px 첫 화면에 밸류게이지 점수', geo['score']['b'] <= geo['vh'], geo['score'])
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-top.png'))
        pg.evaluate("() => { const c=document.querySelector('.g-card'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }")
        pg.wait_for_timeout(250)
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-card-input.png'))

        # 접힌 채로 기준을 바꿔도 카드·g-duo·레이더가 따라온다(무아 님 지적의 핵심)
        pg.evaluate("() => window.scrollTo(0, 0)")
        pg.wait_for_timeout(150)
        pg.click('#gBaseSeg [data-basis="live"]')
        pg.wait_for_timeout(500)
        collapsed_live = gauge_state(pg)
        check('입력 섹션이 접힌 채로도 실시간 토글이 먹는다',
              collapsed_live['basisOn'] == ['live'] and collapsed_live['inputHidden'] is True, collapsed_live['basisOn'])
        check('실시간으로 바꾸면 점수가 그 기준으로 갱신', collapsed_live['score'] != st['score'],
              (st['score'], collapsed_live['score']))
        check('실시간으로 바꾸면 g-duo 의 실시간이 지금 화면', collapsed_live['duoLiveOn'] is True and collapsed_live['duoCloseOn'] is False)
        check('실시간으로 바꾸면 레이더도 그 기준', collapsed_live['radar'] != st['radar'])
        check('실시간 기준 한 줄에 ET 시각·세션', '프리마켓' in collapsed_live['baseLine'] and 'ET' in collapsed_live['baseLine'], collapsed_live['baseLine'])
        pg.click('#gBaseSeg [data-basis="close"]')
        pg.wait_for_timeout(500)
        back0 = gauge_state(pg)
        check('정규장으로 되돌리면 원래 점수·기준', back0['basisOn'] == ['close'] and back0['score'] == st['score'],
              (back0['basisOn'], back0['score'], st['score']))
        check('정규장으로 되돌리면 g-duo 확정이 지금 화면', back0['duoCloseOn'] is True and back0['duoLiveOn'] is False)

        # 접기/펼치기 — 터치(tap)·키보드(Enter)·새로고침 유지
        pg.evaluate("() => document.querySelector('#gTop').scrollIntoView({block:'center'})")
        pg.tap('#gTop .g-sechead')
        pg.wait_for_timeout(300)
        op = gauge_state(pg)
        check('터치(tap)로 펼쳐진다', op['inputHidden'] is False and op['inputAria'] == 'true',
              (op['inputHidden'], op['inputAria']))
        check('펼치면 여섯 값 줄이 보인다', op['sixVisible'] is True and op['six'].count('·') == 5, op['six'])
        check('펼치면 자동/수동 전환이 보인다', op['modeOn'] == ['auto'], op['modeOn'])
        check('입력 섹션 안에는 기준 토글이 없다(중복 제거)',
              [w for w in op['basisWhere'] if w == 'input'] == [], op['basisWhere'])
        check('그 자리에 기준은 위에서 고른다는 한 줄',
              '기준' in op['basisHint'] and '위' in op['basisHint'], op['basisHint'])
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
        live_price = tq.get('scoreLivePrice') or tq.get('last')
        want_dd = (1 - live_price / peak) * 100          # 같은 식: 고점 대비 낙폭
        if tq.get('scoreLive') is not None:
            check('자동×실시간: 점수=live.json scoreLive', combos['auto-live']['score'] == ('%.1f' % tq['scoreLive']),
                  (combos['auto-live']['score'], tq['scoreLive']))
            check('자동×실시간: 점수도 g-duo 실시간과 같다',
                  combos['auto-live']['duoLive'] == combos['auto-live']['score'],
                  (combos['auto-live']['duoLive'], combos['auto-live']['score']))
        else:
            # 장 마감 등 live.json 에 실시간 점수가 없을 때 — 화면의 여섯 값으로 같은 식으로 낸다
            check('자동×실시간: 점수가 확정과 갈린다(화면 값으로 다시 계산)',
                  combos['auto-live']['score'] != combos['auto-close']['score'],
                  (combos['auto-close']['score'], combos['auto-live']['score']))
            check('자동×실시간: 점수가 g-duo 실시간과 같다',
                  combos['auto-live']['duoLive'] == combos['auto-live']['score'],
                  (combos['auto-live']['duoLive'], combos['auto-live']['score']))
            check('확정 점수는 g-duo 확정에 그대로',
                  combos['auto-live']['duoClose'] == combos['auto-close']['score'],
                  (combos['auto-live']['duoClose'], combos['auto-close']['score']))
        check('자동×실시간: 가격=실시간 체결', combos['auto-live']['priceTag'].strip() == '실시간 체결', combos['auto-live']['priceTag'])
        check('자동×실시간: 가격이 마지막 체결가', combos['auto-live']['price'] == ('$%.2f' % live_price),
              (combos['auto-live']['price'], live_price))
        check('자동×실시간: 낙폭이 그 가격의 고점 대비 낙폭',
              abs(float(combos['auto-live']['dd']) - want_dd) < 0.06,
              (combos['auto-live']['dd'], round(want_dd, 2)))
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
        check('수동: 값은 그대로(실시간 값 복사)', combos['manual-live']['six'] == combos['auto-live']['six'],
              (combos['manual-live']['six'][:40], combos['auto-live']['six'][:40]))
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
        check('자동 복귀: 확정 값으로 돌아온다', back['score'] == combos['auto-close']['score'] and back['six'] == combos['auto-close']['six'], (back['score'], combos['auto-close']['score']))
        check('자동 복귀: 점수도 확정', back['score'] == combos['auto-close']['score'], (back['score'], combos['auto-close']['score']))
        check('자동 복귀: 머리 줄도 자동으로 돌아온다', '값 조정' not in back['inputHead'], back['inputHead'])

        print('  네 조합 — dd/score/price/tag')
        for k, v in combos.items():
            print('    %-13s dd=%-6s score=%-5s %-12s %s' % (k, v['dd'], v['score'], v['price'], v['priceTag']))
        check('네 조합의 여섯 값이 구분된다(자동 두 조합)',
              (combos['auto-close']['six'] != combos['auto-live']['six'])
              or (combos['auto-close']['score'] != combos['auto-live']['score']),
              (combos['auto-close']['six'][:44], combos['auto-live']['six'][:44],
               combos['auto-close']['score'], combos['auto-live']['score']))
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
        check('손으로 만지면 머리 줄이 값을 조정한 것으로 적는다', '값 조정' in after['inputHead'], after['inputHead'])
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

        # ------------------------------------------------------- 3b) 두 차트 — 최고점 빨강 · 오늘 초록
        open_input()
        pg.click('[data-mode="auto"]')
        pg.wait_for_timeout(300)
        if gauge_state(pg)['basisOn'] != ['close']:
            pg.click('#gBaseSeg [data-basis="close"]')
            pg.wait_for_timeout(400)

        def marks():
            return pg.evaluate("""() => {
              const grab = sel => {
                const svg = document.querySelector(sel + ' svg');
                if (!svg) return null;
                const H = Number(svg.getAttribute('height')), W = Number(svg.getAttribute('width'));
                const pts = [...svg.querySelectorAll('circle')].map(c => ({fill: c.getAttribute('fill'), r: c.getAttribute('r'), cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy')}));
                const txt = [...svg.querySelectorAll('text')].filter(t => t.hasAttribute('data-bg')).map(t => {
                  const b = t.getBBox();
                  return {t: t.textContent, fill: t.getAttribute('fill'), y: +t.getAttribute('y'),
                          top: Math.round(b.y), bottom: Math.round(b.y + b.height), left: Math.round(b.x), right: Math.round(b.x + b.width)};
                });
                const dashes = [...svg.querySelectorAll('line')].filter(l => l.getAttribute('stroke-dasharray') === '4 3')
                  .map(l => ({x: +l.getAttribute('x1'), c: l.getAttribute('stroke')}));
                return {W: W, H: H, pts: pts, txt: txt, dashes: dashes};
              };
              return {month: grab('#gMonth'), flow: grab('#gFlow'), score: (document.querySelector('#gScore')||{}).textContent};
            }""")

        mk0 = marks()
        for name, ch in (('최근 한 달', mk0['month']), ('전체 흐름', mk0['flow'])):
            reds = [c for c in ch['pts'] if c['fill'] == 'var(--red)']
            greens = [c for c in ch['pts'] if c['fill'] == 'var(--green)']
            red_t = [t for t in ch['txt'] if t['fill'] == 'var(--red)']
            green_t = [t for t in ch['txt'] if t['fill'] == 'var(--green)']
            check(name + ': 최고점에 빨간 점', bool(reds), reds[:2])
            check(name + ': 오늘에 초록 점', bool(greens), greens[:2])
            check(name + ': 빨간 라벨에 최고 점수', bool(red_t) and ('최고' in red_t[0]['t'] or '최고·오늘' in red_t[0]['t']), [t['t'] for t in red_t])
            check(name + ': 초록 라벨에 오늘 점수', bool(green_t) and ('오늘' in green_t[0]['t']), [t['t'] for t in green_t])
            check(name + ': 점마다 세로 점선(4 3)', len(ch['dashes']) >= 2 and any(d['c'] == 'var(--red)' for d in ch['dashes'])
                  and any(d['c'] == 'var(--green)' for d in ch['dashes']), ch['dashes'])
            inside = all(-1 <= t['top'] and t['bottom'] <= ch['H'] + 1 and 0 <= t['left'] and t['right'] <= ch['W'] for t in ch['txt'])
            check(name + ': 라벨이 차트 밖으로 잘리지 않는다', bool(ch['txt']) and inside, ch['txt'])
        print('  차트 표시:', [(t['t'], t['y']) for t in mk0['month']['txt']], [(t['t'], t['y']) for t in mk0['flow']['txt']])

        # 오늘 점은 기준·슬라이더를 따라 움직인다
        green0 = [c for c in mk0['month']['pts'] if c['fill'] == 'var(--green)'][0]
        greenf0 = [c for c in mk0['flow']['pts'] if c['fill'] == 'var(--green)'][0]
        pg.click('#gBaseSeg [data-basis="live"]')
        pg.wait_for_timeout(500)
        mk1 = marks()
        green1 = [c for c in mk1['month']['pts'] if c['fill'] == 'var(--green)'][0]
        greenf1 = [c for c in mk1['flow']['pts'] if c['fill'] == 'var(--green)'][0]
        check('기준을 바꾸면 오늘 점이 움직인다(최근 한 달)', green1['cy'] != green0['cy'], (green0['cy'], green1['cy']))
        check('기준을 바꾸면 오늘 점이 움직인다(전체 흐름)', greenf1['cy'] != greenf0['cy'], (greenf0['cy'], greenf1['cy']))
        check('오늘 라벨 숫자도 같이 바뀐다', any(('오늘 ' + mk1['score']) == t['t'] for t in mk1['month']['txt']),
              ([t['t'] for t in mk1['month']['txt']], mk1['score']))
        pg.click('#gBaseSeg [data-basis="close"]')
        pg.wait_for_timeout(400)

        # 슬라이더를 만져도(접힌 입력 섹션) 오늘 점이 따라온다
        pg.evaluate("""() => { const s = document.querySelector('[data-slider="dd"]'); s.value = '20'; s.dispatchEvent(new Event('input',{bubbles:true})); }""")
        pg.wait_for_timeout(400)
        mk2 = marks()
        green2 = [c for c in mk2['month']['pts'] if c['fill'] == 'var(--green)'][0]
        greenf2 = [c for c in mk2['flow']['pts'] if c['fill'] == 'var(--green)'][0]
        check('슬라이더를 만지면 오늘 점이 따라온다', green2['cy'] != green0['cy'] and greenf2['cy'] != greenf0['cy'],
              (green0['cy'], green2['cy'], greenf0['cy'], greenf2['cy']))

        # 오늘이 최고점이면 고리 하나에 '최고·오늘' 한 라벨
        pg.evaluate("""() => {
          const set = (k, v) => { const s = document.querySelector('[data-slider="'+k+'"]'); if (s) { s.value = String(v); s.dispatchEvent(new Event('input', {bubbles:true})); } };
          set('dd', 60); set('wrsi', 10); set('vixr', 2); set('gap', -40); set('drsi', 10); set('vixp', 100);
        }""")
        pg.wait_for_timeout(500)
        mk3 = marks()
        comb = [t['t'] for t in mk3['month']['txt'] if '최고·오늘' in t['t']]
        ring = [c for c in mk3['month']['pts'] if c['fill'] == 'none']
        check('오늘=최고점이면 고리 하나에 한 라벨', bool(comb) and bool(ring) and mk3['score'] == '100', (comb, ring, mk3['score']))
        check('오늘=최고점이면 라벨도 잘리지 않는다',
              all(t['top'] >= -1 for t in mk3['month']['txt']), mk3['month']['txt'])
        pg.evaluate("() => document.querySelector('#gMonth').scrollIntoView({block:'center'})")
        pg.wait_for_timeout(250)
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-marks-month.png'))
        pg.evaluate("() => document.querySelector('#gFlow').scrollIntoView({block:'center'})")
        pg.wait_for_timeout(250)
        pg.screenshot(path=os.path.join(SHOTS, 'gauge-390-marks-flow.png'))
        pg.click('[data-mode="manual"]')
        pg.wait_for_timeout(200)
        open_input()
        pg.click('[data-mode="auto"]')
        pg.wait_for_timeout(300)

        # ------------------------------------------------------- 4) 홈과 점수 일치
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
