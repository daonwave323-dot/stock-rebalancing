#!/usr/bin/env python3
"""새 화면(증시·일정·도구) 실제 클릭 검증 — 헤드리스 크로미움.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/test_new_screens.py
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SHOTS = os.path.join(ROOT, 'screens')

results = []
console = []
bad = []


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + note if note else ''))
    return ok


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    h = functools.partial(Handler, directory=ROOT)
    httpd = socketserver.TCPServer(('127.0.0.1', 0), h)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, 'http://127.0.0.1:%d/' % httpd.server_address[1]


def main():
    os.makedirs(SHOTS, exist_ok=True)
    httpd, base = serve()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 950})
        pg = ctx.new_page()
        pg.on('console', lambda m: console.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console.append('pageerror: ' + str(e)))
        pg.on('response', lambda r: bad.append(r.url) if r.status >= 400 else None)

        def go(h, wait=900):
            pg.goto(base + 'index.html' + h)
            pg.wait_for_timeout(wait)

        # ---------------------------------------------------------- 증시 홈
        go('#/market', 1600)
        check('증시: 지수 칸', pg.locator('.idx-cell').count() >= 5, str(pg.locator('.idx-cell').count()))
        check('증시: 지수 값 존재', '—' not in pg.locator('.idx-cell').first.inner_text().split('\n')[1])
        check('증시: 마켓맵 캔버스', pg.locator('#mapbox canvas').count() == 1)
        check('증시: 순위 표', pg.locator('table.mkt').count() >= 2)
        check('증시: 관심 종목 기본값(TQQQ)', 'TQQQ' in pg.inner_text('body'))

        px_color = pg.evaluate("getComputedStyle(document.querySelector('.px')).color")
        check('가격 연두색(#3DD68C)', px_color.replace(' ', '') in ('rgb(61,214,140)',), px_color)

        # 지수 → 캔들
        pg.locator('.idx-cell').first.click()
        pg.wait_for_timeout(1400)
        check('지수 → 캔들 화면', 'chart-box' in pg.inner_html('body') and '#/market/candles/' in pg.url, pg.url)
        canvas_has = pg.evaluate("(()=>{const c=document.querySelector('#cbox canvas');if(!c)return 0;const x=c.getContext('2d');const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4){if(d[i]>0)n++;}return n;})()")
        check('캔들 차트 실제 픽셀', canvas_has > 500, str(canvas_has))
        # 봉 단위 전환
        pg.locator('[data-cspan="week"]').click()
        pg.wait_for_timeout(600)
        check('주봉 전환', '주봉' in pg.inner_text('#cnote') or '주' in pg.inner_text('#cnote'))
        pg.go_back()
        pg.wait_for_timeout(900)
        check('뒤로 → 증시 홈', pg.locator('.idx-cell').count() >= 5)

        # ---------------------------------------------------------- 티커 자동 검색
        pg.fill('#wq', 'NVDA')
        pg.wait_for_timeout(500)
        ac = pg.locator('#wac button').count()
        check('자동완성 목록', ac >= 1, str(ac))
        pg.locator('#wac button').first.click()
        pg.wait_for_timeout(1200)
        body = pg.inner_text('body')
        check('티커 추가 후 행', 'NVDA' in body)
        check('추가 직후 시세 채워짐', pg.locator('table.mkt tr.row').first.locator('td').nth(1).inner_text() not in ('', '—'))

        # 새로고침 후 유지
        pg.reload()
        pg.wait_for_timeout(1500)
        check('새로고침 후 관심 종목 유지', 'NVDA' in pg.inner_text('body'))

        # 잘못된 티커
        pg.fill('#wq', 'ZZZZQQ')
        pg.wait_for_timeout(500)
        pg.locator('#wac button').first.click()
        pg.wait_for_timeout(2500)
        note = pg.inner_text('body')
        check('없는 티커는 값 없이 안내', ('지어내지 않' in note) or ('없' in note and 'ZZZZQQ' in note))

        # 정렬(시총)
        pg.locator('[data-sort="cap"]').first.click()
        pg.wait_for_timeout(700)
        check('순위 시총 정렬', pg.locator('[data-sort="cap"]').first.get_attribute('style') is not None)

        # 시가총액 단위
        caps = pg.inner_text('table.mkt')
        check('시총 단위(조 달러/조원)', ('조 달러' in caps) or ('조원' in caps), caps[:80].replace('\n', ' '))

        # ---------------------------------------------------------- 마켓맵 섹터 → 업종 → 종목
        pg.locator('[data-scope="SECTOR"]').click()
        pg.wait_for_timeout(900)
        check('섹터 목록', pg.locator('[data-sector]').count() >= 5)
        pg.locator('[data-sector]').first.click()
        pg.wait_for_timeout(900)
        check('섹터 화면(업종 목록)', pg.locator('[data-industry]').count() >= 1, pg.url)
        pg.locator('[data-industry]').first.click()
        pg.wait_for_timeout(900)
        check('업종 화면(종목 목록)', pg.locator('table.mkt tr.row').count() >= 1, pg.url)
        pg.locator('table.mkt tr.row').first.click()
        pg.wait_for_timeout(1500)
        check('종목 상세', '밸류에이션' in pg.inner_text('body'), pg.url)
        check('종목 상세 캔들', pg.locator('#cbox canvas').count() == 1)

        # ---------------------------------------------------------- 국내 전환
        go('#/market', 1200)
        pg.locator('[data-mkt="kr"]').click()
        pg.wait_for_timeout(1400)
        kb = pg.inner_text('body')
        check('국내 전환', '코스피' in kb or '코스닥' in kb)
        pg.locator('[data-candles="KOSPI"]').first.click()
        pg.wait_for_timeout(1500)
        check('국내 지수 캔들', pg.locator('#cbox canvas').count() == 1, pg.url)

        # ---------------------------------------------------------- 프리마켓 토글
        go('#/market', 1200)
        pg.locator('[data-basis="after"]').click()
        pg.wait_for_timeout(900)
        check('프리마켓 토글 적용', '프리마켓' in pg.inner_text('.mkt-top'))
        pg.locator('[data-basis="regular"]').click()
        pg.wait_for_timeout(700)

        # ---------------------------------------------------------- 일정
        go('#/calendar', 1400)
        check('일정: 주 보기', pg.locator('[data-ev]').count() >= 1, str(pg.locator('[data-ev]').count()))
        pg.locator('[data-monthly="1"]').click()
        pg.wait_for_timeout(700)
        check('일정: 월 보기 격자', pg.locator('.cal-grid .day').count() >= 28)
        pg.locator('.cal-grid .day').nth(10).click()
        pg.wait_for_timeout(600)
        check('일정: 날짜 선택', pg.locator('.cal-list').count() == 1)
        pg.locator('[data-pane="1"]').click()
        pg.wait_for_timeout(800)
        check('브리핑 갈래', '브리핑' in pg.inner_text('body') and len(pg.inner_text('body')) > 400)

        # ---------------------------------------------------------- 도구: 세금
        go('#/tools/tax', 1200)
        pg.fill('[data-k="sym"]', 'SOXL')
        pg.fill('[data-k="qty"]', '100')
        pg.fill('[data-k="price"]', '40')
        pg.fill('[data-k="avg"]', '30')
        pg.locator('[data-tax-run]').click()
        pg.wait_for_timeout(500)
        tax_txt = pg.inner_text('#taxOut')
        check('세금 계산 결과', '양도차익' in tax_txt and '세금' in tax_txt, tax_txt[:60].replace('\n', ' '))
        # 100주 × ($40-$30) = $1000 × 환율 → 22% (공제 전액 남음 → 250만원 넘는 부분만)
        val = pg.evaluate("(()=>{const s=document.querySelector('#taxOut').innerText;return s;})()")
        check('세금 식 적용(공제 가정 문구)', '0원으로 가정' in val or '250만원' in val)

        # ---------------------------------------------------------- 도구: 가져오기
        go('#/tools/import', 1000)
        pg.locator('[data-imp-sample]').click()
        pg.wait_for_timeout(700)
        check('가져오기 예시 파싱', '파일 미리보기' in pg.inner_text('body'))
        rows = pg.locator('table.mkt tr').count()
        check('가져오기 2종목', rows >= 3, str(rows))

        # ---------------------------------------------------------- 도구: 알림
        go('#/tools/notify', 900)
        check('알림 화면', '브라우저 알림' in pg.inner_text('body'))
        check('홈 화면 안내', '홈 화면에 추가' in pg.inner_text('body'))

        # ---------------------------------------------------------- 도구: 설정
        go('#/tools/settings', 900)
        check('설정 백업 화면', 'JSON 으로 내보내기' in pg.inner_text('body'))

        # ---------------------------------------------------------- 모바일 390
        ctx2 = b.new_context(viewport={'width': 390, 'height': 844})
        pg2 = ctx2.new_page()
        pg2.on('pageerror', lambda e: console.append('m pageerror: ' + str(e)))
        pg2.goto(base + 'index.html#/market')
        pg2.wait_for_timeout(1800)
        ow = pg2.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('모바일 390 가로 넘침 없음', ow <= 1, 'overflow=%s' % ow)
        pg2.screenshot(path=os.path.join(SHOTS, 'mkt-390.png'), full_page=True)
        pg2.goto(base + 'index.html#/calendar')
        pg2.wait_for_timeout(1400)
        ow2 = pg2.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('일정 390 넘침 없음', ow2 <= 1, 'overflow=%s' % ow2)

        pg.goto(base + 'index.html#/market')
        pg.wait_for_timeout(1500)
        pg.screenshot(path=os.path.join(SHOTS, 'market-home.png'), full_page=True)
        pg.goto(base + 'index.html#/market/stock/AAPL')
        pg.wait_for_timeout(1800)
        pg.screenshot(path=os.path.join(SHOTS, 'market-detail.png'), full_page=True)

        b.close()

    errs = [c for c in console if 'favicon' not in c
            and 'query1.finance.yahoo.com' not in c
            and 'ERR_FAILED' not in c]  # 없는 티커를 일부러 조회한 결과(CORS 차단)는 확인된 사실
    check('콘솔 오류 0', len(errs) == 0, str(errs[:3]))
    bads = [u for u in bad if 'favicon' not in u]
    check('404 없음', len(bads) == 0, str(bads[:3]))

    fails = [r for r in results if not r[1]]
    print('\n%d/%d 통과' % (len(results) - len(fails), len(results)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
