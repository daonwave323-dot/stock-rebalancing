#!/usr/bin/env python3
"""리밸런싱 미국장·국장 탭 검증 — 헤드리스 크로미움.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/ui_rebalance_test.py

한 페이지를 돌려쓴다(이 환경에서 페이지를 여러 개 띄우면 크로미움이 죽는다).

확인
  1) 리밸런싱 화면에 '미국장 · 달러($)' / '국장 · 원화(원)' 탭이 있고 탭 전환이 된다
  2) 탭마다 보유·총 투자금·밴드가 따로 저장된다
  3) 시세 자동 조회 — 미장(TQQQ), 국장(005930)이 채워지고 통화 표기가 맞다
  4) 비중·밴드 이탈·제안 수량이 손계산과 맞는다(미장·국장 각각, 밴드 이탈 포함)
  5) 환율 표시·직접 입력 저장·자동 복귀·값 없음 경로, 두 시장 합계(원화 환산)
  6) 국장 목록 밖 종목(증시 스냅샷)과 없는 코드 처리, 한글 이름 찾기
  7) 예전 한 벌 키(holdings·settings) → 미국장 이어받기(원래 키 보존)
  8) 390px 가로 넘침 없음
"""
import functools
import http.server
import json
import math
import os
import socketserver
import sys
import threading

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SHOTS = os.path.join(ROOT, 'screens-reb')
LIVE = os.path.join(ROOT, 'data', 'live.json')

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
    h = functools.partial(Handler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', 0), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, 'http://127.0.0.1:%d/' % httpd.server_address[1]


def rows_of(pg):
    return pg.evaluate("""() => {
      const out = [];
      document.querySelectorAll('#pfTbl tbody tr').forEach((tr, i) => {
        const inp = k => tr.querySelector('input[data-k="' + k + '"]');
        if (!inp('sym')) return;
        const outOf = k => tr.querySelector('[data-out="' + k + '-' + i + '"]');
        const num = t => Number(String(t).replace(/[^0-9.+-]/g, '')) || 0;
        out.push({
          sym: inp('sym').value, qty: Number(inp('qty').value) || 0,
          avg: Number(inp('avg').value) || 0, price: Number(inp('price').value) || 0,
          target: Number(inp('target').value) || 0,
          value: outOf('value').textContent.trim(),
          pl: outOf('pl').textContent.trim(),
          weight: outOf('weight').textContent.trim(),
          drift: outOf('drift').textContent.trim(),
          band: outOf('band').textContent.trim(),
          qtyd: outOf('qtyd').textContent.trim(),
          valueNum: num(outOf('value').textContent),
          weightNum: num(outOf('weight').textContent),
          driftNum: num(outOf('drift').textContent)
        });
      });
      return out;
    }""")


def calc_check(label, rows, cur):
    """비중·밴드 이탈·제안 수량을 손계산과 비교한다(밴드 ±5%p)."""
    base = sum(r['qty'] * r['price'] for r in rows)
    bad = []
    for r in rows:
        val = r['qty'] * r['price']
        w = val / base * 100 if base else 0
        drift = w - r['target']
        out_band = abs(drift) > 5
        qd = math.floor((r['target'] / 100 * base - val) / r['price']) if (out_band and r['price']) else 0
        exp_w = ('%.2f' % w).rstrip('0').rstrip('.') + '%'
        exp_val = (format(round(val), ',') + '원') if cur == 'KRW' else ('$' + format(round(val), ','))
        if r['value'] != exp_val:
            bad.append((r['sym'], 'value', r['value'], exp_val))
        if r['weight'] != exp_w:
            bad.append((r['sym'], 'weight', r['weight'], exp_w))
        if abs(r['driftNum'] - drift) > 0.02:
            bad.append((r['sym'], 'drift', r['drift'], round(drift, 2)))
        if ('이탈' in r['band']) != out_band:
            bad.append((r['sym'], 'band', r['band'], out_band))
        if r['sym'] != 'CASH':
            got_q = int(r['qtyd'].replace(',', '').replace('주', '').strip() or 0)
            if got_q != qd:
                bad.append((r['sym'], 'qty', got_q, qd))
    check(label + ' 비중·밴드·제안 수량이 손계산과 같다', not bad, bad[:4])
    print('   ' + label + ' 표:', [(r['sym'], r['value'], r['weight'], r['drift'], r['band'], r['qtyd']) for r in rows])
    return base


def main():
    os.makedirs(SHOTS, exist_ok=True)
    live = json.load(open(LIVE, encoding='utf-8'))
    fx_live = (live.get('fx') or {}).get('usdkrw')
    kr_syms = {k: v for k, v in live['symbols'].items() if v.get('market') == 'kr'}
    if not kr_syms:
        print('국장 심볼이 data/live.json 에 없습니다 — tools/live_update.py 를 먼저 돌려 주세요.')
        return 2
    print('live fx', fx_live, '· 국장 심볼', len(kr_syms))

    from playwright.sync_api import sync_playwright
    httpd, base = serve()
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--disable-dev-shm-usage'])
        pg = b.new_page(viewport={'width': 1280, 'height': 1000})
        pg.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)))

        pg.goto(base + '#/rebalance', wait_until='networkidle')
        pg.evaluate("localStorage.clear()")
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(500)

        # 1) 탭
        tabs = pg.eval_on_selector_all('[data-rebmkt]', "els => els.map(e => e.textContent.trim())")
        check('두 탭이 있다', len(tabs) == 2 and '미국장' in tabs[0] and '국장' in tabs[1], tabs)
        check('처음은 미국장 탭', pg.is_visible('text=미국장 총 투자금'), '')

        # 2) 미국장 보유 + 시세
        pg.click('#addRow')
        pg.fill('#pfTbl input[data-k="sym"][data-i="0"]', 'TQQQ')
        pg.fill('#pfTbl input[data-k="qty"][data-i="0"]', '100')
        pg.fill('#pfTbl input[data-k="avg"][data-i="0"]', '60')
        pg.fill('#pfTbl input[data-k="target"][data-i="0"]', '50')
        pg.click('#fetchPx')
        pg.wait_for_timeout(2500)
        us = rows_of(pg)
        check('미장 시세가 채워졌다', us and us[0]['price'] > 0, us[0]['price'] if us else None)
        check('미장 평가금액에 $ 표기', us and '$' in us[0]['value'], us[0]['value'] if us else '')
        check('평가손익 부호가 $ 앞에 온다', us and (us[0]['pl'].lstrip().startswith('-$') or us[0]['pl'].lstrip().startswith('+$')),
              us[0]['pl'] if us else '')

        # 3) 국장 탭 — 빈 상태, 환율 표시
        pg.click('[data-rebmkt="kr"]')
        pg.wait_for_timeout(400)
        check('국장 탭은 빈 상태로 시작', rows_of(pg) == [], rows_of(pg))
        fx_shown = float(pg.input_value('#fxRate') or 0)
        check('환율 = live.json 값', fx_live and abs(fx_shown - float(fx_live)) < 0.01, '%s vs %s' % (fx_shown, fx_live))

        # 4) 국장 보유 + 시세
        pg.click('#addRow')
        pg.fill('#pfTbl input[data-k="sym"][data-i="0"]', '005930')
        pg.fill('#pfTbl input[data-k="qty"][data-i="0"]', '100')
        pg.fill('#pfTbl input[data-k="avg"][data-i="0"]', '150000')
        pg.fill('#pfTbl input[data-k="target"][data-i="0"]', '100')
        pg.click('#fetchPx')
        pg.wait_for_timeout(3000)
        kr = rows_of(pg)
        check('국장 시세가 채워졌다', kr and kr[0]['price'] > 0, kr[0]['price'] if kr else None)
        check('국장 평가금액에 원 표기', kr and '원' in kr[0]['value'], kr[0]['value'] if kr else '')
        kr_nm = pg.inner_text('[data-nm="0"]')
        check('국장 종목명(한글)이 보인다', '삼성' in kr_nm, kr_nm)
        calc_check('국장(1종목 100%)', kr, 'KRW')
        check('국장 손익 = 가치−원가', kr and str(round(kr[0]['qty'] * kr[0]['price'] - kr[0]['qty'] * kr[0]['avg'])).replace('-', '') in
              kr[0]['pl'].replace(',', '').replace('원', '').replace('-', '').replace('+', ''),
              kr[0]['pl'] if kr else '')

        # 5) 합계 줄 — 미장 원화 환산
        strip = pg.inner_text('#rebSumStrip')
        check('합계 줄에 미국장·국장·합계가 있다',
              all(k in strip for k in ('미국장 (달러)', '국장 (원)', '두 시장 합계')), strip.replace('\n', ' ')[:140])
        us_dollar = float(strip.split('미국장 (달러)')[1].split('≈')[0].replace('$', '').replace(',', '').strip())
        kr_won = float([x for x in strip.split('국장 (원)')[1].split('두 시장')[0].split('\n') if '원' in x][0]
                       .replace('원', '').replace(',', '').strip())
        total_txt = [x for x in strip.split('두 시장 합계 (원화)')[1].split('\n') if '원' in x][0]
        total = float(total_txt.replace('원', '').replace(',', '').strip())
        check('합계 = 미장×환율 + 국장', abs(total - (round(us_dollar * fx_shown) + round(kr_won))) <= 2,
              '%.0f vs %.0f' % (total, round(us_dollar * fx_shown) + round(kr_won)))

        # 6) 환율 직접 입력 → 저장 → 자동 복귀
        pg.fill('#fxRate', '1400')
        pg.dispatch_event('#fxRate', 'change')
        pg.wait_for_timeout(500)
        saved = pg.evaluate("JSON.parse(localStorage.getItem('stockrebal.fx')||'null')")
        check('직접 넣은 환율이 저장된다', saved and abs(saved.get('usdkrw', 0) - 1400) < 0.01, saved)
        strip2 = pg.inner_text('#rebSumStrip')
        check('환율을 바꾸면 합계가 다시 계산된다', strip2 != strip, '')
        total2 = float([x for x in strip2.split('두 시장 합계 (원화)')[1].split('\n') if '원' in x][0]
                       .replace('원', '').replace(',', '').strip())
        check('바꾼 환율로 합계 = 미장×1400 + 국장', abs(total2 - (round(us_dollar * 1400) + round(kr_won))) <= 2,
              '%.0f vs %.0f' % (total2, round(us_dollar * 1400) + round(kr_won)))
        pg.click('#fxAuto')
        pg.wait_for_timeout(500)
        check('자동 환율로 되돌아간다', abs(float(pg.input_value('#fxRate')) - float(fx_live)) < 0.01,
              pg.input_value('#fxRate'))
        check('직접 입력 저장이 지워졌다', pg.evaluate("localStorage.getItem('stockrebal.fx')") in (None, 'null'), '')

        # 7) 탭별 총 투자금·밴드 분리
        pg.click('[data-rebmkt="us"]')
        pg.wait_for_timeout(300)
        pg.fill('#pfTotal', '100000')
        pg.click('[data-rebmkt="kr"]')
        pg.wait_for_timeout(300)
        check('국장 탭 총 투자금은 따로', pg.input_value('#pfTotal') == '', repr(pg.input_value('#pfTotal')))
        pg.fill('#pfBand', '3')
        pg.click('[data-rebmkt="us"]')
        pg.wait_for_timeout(300)
        check('국장 밴드를 바꿔도 미국장 밴드는 그대로', float(pg.input_value('#pfBand')) == 5.0,
              pg.input_value('#pfBand'))
        pg.click('[data-rebmkt="kr"]')
        pg.wait_for_timeout(300)
        pg.fill('#pfBand', '5')
        pg.wait_for_timeout(200)

        # 8) 미국장 보유 유지, 국장 보유는 섞이지 않음
        pg.click('[data-rebmkt="us"]')
        pg.wait_for_timeout(400)
        us_syms = pg.eval_on_selector_all('#pfTbl input[data-k="sym"]', "els => els.map(e => e.value)")
        check('미국장 보유가 그대로 남아 있다', us_syms == ['TQQQ'], us_syms)
        pg.screenshot(path=os.path.join(SHOTS, 'reb-us-1280.png'), full_page=True)
        pg.click('[data-rebmkt="kr"]')
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(SHOTS, 'reb-kr-1280.png'), full_page=True)

        # 9) 홈 — 두 시장이 함께 보인다
        pg.goto(base + '#/', wait_until='networkidle')
        pg.wait_for_timeout(1000)
        home = pg.inner_text('#view')
        check('홈 내 자리에 두 시장이 보인다', '미국장' in home and '국장' in home, '')
        check('홈 오늘 할 일에 시장 이름이 붙는다', ('[미국장]' in home or '[국장]' in home or '오늘은 없음' in home), '')

        # 10) 390px
        pg.set_viewport_size({'width': 390, 'height': 844})
        pg.goto(base + '#/rebalance', wait_until='networkidle')
        pg.wait_for_timeout(700)
        over = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('390px 가로 넘침 없음', over <= 0, 'overflow=' + str(over))
        pg.screenshot(path=os.path.join(SHOTS, 'reb-390.png'), full_page=True)
        pg.click('[data-rebmkt="kr"]')
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(SHOTS, 'reb-kr-390.png'), full_page=True)
        pg.set_viewport_size({'width': 1280, 'height': 1000})

        # 11) 미국장 3종목 · 밴드 이탈 손계산
        pg.evaluate("localStorage.clear()")
        pg.goto(base + '#/rebalance', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(500)
        pg.click('#exampleRows')
        pg.wait_for_timeout(300)
        pg.click('#fetchPx')
        pg.wait_for_timeout(2500)
        for i, t in enumerate(['70', '10', '20']):
            pg.fill('#pfTbl input[data-k="target"][data-i="%d"]' % i, t)
        pg.wait_for_timeout(300)
        calc_check('미국장(3종목)', rows_of(pg), 'USD')

        # 12) 환율 값 없음
        pg.evaluate("""() => {
          try { const d = window.Live && window.Live.data(); if (d) delete d.fx; } catch (e) {}
          localStorage.removeItem('stockrebal.fx');
          localStorage.removeItem('stockrebal.fx.last');
          Views.rebalance(document.getElementById('view'));
        }""")
        pg.wait_for_timeout(300)
        strip3 = pg.inner_text('#rebSumStrip')
        check('환율이 없으면 사실대로 적는다', '환율 값 없음' in strip3, strip3.replace('\n', ' ')[:120])
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(600)

        # 13) 국장 — 스냅샷만 있는 종목 / 없는 코드
        pg.click('[data-rebmkt="kr"]')
        pg.wait_for_timeout(400)
        pg.click('#addRow')
        pg.fill('#pfTbl input[data-k="sym"][data-i="0"]', '402340')
        pg.fill('#pfTbl input[data-k="qty"][data-i="0"]', '10')
        pg.fill('#pfTbl input[data-k="avg"][data-i="0"]', '600000')
        pg.fill('#pfTbl input[data-k="target"][data-i="0"]', '100')
        pg.click('#addRow')
        pg.fill('#pfTbl input[data-k="sym"][data-i="1"]', '999999')
        pg.fill('#pfTbl input[data-k="qty"][data-i="1"]', '1')
        pg.click('#fetchPx')
        pg.wait_for_timeout(3500)
        kr2 = rows_of(pg)
        check('목록 밖 국장 종목도 증시 스냅샷으로 채운다', kr2 and kr2[0]['price'] > 0, kr2[0]['price'] if kr2 else None)
        notice = pg.inner_text('#pxNotice')
        check('없는 코드는 그 사실을 알린다', '999999' in notice, notice.replace('\n', ' ')[:120])
        pg.screenshot(path=os.path.join(SHOTS, 'reb-kr-fallback.png'), full_page=True)

        # 14) 국장 한글 이름 찾기
        hits = []
        for attempt in range(3):
            pg.fill('#krFind', '')
            pg.fill('#krFind', '삼성')
            try:
                pg.wait_for_selector('#krFindAc button', timeout=6000)
            except Exception:
                pass
            pg.wait_for_timeout(300)
            hits = pg.eval_on_selector_all('#krFindAc button', "els => els.slice(0,4).map(e => e.textContent.trim())")
            if hits:
                break
            print('   (찾기 재시도', attempt + 1, pg.eval_on_selector('#krFindAc', 'e => e.textContent.slice(0, 80)'), ')')
        check('국장 종목을 한글 이름으로 찾는다', len(hits) > 0 and '삼성' in ''.join(hits), hits)
        if hits:
            pg.click('#krFindAc button')
            pg.wait_for_timeout(500)
            after = pg.eval_on_selector_all('#pfTbl input[data-k="sym"]', "els => els.map(e => e.value)")
            check('찾은 종목을 표에 넣는다', len(after) >= 2 and ('005930' in after or '207940' in after), after)

        # 15) 국장 3종목 손계산 (예시)
        pg.evaluate("localStorage.clear()")
        pg.goto(base + '#/rebalance', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(500)
        pg.click('[data-rebmkt="kr"]')
        pg.wait_for_timeout(300)
        pg.click('#exampleRows')
        pg.wait_for_timeout(300)
        pg.click('#fetchPx')
        pg.wait_for_timeout(3000)
        for i, t in enumerate(['40', '40', '20']):
            pg.fill('#pfTbl input[data-k="target"][data-i="%d"]' % i, t)
        pg.wait_for_timeout(300)
        calc_check('국장(3종목)', rows_of(pg), 'KRW')
        pg.screenshot(path=os.path.join(SHOTS, 'reb-kr-calc.png'), full_page=True)

        # 16) 예전 한 벌 키 → 미국장 이어받기
        pg.evaluate("""() => {
          localStorage.clear();
          localStorage.setItem('stockrebal.holdings', JSON.stringify([
            { id: 'x1', sym: 'SOXL', qty: 10, avg: 30, price: 36.57, target: 100 }
          ]));
          localStorage.setItem('stockrebal.settings', JSON.stringify({ total: 500, band: 4 }));
        }""")
        pg.goto(base + '#/rebalance', wait_until='networkidle')
        pg.reload(wait_until='networkidle')
        pg.wait_for_timeout(700)
        mig = pg.eval_on_selector_all('#pfTbl input[data-k="sym"]', "els => els.map(e => e.value)")
        check('예전 보유가 미국장 탭으로 이어진다', 'SOXL' in mig, mig)
        keys = pg.evaluate("Object.keys(localStorage).filter(k => /stockrebal.holdings|stockrebal.settings/.test(k)).sort()")
        check('시장별 키가 만들어지고 예전 키도 남는다',
              all(k in keys for k in ('stockrebal.holdings.us', 'stockrebal.holdings.kr', 'stockrebal.holdings',
                                      'stockrebal.settings.us', 'stockrebal.settings.kr')), keys)
        check('예전 설정(총 투자금·밴드)이 미국장으로 온다',
              pg.input_value('#pfTotal') == '500' and float(pg.input_value('#pfBand')) == 4.0,
              pg.input_value('#pfTotal') + '/' + pg.input_value('#pfBand'))
        pg.goto(base + '#/', wait_until='networkidle')
        pg.wait_for_timeout(600)
        check('예전 보유만 있어도 홈이 정상으로 뜬다', '내 자리' in pg.inner_text('#view'), '')

        b.close()

    # 국장 목록에 없는 코드를 브라우저가 야후에 직접 물어보는 시도는 교차 출처 차단으로 실패한다.
    # 그 실패는 화면이 이미 '찾지 못했습니다'로 처리하는 정상 경로이고, 브라우저 네트워크 로그만 남는다.
    ignored = ('CORS policy', 'Failed to load resource', 'net::ERR_FAILED', 'Blocked a frame')
    real_errors = [e for e in console_errors if not any(k in e for k in ignored)]
    check('콘솔 오류 없음', len(real_errors) == 0, real_errors[:3])
    ok = all(r[1] for r in results)
    print('\n%d/%d PASS' % (sum(1 for r in results if r[1]), len(results)))
    print('shots:', SHOTS)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
