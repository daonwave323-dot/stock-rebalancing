#!/usr/bin/env python3
"""지수 카드 미니차트(6개월·면 채움)·나스닥100 실제 지수·마켓맵 상승/하락 색 검증.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/test_spark_colors.py

확인하는 것
  1) '주요 지수' 첫 칸이 나스닥100(^NDX) 실제 지수이고 값·등락이 live.json 의 정규장 값과 같다
     (QQQ 칸은 이름이 'QQQ' 이고 'ETF 대체' 표기가 남는다)
  2) 카드 클릭 → 큰 차트(#/market/candles/^NDX), 기간 6개월/1년/5년 전환(5년은 주봉)
  3) 미니차트는 최근 126봉(6개월)을 면+선으로 그리고, 선 색이 위 등락 색과 같다
  4) 마켓맵 — 보이는 칸의 최대 등락률을 눈금으로 한 상대 색, 0%만 회색, 0이 아닌 칸은 최소 세기 이상.
     390px·1280px 에서 모든 칸이 최소 크기(한 변 46px) 이상인지 실제 치수로 잰다
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
SHOTS = os.path.join(ROOT, 'screens-spark')
MIN_SIDE = 46
PANEL2 = (46, 54, 70)      # --panel2 #2e3646

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


def load(name):
    with open(os.path.join(ROOT, 'data', name), encoding='utf-8') as f:
        return json.load(f)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    live = load('live.json')
    candles = load('candles.json')
    ndx = live['symbols'].get('^NDX') or {}

    httpd, base = serve()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 950})
        pg = ctx.new_page()
        pg.on('console', lambda m: console.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console.append('pageerror: ' + str(e)))
        pg.on('response', lambda r: bad.append(r.url) if r.status >= 400 else None)

        # ---------------------------------------------------------- ① 지수 카드
        pg.goto(base + 'index.html#/market')
        pg.wait_for_timeout(2500)
        cards = pg.evaluate("""(()=>[...document.querySelectorAll('.idx-cell')].map(c=>{
            const cv=c.querySelector('canvas');
            return {n:c.querySelector('.n').textContent.trim(),
                    p:c.querySelector('.p').textContent.trim(),
                    c:c.querySelector('.c').textContent.trim(),
                    f:c.querySelector('.f').textContent.trim(),
                    sym:cv.getAttribute('data-spark'),
                    pts:Number(cv.getAttribute('data-points')||0),
                    h:cv.clientHeight, disp:cv.style.display,
                    w:cv.clientWidth};}))()""")
        names = [c['n'] for c in cards]
        check('첫 칸이 나스닥100', names and names[0].startswith('나스닥100'), names[:3])
        first = cards[0] if cards else {}
        want_px = '{:,.2f}'.format(ndx.get('regularClose'))
        check('나스닥100 값 = ^NDX 정규장 값', want_px in first.get('p', ''), (first.get('p'), want_px))
        want_chg = '%+.2f%%' % ndx.get('regularChangePct')
        check('나스닥100 등락 = ^NDX 정규장 등락', want_chg in first.get('c', '').replace('▲ ', '').replace('▼ ', ''),
              (first.get('c'), want_chg))
        check('나스닥100 카드가 자기 차트를 가진다', first.get('sym') == '^NDX' and first.get('disp') == 'block'
              and first.get('pts', 0) >= 120, first)
        qqq = [c for c in cards if c['sym'] == 'QQQ']
        check('QQQ 칸 이름이 QQQ + ETF 대체', qqq and qqq[0]['n'].startswith('QQQ') and 'ETF 대체' in qqq[0]['n'],
              qqq[0]['n'] if qqq else None)
        check('모든 지수 칸에 미니차트', all(c['disp'] == 'block' and c['pts'] >= 2 for c in cards),
              [(c['n'], c['pts']) for c in cards if c['disp'] != 'block' or c['pts'] < 2])
        check('미니차트 높이 40px', all(c['h'] == 40 for c in cards), sorted({c['h'] for c in cards}))

        # 6개월 = 최근 126봉(+오늘 값 1개까지)
        pts = [c['pts'] for c in cards]
        check('미니차트 = 6개월(126봉 안팎)', all(120 <= n <= 127 for n in pts), pts)

        # 면 채움 + 선 색 = 등락 색
        ink = pg.evaluate("""(()=>{const out=[];document.querySelectorAll('.idx-cell').forEach(c=>{
            const cv=c.querySelector('canvas'); const ctx2=cv.getContext('2d');
            const d=ctx2.getImageData(0,0,cv.width,cv.height).data;
            let n=0, r=0, g=0, bl=0, low=0;
            const H=cv.height;
            for(let y=0;y<H;y++){for(let x=0;x<cv.width;x++){
              const i=(y*cv.width+x)*4; if(d[i+3]>10){n++; r+=d[i]; g+=d[i+1]; bl+=d[i+2];
                if(y>H*0.82) low++;}}}
            out.push({name:c.querySelector('.n').textContent.trim(), ink:n, low:low,
                      r:Math.round(r/Math.max(1,n)), g:Math.round(g/Math.max(1,n)), b:Math.round(bl/Math.max(1,n)),
                      cls:(c.querySelector('.c span')||{}).className||''});});return out;})()""")
        check('미니차트에 선·면이 그려짐', all(x['ink'] > 400 for x in ink), [(x['name'], x['ink']) for x in ink])
        check('면 채움(아래쪽에도 색)', all(x['low'] > 20 for x in ink), [(x['name'], x['low']) for x in ink])
        greened = [x for x in ink if 'up' in x['cls']]
        redded = [x for x in ink if 'dn' in x['cls']]
        check('상승 칸 선은 초록', greened and all(x['g'] >= x['r'] for x in greened),
              [(x['name'], x['r'], x['g']) for x in greened])
        check('하락 칸 선은 빨강', redded and all(x['r'] >= x['g'] for x in redded),
              [(x['name'], x['r'], x['g']) for x in redded])
        pg.screenshot(path=os.path.join(SHOTS, 'test-idx-1280.png'))

        # ---------------------------------------------------------- ② 큰 차트
        pg.locator('.idx-cell').first.click()
        pg.wait_for_timeout(2000)
        check('카드 클릭 → 큰 차트', '#/market/candles/%5ENDX' in pg.url or '#/market/candles/^NDX' in pg.url, pg.url)
        spans = pg.evaluate("""(()=>{const box=document.querySelector('#cbox');
            return {bars:(box&&box.__bars||[]).length,
                    ranges:[...document.querySelectorAll('[data-range]')].map(x=>x.textContent),
                    span:(document.querySelector('[data-cspan].on')||{}).textContent,
                    note:(document.querySelector('#cnote')||{}).textContent};})()""")
        check('기간 버튼 6개월·1년·5년', spans['ranges'] == ['6개월', '1년', '5년'], spans['ranges'])
        check('기본 6개월 = 126봉', spans['bars'] == 126 and '6개월' in (spans['note'] or ''), spans['bars'])
        pg.query_selector('#cbox').screenshot(path=os.path.join(SHOTS, 'test-chart-6m.png'))
        pg.click('[data-range="1y"]')
        pg.wait_for_timeout(700)
        s1 = pg.evaluate("()=>((document.querySelector('#cbox').__bars||[]).length)")
        check('1년 = 252봉(일봉)', s1 == 252, s1)
        pg.click('[data-range="5y"]')
        pg.wait_for_timeout(700)
        s5 = pg.evaluate("""(()=>({n:(document.querySelector('#cbox').__bars||[]).length,
            span:(document.querySelector('[data-cspan].on')||{}).textContent}))()""")
        check('5년 = 주봉(260봉 안팎)', s5['span'] == '주봉' and 250 <= s5['n'] <= 270, s5)
        pg.query_selector('#cbox').screenshot(path=os.path.join(SHOTS, 'test-chart-5y.png'))
        cndx = candles.get('symbols', {}).get('^NDX') or []
        check('candles.json 에 ^NDX 일봉 5년', len(cndx) >= 1200, len(cndx))
        check('^NDX 마지막 봉 날짜 = live 정규장 날짜', cndx and cndx[-1][0] == ndx.get('regularCloseDate'),
              (cndx[-1][0] if cndx else None, ndx.get('regularCloseDate')))

        # ---------------------------------------------------------- ③ 마켓맵 색
        def map_state():
            return pg.evaluate("""(()=>{
              const box=document.querySelector('#mapbox'); if(!box) return null;
              const cv=box.querySelector('canvas'); const ctx2=cv.getContext('2d');
              const dpr=cv.width/box.clientWidth;
              const rects=box.__rects||[];
              const px=(x,y)=>{const d=ctx2.getImageData(Math.round(x*dpr),Math.round(y*dpr),1,1).data;
                                return [d[0],d[1],d[2],d[3]];};
              const cells=rects.map(r=>{
                const col=px(r.x+r.w/2, r.y+Math.min(6, r.h*0.25));
                return {k:r.key, chg:r.data?r.data.chg:null, w:Math.round(r.w), h:Math.round(r.h),
                        col:col, want:Treemap.colorOf(r.data?r.data.chg:0, box.__scale)};});
              return {n:rects.length, cells:cells, scale:box.__scale,
                      legend:(document.querySelector('.map-legend')||{}).textContent||'',
                      ink:Treemap.colorOf(0.0001, box.__scale), zero:Treemap.colorOf(0, box.__scale),
                      minInk:Treemap.MIN_INK, minSide:Treemap.MIN_SIDE,
                      pageW:document.documentElement.scrollWidth, winW:innerWidth};})()""")

        def open_map(market='us', scope='all'):
            pg.goto(base + 'index.html#/market')
            pg.wait_for_timeout(1800)
            mb = pg.locator('[data-mkt="%s"]' % market)
            if mb.count() and ' on' not in (' ' + (mb.first.get_attribute('class') or '')):
                mb.first.click()
                pg.wait_for_timeout(1800)
            pg.locator('[data-scope="%s"]' % scope).first.click()
            pg.wait_for_timeout(800)

        for market, scope in (('us', 'all'), ('us', 'SOX'), ('kr', 'SOX')):
            open_map(market, scope)
            st = map_state()
            tag = '%s/%s' % (market, scope)
            check('%s 칸 %d개' % (tag, st['n']), st['n'] >= 2, st['n'])
            # 0% 는 회색(--panel2) 그대로, 0이 아닌 칸은 방향에 맞는 색 + 최소 세기
            bad_zero = [c for c in st['cells'] if (c['chg'] == 0) and tuple(c['col'][:3]) != PANEL2]
            check('%s: 0%% 칸은 회색' % tag, not bad_zero, bad_zero[:2])
            flat = [c for c in st['cells'] if c['chg'] not in (None, 0) and tuple(c['col'][:3]) == PANEL2]
            check('%s: 0 아닌 칸은 모두 색이 있다' % tag, not flat, [c['k'] for c in flat][:4])
            wrong = []
            for c in st['cells']:
                if not c['chg']:
                    continue
                r, g, bb = c['col'][:3]
                if c['chg'] > 0 and not (g > r and g > bb):
                    wrong.append((c['k'], 'up', c['chg'], c['col']))
                if c['chg'] < 0 and not (r > g):
                    wrong.append((c['k'], 'dn', c['chg'], c['col']))
            check('%s: 상승 초록·하락 빨강' % tag, not wrong, wrong[:3])
            match = [c for c in st['cells'] if c['want'].replace(' ', '') == 'rgb(%d,%d,%d)' % tuple(c['col'][:3])]
            check('%s: 칸 색 = 상대 눈금 규칙' % tag, len(match) == st['n'], (len(match), st['n']))
            check('%s: 눈금은 화면 최대 등락률' % tag, '눈금은 이 화면 최대 등락률' in st['legend'] and st['scale'] >= 0.5,
                  (st['scale'], st['legend'][-24:]))
            small = [c for c in st['cells'] if min(c['w'], c['h']) < MIN_SIDE]
            check('%s: 모든 칸 한 변 %dpx 이상' % (tag, MIN_SIDE), not small,
                  [(c['k'], c['w'], c['h']) for c in small][:5] or
                  (min(min(c['w'], c['h']) for c in st['cells']), max(min(c['w'], c['h']) for c in st['cells'])))
            check('%s 1280 가로 넘침 0' % tag, st['pageW'] <= st['winW'], (st['pageW'], st['winW']))

        # 최소 세기 보장 — 아주 작은 변동도 눈에 보이는 세기
        ink_ok = pg.evaluate("""(()=>{
          const sc=0.5, out={};
          out.min=Treemap.inkOf(0.0005, sc); out.max=Treemap.inkOf(5, sc); out.zero=Treemap.inkOf(0, sc);
          out.colorSmall=Treemap.colorOf(0.01, sc); out.colorZero=Treemap.colorOf(0, sc);
          return out;})()""")
        check('작은 변동도 최소 세기(0.38) 이상', ink_ok['min'] >= 0.37 and ink_ok['min'] < 0.45, ink_ok['min'])
        check('0% 는 세기 0(회색)', ink_ok['zero'] == 0, ink_ok['zero'])
        check('큰 변동은 최대 세기', ink_ok['max'] >= 0.99, ink_ok['max'])

        # 390px — 국내 반도체(큰 칸 2개 + 작은 칸 9개) 실제 치수
        pg.set_viewport_size({'width': 390, 'height': 844})
        open_map('kr', 'SOX')
        st = map_state()
        check('390 국내 반도체 칸 수 유지', st['n'] == 11, st['n'])
        small = [c for c in st['cells'] if min(c['w'], c['h']) < MIN_SIDE]
        check('390 국내 반도체: 칸 11개 모두 한 변 %dpx 이상' % MIN_SIDE, not small,
              [(c['k'], c['w'], c['h']) for c in st['cells']])
        check('390 가로 넘침 0', st['pageW'] <= st['winW'], (st['pageW'], st['winW']))
        pg.locator('#mapbox').screenshot(path=os.path.join(SHOTS, 'test-map-kr-390.png'))
        open_map('kr', 'all')
        st = map_state()
        small = [c for c in st['cells'] if min(c['w'], c['h']) < MIN_SIDE]
        check('390 국내 섹터 칸도 최소 크기', not small, [(c['k'], c['w'], c['h']) for c in small][:4])
        pg.goto(base + 'index.html#/market')
        pg.wait_for_timeout(2000)
        pg.screenshot(path=os.path.join(SHOTS, 'test-home-390.png'))

        print('\n콘솔 오류:', len(console), console[:3])
        print('HTTP 실패:', bad[:3])
        fails = [r for r in results if not r[1]]
        print('\n%d/%d 통과' % (len(results) - len(fails), len(results)))
        b.close()
    httpd.shutdown()
    return 1 if fails or console or bad else 0


if __name__ == '__main__':
    sys.exit(main())
