#!/usr/bin/env python3
"""배포 사이트 확인 — 반도체 SOXL 상태에서 콘솔 오류 0 · 가로 넘침 0 · 상세 링크 전부 열림 + 캡처.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/soxl_live_check.py [url] [out_dir]
"""
import os, sys, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'https://daonwave323-dot.github.io/stock-rebalancing/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/workspace/screens-soxl'
os.makedirs(OUT, exist_ok=True)
sox = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'crashes_sox.json'), encoding='utf-8'))
errs, bad, out = [], [], []
def ok(name, cond, note=''):
    print(('PASS  ' if cond else 'FAIL  ') + name + ('   ' + str(note) if note else ''))
    if not cond: out.append(name)

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--no-sandbox'])
    for W in (390, 1280):
        pg = b.new_page(viewport={'width': W, 'height': 844 if W == 390 else 950})
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('response', lambda r: bad.append(r.url) if r.status >= 400 else None)
        pg.goto(BASE + '#/gauge', wait_until='networkidle'); pg.wait_for_timeout(1200)
        pg.click('[data-target="sox"]'); pg.wait_for_timeout(900)
        pg.locator('.g-card').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, 'live-gauge-brake-%d.png' % W))
        ok('[%d] 밸류게이지 카드에 2단계 브레이크' % W, pg.evaluate("()=>!!document.querySelector('#gBrake')"))
        pg.click('[data-toggle="crash"]'); pg.wait_for_timeout(1100)
        pg.locator('.g-sec[data-sec=crash]').scroll_into_view_if_needed(); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, 'live-crash-sox-%d.png' % W))
        ok('[%d] SOX 8사례 카드' % W, pg.evaluate("()=>document.querySelectorAll('.case-card').length") == 9)
        ok('[%d] 가로 넘침 0' % W, pg.evaluate("()=>document.documentElement.scrollWidth-document.documentElement.clientWidth") <= 0)
        # 상세 링크 전부 눌러 열림 확인
        hrefs = pg.evaluate("()=>[...document.querySelectorAll('.case-card')].map(a=>a.getAttribute('href'))")
        for h in hrefs:
            pg.goto(BASE + h, wait_until='networkidle'); pg.wait_for_timeout(700)
            has = pg.evaluate("()=>!!document.querySelector('#gCaseChart') || !!document.querySelector('#gCase')")
            title = pg.evaluate("()=>document.querySelector('h1')?document.querySelector('h1').textContent:''")
            ok('[%d] %s 열림 (%s)' % (W, h, title[:14]), has)
            if W == 390 and h.endswith('sox-2022'):
                pg.screenshot(path=os.path.join(OUT, 'live-case-sox-2022-%d.png' % W))
        pg.goto(BASE + '#/', wait_until='networkidle'); pg.wait_for_timeout(900)
        ok('[%d] 홈 SOXL 카드 2단계 줄' % W, '2단계' in pg.evaluate("()=>{const c=document.querySelector('.score-card.sox');return c?c.innerText:''}"))
        pg.close()
    b.close()
ok('콘솔 오류 0', not errs, errs[:3])
ok('404 응답 0', not bad, bad[:3])
print('\n실패 %d개' % len(out))
sys.exit(1 if out else 0)
