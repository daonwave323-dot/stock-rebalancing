#!/usr/bin/env python3
"""5분 자동 시세(live.js) 화면 확인 — Playwright.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/ui_live_test.py

확인
  1) data/live.json 이 없을 때: 띠가 없고 사이트는 지금 그대로(스냅샷 점수)
  2) 있을 때: 띠·세션 라벨·프리마켓 표시, 점수가 파일 값으로 바뀜, 콘솔 오류 0
  3) live.json 을 페이지가 몇 번 받는지(중복 요청 유무)
  4) 임의 티커: 보유·관심 목록 표시, 목록에 없으면 브라우저 직접 조회 결과(차단 여부)
"""
import functools
import http.server
import json
import os
import shutil
import socketserver
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, 'screens-live')
LIVE = os.path.join(ROOT, 'data', 'live.json')
BACKUP = '/tmp/live-backup-ui.json'

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
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def numtxt(v):
    """화면 숫자 표기(F.num)와 같은 꼴 — 80.0 → '80', 80.5 → '80.5'. 스냅샷·live 값이 바뀌어도 이 시험이 낡지 않게."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return str(v)
    return ('%d' % n) if abs(n - int(n)) < 1e-9 else ('%.1f' % n)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    had_live = os.path.exists(LIVE)
    if not had_live:
        print('(data/live.json 이 없어 이번 확인은 건너뜁니다 — 먼저 tools/live_update.py 를 돌려 주세요)')
        return 2
    shutil.copy(LIVE, BACKUP)
    with open(os.path.join(ROOT, 'data', 'scores.json'), encoding='utf-8') as f:
        scoresDoc = json.load(f)
    snap_score = scoresDoc['targets']['ndx']['score']
    snap_asof = scoresDoc['as_of']

    from playwright.sync_api import sync_playwright
    httpd = serve()
    base = 'http://127.0.0.1:%d/' % httpd.server_address[1]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = ctx.new_page()
        requests = []
        page.on('request', lambda r: requests.append(r.url) if 'live.json' in r.url else None)
        page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)))

        # ---------------------------------------------- 1) live.json 없음
        if os.path.exists(LIVE):
            os.remove(LIVE)
        page.goto(base + 'index.html?p1#/')
        page.wait_for_selector('.score-card')
        page.wait_for_timeout(400)
        txt = page.inner_text('main')
        check('없음: 띠가 생기지 않는다', page.locator('#liveStrip').count() == 0)
        check('없음: 스냅샷 점수 그대로(TQQQ ' + numtxt(snap_score) + ')',
              numtxt(snap_score) in txt, txt[:60].replace('\n', ' '))
        check('없음: 기준일 표기 그대로',
              snap_asof.replace('-', '.') in page.inner_text('#foot-asof').replace('-', '.'),
              (snap_asof, page.inner_text('#foot-asof')[:40]))
        others = [e for e in console_errors if 'live.json' not in e and '404' not in e]
        check('없음: 콘솔 오류 없음(없는 live.json 404 은 예상된 것)', not others, others[:3])

        # ---------------------------------------------- 2) live.json 있음
        console_errors.clear()
        if had_live:
            shutil.copy(BACKUP, LIVE)
        with open(LIVE, encoding='utf-8') as f:
            liveDoc = json.load(f)
        want = liveDoc['symbols']['TQQQ']
        requests.clear()
        page.goto(base + 'index.html?p2#/')
        page.wait_for_selector('.score-card')
        page.wait_for_timeout(600)
        txt = page.inner_text('main')
        check('있음: 띠가 붙는다', page.locator('#liveStrip').count() == 1)
        strip = page.inner_text('#liveStrip') if page.locator('#liveStrip').count() else ''
        check('있음: 5분 자동 갱신 표기', '5분 자동 갱신' in strip, strip[:80])
        check('있음: 갱신 시각 표기', 'KST' in strip)
        check('있음: 지연 문구', '지연될 수 있음' in strip or '늦을 수 있' in strip)
        check('있음: 장 상태 표기', any(k in strip for k in ('장전', '정규장', '장후', '장 마감')), strip[:120])
        check('있음: TQQQ 가격 표시', 'TQQQ' in strip and ('$' in strip), strip[:160])
        check('있음: 화면 점수가 live.json 값', numtxt(want['score']) in txt,
              (want['score'], [l for l in txt.split('\n') if '100' in l][:2]))
        check('있음: 기준일이 live.json 기준', want['scoreAsOf'] not in (None, '') and
              want['scoreAsOf'].replace('-', '.') in page.inner_text('#foot-asof').replace('-', '.'),
              (want['scoreAsOf'], page.inner_text('#foot-asof')))
        live_reqs = len(requests)
        check('있음: live.json 요청 1회(중복 없음)', live_reqs == 1, live_reqs)
        check('있음: 콘솔 오류 없음', not console_errors, console_errors[:3])
        page.screenshot(path=os.path.join(SHOTS, 'live-home.png'), full_page=True)

        # 점수 상세 — 프리/애프터 값은 '추정'으로 따로, 행 값도 live.json 과 같아야 한다
        page.goto(base + 'index.html?p3#/score/ndx')
        page.wait_for_selector('.tbl tbody tr')
        st = page.inner_text('main')
        row = want['scoreRows'][0]
        check('점수 상세: 낙폭 값이 live.json 과 같다', row['raw_display'] in st, (row['raw_display'],))
        page.screenshot(path=os.path.join(SHOTS, 'live-score.png'), full_page=True)

        # ---------------------------------------------- 3) 임의 티커 판
        page.goto(base + 'index.html?p4#/')
        page.wait_for_selector('.score-card')
        page.evaluate("""() => {
          localStorage.setItem('stockrebal.holdings', JSON.stringify([
            {id:'a', sym:'NVDA', qty:1, avg:1, price:1, target:0},
            {id:'b', sym:'ZZZZ', qty:1, avg:1, price:1, target:0}
          ]));
        }""")
        page.reload()
        page.wait_for_selector('.score-card')
        page.wait_for_timeout(500)
        page.click('#lvMore')
        page.wait_for_timeout(1500)
        panel = page.inner_text('#lvPanel')
        check('티커 판: 열린다', '티커 시세' in panel)
        check('티커 판: 보유 티커 줄이 있다', 'NVDA' in panel)
        check('티커 판: 시가총액 표시', '$' in panel and ('T' in panel or 'B' in panel), panel[:200])
        check('티커 판: 목록에 없는 티커는 지연/실패로 적는다', '지연/실패' in panel or '직접 조회' in panel,
              [l for l in panel.split('\n') if 'ZZZZ' in l or '지연' in l][:3])
        page.screenshot(path=os.path.join(SHOTS, 'live-panel.png'), full_page=True)

        # ---------------------------------------------- 4) 브라우저 직접 조회(CORS) 실측
        probe = page.evaluate("""async () => {
          const out = {};
          const urls = {
            yahoo_chart: 'https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=1d&interval=5m',
            yahoo_quote: 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=NVDA',
            stooq: 'https://stooq.com/q/l/?s=nvda.us&f=sd2t2ohlcv&h&e=csv',
            raw_github: 'https://raw.githubusercontent.com/daonwave323-dot/stock-rebalancing/main/data/scores.json'
          };
          for (const [k, u] of Object.entries(urls)) {
            try {
              const r = await fetch(u, {mode: 'cors'});
              out[k] = 'HTTP ' + r.status;
            } catch (e) {
              out[k] = '차단: ' + (e && e.message || e);
            }
          }
          return out;
        }""")
        print('  CORS 실측:', json.dumps(probe, ensure_ascii=False))
        check('CORS: raw.githubusercontent 은 열린다', str(probe.get('raw_github', '')).startswith('HTTP 200'),
              probe.get('raw_github'))

        # ---------------------------------------------- 5) 비용 측정
        cost = page.evaluate("""async () => {
          const t0 = performance.now();
          const r = await fetch('data/live.json?x=' + Math.random(), {cache: 'no-store'});
          const buf = await r.arrayBuffer();
          return {ms: Math.round(performance.now() - t0), bytes: buf.byteLength};
        }""")
        print('  live.json 1회 받기: %d ms, %d bytes' % (cost['ms'], cost['bytes']))
        check('비용: live.json 이 1초 안에 온다(로컬)', cost['ms'] < 1000, cost)

        # ---------------------------------------------- 6) 5분 자동 새로고침이 실제로 도는지
        page.goto(base + 'index.html?p5#/')
        page.wait_for_selector('.score-card')
        n0 = len(requests)
        page.evaluate("""() => { /* 주기(5분)를 기다리지 않고 탭 복귀 트리거로 같은 경로를 확인 */ 
          document.dispatchEvent(new Event('visibilitychange'));
        }""")
        page.wait_for_timeout(800)
        check('새로고침 경로: 탭 복귀 시 다시 받는다', len(requests) > n0, (n0, len(requests)))

        browser.close()
    httpd.shutdown()

    print()
    failed = [r for r in results if not r[1]]
    print('총 %d개 · 실패 %d개' % (len(results), len(failed)))
    return 1 if failed else 0


if __name__ == '__main__':
    rc = main()
    # 확인 중 live.json 을 지웠다 넣었다 하므로 끝나면 반드시 되돌린다
    if os.path.exists(BACKUP):
        shutil.copy(BACKUP, LIVE)
    sys.exit(rc)
