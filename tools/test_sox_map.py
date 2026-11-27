#!/usr/bin/env python3
"""증시 마켓맵 '반도체' 보기 — 칸이 업종 묶음이 아니라 종목 하나인지 검증.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/test_sox_map.py

확인하는 것
  1) 반도체 보기에서 칸 수 = 데이터의 반도체 종목 수(업종으로 다시 묶지 않는다)
  2) 칸 키 = 티커, 칸을 누르면 그 종목 상세(#/market/stock/…)로 간다
  3) 문구에 종목 수·시가총액 기준이 적힌다
  4) 국내 시장에도 같은 방식으로 열린다(data/market.json 의 kr 반도체 종목)
  5) 390px 가로 넘침 0, 콘솔 오류 0
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
results, console, bad = [], [], []


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + str(note) if note != '' else ''))
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


def semis(market):
    with open(os.path.join(ROOT, 'data', 'market.json'), encoding='utf-8') as f:
        snap = json.load(f)
    rows = [s for s in snap['symbols'].values()
            if s.get('market') == market and s.get('industry') == 'Semiconductors' and (s.get('mcap') or 0) > 0]
    return [s['sym'] for s in sorted(rows, key=lambda x: -(x.get('mcap') or 0))]


def main():
    httpd, base = serve()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 950})
        pg = ctx.new_page()
        pg.on('console', lambda m: console.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console.append('pageerror: ' + str(e)))
        pg.on('response', lambda r: bad.append(r.url) if r.status >= 400 else None)

        def open_map(market='us'):
            pg.goto(base + 'index.html#/market')
            pg.wait_for_timeout(1600)
            mb = pg.locator('[data-mkt="%s"]' % market)
            if mb.count() and ' on' not in (' ' + (mb.first.get_attribute('class') or '')):
                mb.first.click()
                pg.wait_for_timeout(1600)
            pg.locator('[data-scope="SOX"]').first.click()
            pg.wait_for_timeout(700)
            pg.locator('#mapbox canvas').scroll_into_view_if_needed()
            pg.wait_for_timeout(200)

        def state():
            return pg.evaluate("""(()=>{const b=document.querySelector('#mapbox');
              const r=b.__rects||[]; const c=b.querySelector('canvas');
              const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let ink=0;
              for(let i=3;i<d.length;i+=4){if(d[i]>0)ink++;}
              return {n:r.length, keys:r.map(x=>x.key), syms:r.map(x=>x.data&&x.data.sym), ink:ink,
                      note:document.querySelector('#mapbox').previousElementSibling.textContent,
                      pageW:document.documentElement.scrollWidth, winW:innerWidth,
                      area:r.reduce((s,x)=>s+x.w*x.h,0)};})()""")

        def click_cell(key):
            r = pg.evaluate("(k)=>{const b=document.querySelector('#mapbox');const r=(b.__rects||[]).find(x=>x.key===k);"
                            "return r?{x:r.x+r.w/2,y:r.y+r.h/2}:null;}", key)
            if not r:
                return None
            bb = pg.locator('#mapbox canvas').bounding_box()
            pg.mouse.click(bb['x'] + r['x'], bb['y'] + r['y'])
            pg.wait_for_timeout(800)
            return pg.url

        for market in ('us', 'kr'):
            keys = semis(market)
            open_map(market)
            st = state()
            label = '미국' if market == 'us' else '국내'
            check('%s: 반도체 칸 %d개' % (label, len(keys)), st['n'] == len(keys), (st['n'], len(keys)))
            check('%s: 칸 키 = 티커' % label, st['keys'] == keys, st['keys'][:3])
            check('%s: 칸에 종목 심볼' % label, all(a == k for a, k in zip(st['syms'], st['keys'])))
            check('%s: 문구' % label, st['note'].strip() == '반도체 %d종목 · 시가총액 기준 · 정규장 등락률' % len(keys), st['note'])
            check('%s: 그림·넓이' % label, st['ink'] > 5000 and st['area'] > 100000, st['ink'])
            check('%s: 가로 넘침 0' % label, st['pageW'] <= st['winW'], (st['pageW'], st['winW']))
            first = keys[0]
            u = click_cell(first)
            check('%s: %s 칸 → 종목 상세' % (label, first), u and ('#/market/stock/' + first) in u and first in pg.inner_text('body'), u)
            last = keys[-1]
            open_map(market)
            u = click_cell(last)
            check('%s: %s 칸 → 종목 상세' % (label, last), u and ('#/market/stock/' + last) in u, u)

        pg.set_viewport_size({'width': 390, 'height': 844})
        open_map('us')
        st = state()
        check('390px: 칸 %d개' % len(semis('us')), st['n'] == len(semis('us')), st['n'])
        check('390px: 가로 넘침 0', st['pageW'] <= st['winW'], (st['pageW'], st['winW']))

        # 다른 보기는 그대로 — 전체·QQQ 는 업종 칸, SECTOR 는 표
        pg.set_viewport_size({'width': 1280, 'height': 950})
        for scope, want in (('all', 'many'), ('SECTOR', 'table')):
            pg.goto(base + 'index.html#/market')
            pg.wait_for_timeout(1500)
            pg.locator('[data-scope="%s"]' % scope).first.click()
            pg.wait_for_timeout(600)
            if want == 'table':
                check('다른 보기 SECTOR 표', pg.locator('table.mkt').count() >= 1)
            else:
                n = pg.evaluate("(()=>{const b=document.querySelector('#mapbox');const r=b?(b.__rects||[]):[];"
                                "return r.length && r.every(x=>x.data&&x.data.sectorEn&&x.data.count>1)?r.length:-1;})()")
                check('다른 보기 전체 = 섹터 칸 그대로', n > 1, n)

        print('\n콘솔 오류:', len(console), console[:3])
        print('HTTP 실패:', bad[:3])
        fails = [r for r in results if not r[1]]
        print('\n%d/%d 통과' % (len(results) - len(fails), len(results)))
        b.close()
    httpd.shutdown()
    return 1 if fails or console or bad else 0


if __name__ == '__main__':
    sys.exit(main())
