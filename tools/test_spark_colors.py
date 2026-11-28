#!/usr/bin/env python3
"""지수 카드 미니차트(1년·면 채움·다운샘플)·나스닥100 실제 지수·마켓맵 상승/하락 색 검증.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/test_spark_colors.py

확인하는 것
  1) '주요 지수' 첫 칸이 나스닥100(^NDX) 실제 지수이고 값·등락이 live.json 의 정규장 값과 같다
     (QQQ 칸은 이름이 'QQQ' 이고 'ETF 대체' 표기가 남는다)
  2) 카드 클릭(카드·미니차트 캔버스 둘 다) → 큰 차트(#/market/candles/^NDX), 기본 기간 일봉 1년,
     기간 6개월/1년/5년 전환(5년은 주봉)
  3) 미니차트는 최근 252봉(1년) 종가를 그리되 그리는 점을 줄여(다운샘플, data-draw) 꼬불거리지 않게 하고,
     그린 값은 실제 종가이고 큰 차트와 같은 구간·같은 흐름이며, 선 색이 위 등락 색과 같다
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
    candles = load('candles-index.json')      # 지수 봉은 작은 파일에 담긴다(일봉 1년 + 주봉 5년)
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
        pulled = []
        pg.on('request', lambda r: pulled.append(r.url))

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
                    draw:Number(cv.getAttribute('data-draw')||0),
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
              and first.get('pts', 0) >= 250, first)
        qqq = [c for c in cards if c['sym'] == 'QQQ']
        check('QQQ 칸 이름이 QQQ + ETF 대체', qqq and qqq[0]['n'].startswith('QQQ') and 'ETF 대체' in qqq[0]['n'],
              qqq[0]['n'] if qqq else None)
        check('모든 지수 칸에 미니차트', all(c['disp'] == 'block' and c['pts'] >= 2 for c in cards),
              [(c['n'], c['pts']) for c in cards if c['disp'] != 'block' or c['pts'] < 2])
        check('미니차트 높이 40px', all(c['h'] == 40 for c in cards), sorted({c['h'] for c in cards}))

        # 1년 = 최근 252봉(+오늘 값 1개까지)
        pts = [c['pts'] for c in cards]
        check('미니차트 = 1년(252봉 안팎)', all(250 <= n <= 253 for n in pts), pts)

        # 그리는 점은 줄인다 — 1년 봉을 다 찍으면 좁은 카드에서 지렁이처럼 꼬불거린다
        draws = [c['draw'] for c in cards]
        check('미니차트는 그리는 점을 줄인다(넓은 카드 20~30점 안팎)', all(20 <= n <= 62 for n in draws), draws)
        check('그리는 점이 자료 봉 수보다 훨씬 적다', all(d <= p / 4 for d, p in zip(draws, pts)), list(zip(draws, pts))[:3])

        # 증시 탭 첫 화면은 지수 봉만 담은 작은 파일만 받는다(종목 봉 큰 파일은 상세를 열 때만).
        check('첫 화면이 지수 봉 파일을 받는다', any(u.endswith('data/candles-index.json') for u in pulled), pulled[-4:])
        check('첫 화면이 종목 봉 큰 파일을 받지 않는다',
              not any(u.split('?')[0].endswith('/data/candles.json') for u in pulled),
              [u for u in pulled if 'candles' in u])

        # 면 채움 + 선 색 = 등락 색
        # 선 색 = 등락 색, 그린 값은 실제 종가, 큰 차트와 같은 구간·같은 흐름
        shape = pg.evaluate("""(()=>{const out=[];document.querySelectorAll('.idx-cell').forEach(c=>{
            const cv=c.querySelector('canvas');const s=cv.__spark||{closes:[],draw:[]};
            const cl=s.closes,dr=s.draw;const set=new Set(cl.map(v=>v.toFixed(4)));
            let real=dr.every(v=>set.has(v.toFixed(4)));
            const n=cl.length,k=dr.length;
            const lo=Math.min(...dr),hi=Math.max(...dr),lo2=Math.min(...cl),hi2=Math.max(...cl);
            const na=v=>(v-lo)/((hi-lo)||1), nb=v=>(v-lo2)/((hi2-lo2)||1);
            let dev=0;
            for(let i=0;i<k;i++){const j=Math.round(i*(n-1)/(k-1));dev=Math.max(dev,Math.abs(na(dr[i])-nb(cl[j])));}
            const nm=c.querySelector('.n').textContent.trim().split('\\n')[0];
            out.push({name:nm,src:n,draw:k,real:real,dev:dev,first:dr[0]===cl[0],last:dr[k-1]===cl[n-1],
                      range:cv.getAttribute('data-range')});});return out;})()""")
        check('그린 점이 모두 실제 종가(값을 지어내지 않음)', all(x['real'] for x in shape),
              [(x['name'], x['real']) for x in shape if not x['real']])
        check('첫 점·끝 점이 실제 처음·마지막 종가', all(x['first'] and x['last'] for x in shape),
              [(x['name'], x['first'], x['last']) for x in shape if not (x['first'] and x['last'])])
        check('미니차트 흐름이 1년 종가와 같다(정규화 최대 차이 < 0.2)', all(x['dev'] < 0.2 for x in shape),
              [(x['name'], round(x['dev'], 3)) for x in shape])
        check('카드마다 1년 구간을 적는다', all(len((x['range'] or '').split('~')) == 2 for x in shape),
              [x['range'] for x in shape])

        # 꺾임 총량이 자료 봉을 다 그린 것보다 훨씬 적은지 — 같은 캔버스 좌표에서 잰다(작을수록 완만)
        turn = pg.evaluate("""(()=>{function turn(vals,W){
            const n=vals.length,lo=Math.min(...vals),hi=Math.max(...vals);
            const yf=v=>4+(hi-v)/((hi-lo)||1)*30, xf=i=>i/(n-1)*(W-3)+1.5;
            let prev=null,sum=0;
            for(let i=1;i<n;i++){const a=Math.atan2(yf(vals[i])-yf(vals[i-1]),xf(i)-xf(i-1));
              if(prev!==null)sum+=Math.min(Math.abs(a-prev),Math.PI*2-Math.abs(a-prev)); prev=a;}
            return Math.round(sum*180/Math.PI);}
          const out=[];document.querySelectorAll('.idx-cell').forEach(c=>{const cv=c.querySelector('canvas');
            out.push({name:c.querySelector('.n').textContent.trim().split('\\n')[0],
                      draw:turn(cv.__spark.draw,cv.clientWidth),
                      raw:turn(cv.__spark.closes,cv.clientWidth)});});return out;})()""")
        check('미니차트 선이 자료를 다 그린 것보다 4배 이상 완만하다(꺾임 총량)',
              all(x['draw'] * 4 <= x['raw'] for x in turn), [(x['name'], x['draw'], x['raw']) for x in turn])

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

        # ---------------------------------------------------------- ② 카드 → 큰 차트(미니차트 캔버스를 직접 눌러도)
        pg.locator('.idx-cell canvas').first.click(position={'x': 24, 'y': 16})
        pg.wait_for_timeout(2000)
        check('미니차트 캔버스 클릭 → 캔들 화면', '#/market/candles/%5ENDX' in pg.url or '#/market/candles/^NDX' in pg.url, pg.url)
        pg.go_back()
        pg.wait_for_timeout(1800)
        check('뒤로 → 증시 홈(미니차트 살아 있음)',
              pg.evaluate("()=>document.querySelectorAll('canvas.spark[data-draw]').length") >= 7)

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
        check('기본 = 일봉 1년 252봉', spans['bars'] == 252 and '1년' in (spans['note'] or ''), (spans['bars'], spans['note']))
        pg.query_selector('#cbox').screenshot(path=os.path.join(SHOTS, 'test-chart-6m.png'))
        pg.click('[data-range="6m"]')
        pg.wait_for_timeout(700)
        s6 = pg.evaluate("()=>((document.querySelector('#cbox').__bars||[]).length)")
        check('6개월 = 126봉(일봉)', s6 == 126, s6)
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
        wndx = candles.get('weekly', {}).get('^NDX') or []
        check('candles-index.json에 ^NDX 일봉 1년', len(cndx) == 252, len(cndx))
        check('candles-index.json에 ^NDX 주봉 5년', len(wndx) >= 250, len(wndx))
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
        pg.reload()                      # 앞 시험이 바꿔 둔 탭·기간을 기본값으로 되돌린다
        pg.wait_for_timeout(2400)
        # 390px 카드(폭 158px 안팎) — 1년 자료에 점을 더 줄여 그린다
        small_cards = pg.evaluate("""(()=>[...document.querySelectorAll('.idx-cell')].map(c=>{
            const cv=c.querySelector('canvas');
            return {name:c.querySelector('.n').textContent.trim().split('\\n')[0],
                    w:Math.round(c.getBoundingClientRect().width), cvW:cv.clientWidth,
                    pts:Number(cv.getAttribute('data-points')||0), draw:Number(cv.getAttribute('data-draw')||0),
                    disp:cv.style.display};}))()""")
        check('390: 카드 폭 170px 미만', all(x['w'] < 170 for x in small_cards),
              sorted({x['w'] for x in small_cards}))
        check('390: 미니차트 1년(252봉) 유지', all(x['pts'] >= 250 and x['disp'] == 'block' for x in small_cards),
              [(x['name'], x['pts']) for x in small_cards])
        check('390: 그리는 점을 더 줄인다(24점 이하)', all(12 <= x['draw'] <= 24 for x in small_cards),
              [(x['name'], x['draw']) for x in small_cards])
        check('390: 1280보다 점이 적다', all(x['draw'] < max(draws) for x in small_cards),
              (sorted({x['draw'] for x in small_cards}), max(draws)))
        ow = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        check('390 증시 홈 가로 넘침 0', ow <= 1, ow)
        pg.locator('section.panel').first.screenshot(path=os.path.join(SHOTS, 'test-idx-390.png'))
        pg.screenshot(path=os.path.join(SHOTS, 'test-home-390.png'))

        # 390px: 미니차트 캔버스 탭 → 큰 차트도 일봉 1년
        pg.locator('.idx-cell canvas').first.click(position={'x': 20, 'y': 16})
        pg.wait_for_timeout(2200)
        check('390: 미니차트 탭 → 캔들 화면', '#/market/candles/' in pg.url, pg.url)
        m = pg.evaluate("""(()=>({bars:(document.querySelector('#cbox').__bars||[]).length,
            range:(document.querySelector('[data-range].on')||{}).textContent,
            span:(document.querySelector('[data-cspan].on')||{}).textContent}))()""")
        check('390: 캔들 화면도 기본 일봉 1년(252봉)', m['bars'] == 252 and m['range'] == '1년' and m['span'] == '일봉', m)
        pg.screenshot(path=os.path.join(SHOTS, 'test-candle-390.png'))

        print('\n콘솔 오류:', len(console), console[:3])
        print('HTTP 실패:', bad[:3])
        fails = [r for r in results if not r[1]]
        print('\n%d/%d 통과' % (len(results) - len(fails), len(results)))
        b.close()
    httpd.shutdown()
    return 1 if fails or console or bad else 0


if __name__ == '__main__':
    sys.exit(main())
