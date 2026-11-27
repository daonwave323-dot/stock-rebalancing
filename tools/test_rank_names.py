#!/usr/bin/env python3
"""국내 순위 목록 — 등수 옆 한국어 이름·행 압축 검증 (헤드리스 크로미움).

무아 님 요구(2026-11-28):
  · 등수 바로 옆에 종목 이름이 한 줄로, 이름은 지금보다 크게 — 이름이 코드 아래로 내려가면 안 된다.
  · 국내 종목은 한국어 이름(삼성전자·SK하이닉스 …), 종목코드는 옆에 작게.
  · 390px 첫 화면에 8~10행 이상, 가로 스크롤 없이. 표 머리글은 스크롤해도 위에 붙는다.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/test_rank_names.py
"""
import functools
import http.server
import json
import os
import re
import socketserver
import sys
import threading

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SHOTS = os.path.join(ROOT, 'screens', 'rank')   # 이 시험 전용 폴더 — 다른 화면의 기준 캡처를 덮지 않는다

results = []
console = []
bad = []

HANGUL = re.compile('[가-힣]')


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + str(note) if note else ''))
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


RANK_SEC = """()=>{
  const sec = [...document.querySelectorAll('section.panel')]
    .find(x => x.querySelector('h2') && x.querySelector('h2').textContent.trim() === '순위');
  return sec;
}"""


def main():
    os.makedirs(SHOTS, exist_ok=True)

    # ---------------------------------------------------------- 1. 이름 표(자료)
    names_path = os.path.join(ROOT, 'data', 'names-kr.json')
    check('이름 표 파일 data/names-kr.json 있음', os.path.exists(names_path), names_path)
    names = {}
    asof = ''
    if os.path.exists(names_path):
        doc = json.load(open(names_path, encoding='utf-8'))
        names = doc.get('names') or {}
        asof = doc.get('asOf') or ''
    snap = json.load(open(os.path.join(ROOT, 'data', 'market.json'), encoding='utf-8'))
    kr_codes = [k for k, v in (snap.get('symbols') or {}).items()
                if v.get('market') == 'kr' and k not in ('KOSPI', 'KOSDAQ')]
    missing = [c for c in kr_codes if c not in names]
    check('국내 %d종목 모두 이름 표에 있음' % len(kr_codes), not missing, '빠짐: %s' % missing[:8])
    check('이름 표 기준일 있음', bool(asof), asof)
    hangul = [c for c in kr_codes if c in names and HANGUL.search(names[c]['name'])]
    check('한국어 이름 400종목 이상', len(hangul) >= 400, '%d/%d' % (len(hangul), len(kr_codes)))
    spot = {'005930': '삼성전자', '000660': 'SK하이닉스', '373220': 'LG에너지솔루션',
            '005380': '현대차', '0126Z0': '삼성에피스홀딩스'}
    wrong = {c: names.get(c, {}).get('name') for c, want in spot.items() if names.get(c, {}).get('name') != want}
    check('주요 종목 한국어 이름 일치', not wrong, wrong)

    # ---------------------------------------------------------- 2. 화면
    httpd, base = serve()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.on('console', lambda m: console.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console.append('pageerror: ' + str(e)))
        pg.on('response', lambda r: bad.append(r.url) if r.status >= 400 else None)

        pg.goto(base + 'index.html#/market')
        pg.wait_for_timeout(1500)
        pg.evaluate("()=>{const b=[...document.querySelectorAll('[data-mkt]')].find(x=>x.textContent.trim()==='국내'); if(b) b.click();}")
        pg.wait_for_timeout(1500)
        check('390 국내 탭 열림', pg.evaluate("()=>{const b=document.querySelector('[data-mkt].on'); return !!b && b.textContent.trim()==='국내';}"))

        sec = pg.evaluate_handle(RANK_SEC).as_element()
        check('순위 표 있음', sec is not None)

        # 머리글을 화면 위에 붙여 놓고(스크롤) 그 상태로 잰다.
        pg.evaluate("""()=>{
          const sec=[...document.querySelectorAll('section.panel')].find(x=>x.querySelector('h2')&&x.querySelector('h2').textContent.trim()==='순위');
          const tb=document.querySelector('.topbar').getBoundingClientRect().height;
          const mt=document.querySelector('.mkt-top').getBoundingClientRect().height;
          scrollTo(0, sec.getBoundingClientRect().top+scrollY-tb-mt-4);
        }""")
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(SHOTS, 'rank-390.png'))

        info = pg.evaluate("""()=>{
          const sec=[...document.querySelectorAll('section.panel')].find(x=>x.querySelector('h2')&&x.querySelector('h2').textContent.trim()==='순위');
          const rows=[...sec.querySelectorAll('tbody tr.row')];
          const pick=(r)=>r && {
            rk:(r.querySelector('.rk2')||{}).textContent || '',
            nm:(r.querySelector('.nm2')||{}).textContent || '',
            cd:(r.querySelector('.cd2')||{}).textContent || '',
            nmFont:r.querySelector('.nm2')?getComputedStyle(r.querySelector('.nm2')).fontSize:'',
            nlineH:r.querySelector('.nline')?+r.querySelector('.nline').getBoundingClientRect().height.toFixed(1):-1,
            rowH:+r.getBoundingClientRect().height.toFixed(1),
            nmTop:r.querySelector('.nm2')?+r.querySelector('.nm2').getBoundingClientRect().top.toFixed(1):-1,
            cdTop:r.querySelector('.cd2')?+r.querySelector('.cd2').getBoundingClientRect().top.toFixed(1):-1,
            rkTop:r.querySelector('.rk2')?+r.querySelector('.rk2').getBoundingClientRect().top.toFixed(1):-1,
            code:r.getAttribute('data-stock')
          };
          const th=sec.querySelector('thead th');
          const vh=innerHeight, thB=th.getBoundingClientRect().bottom;
          return {
            rows:rows.length,
            first:rows.slice(0,10).map(pick),
            allRows:rows.map(pick),
            rowH:+rows[0].getBoundingClientRect().height.toFixed(1),
            visible:rows.filter(r=>{const bb=r.getBoundingClientRect();return bb.top>=thB-1&&bb.bottom<=vh;}).length,
            thPos:getComputedStyle(th).position,
            thTop:+th.getBoundingClientRect().top.toFixed(1),
            mktTopBottom:+document.querySelector('.mkt-top').getBoundingClientRect().bottom.toFixed(1),
            wrapW:sec.querySelector('.tbl-wrap').clientWidth,
            scrollW:sec.querySelector('.tbl-wrap').scrollWidth,
            overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
          };
        }""")

        first = info['first']
        check('1등 줄: 등수·이름·코드 순서', first[0]['rk'] == '1' and first[0]['cd'] == first[0]['code'],
              first[0])
        check('1등 이름이 한국어(삼성전자)', first[0]['nm'] == '삼성전자', first[0]['nm'])
        check('이름이 등수와 같은 줄(위 좌표 차이 3px 이내)', abs(first[0]['nmTop'] - first[0]['rkTop']) <= 3,
              'name=%s rk=%s' % (first[0]['nmTop'], first[0]['rkTop']))
        check('이름이 코드와 같은 줄', abs(first[0]['nmTop'] - first[0]['cdTop']) <= 3,
              'name=%s cd=%s' % (first[0]['nmTop'], first[0]['cdTop']))
        check('이름 글자 13px 이상', float(first[0]['nmFont'].replace('px', '')) >= 13, first[0]['nmFont'])
        one_line = [r for r in info['allRows'] if r['nlineH'] > 24]
        check('이름 칸이 모두 한 줄(높이 24px 이하)', not one_line, [r['nm'] for r in one_line][:5])
        tall = [r for r in info['allRows'] if r['rowH'] > 40]
        check('줄 높이 40px 이하', not tall, 'rowH=%s' % info['rowH'])
        korean_first10 = [r['nm'] for r in first if HANGUL.search(r['nm']) or r['nm'] in ('SK', 'NAVER', 'HMM', 'KT&G', 'LG', 'KT', 'GS', 'LS', 'POSCO홀딩스')]
        check('상위 10줄 이름이 한국어', len(korean_first10) == len(first), [r['nm'] for r in first])
        check('첫 화면 8행 이상 보임', info['visible'] >= 8, 'visible=%s rowH=%s' % (info['visible'], info['rowH']))
        check('가로 스크롤 없음(표)', info['scrollW'] <= info['wrapW'] + 1, '%s/%s' % (info['scrollW'], info['wrapW']))
        check('가로 스크롤 없음(화면)', info['overflow'] <= 1, info['overflow'])
        check('표 머리글 sticky', info['thPos'] == 'sticky', info['thPos'])

        # 스크롤해도 머리글이 위(시장 머리)에 붙어 있는지
        pg.evaluate("()=>scrollBy(0, 320)")
        pg.wait_for_timeout(350)
        st = pg.evaluate(r"""()=>{
          const sec=[...document.querySelectorAll('section.panel')].find(x=>x.querySelector('h2')&&x.querySelector('h2').textContent.trim()==='순위');
          const th=sec.querySelector('thead th').getBoundingClientRect();
          const mt=document.querySelector('.mkt-top').getBoundingClientRect();
          // 머리글 밑으로 완전히 들어온 첫 줄 — 그 줄이 머리글에 가리지 않아야 한다.
          const rows=[...sec.querySelectorAll('tbody tr.row')];
          const next=rows.find(r=>r.getBoundingClientRect().bottom>th.bottom+1);
          const cs=getComputedStyle(sec.querySelector('thead th'));
          return {thTop:+th.top.toFixed(1), thBottom:+th.bottom.toFixed(1), mktBottom:+mt.bottom.toFixed(1),
                  nextRowTop:next?+next.getBoundingClientRect().top.toFixed(1):-1,
                  bg:cs.backgroundColor, opaque:!/rgba\(.*,\s*0(\.\d+)?\)$/.test(cs.backgroundColor)};
        }""")
        check('스크롤해도 머리글이 시장 머리 바로 아래', abs(st['thTop'] - st['mktBottom']) <= 3, st)
        # 머리글은 스크롤한 줄 위를 덮으므로, 그 줄이 비쳐 보이지 않게 배경이 불투명해야 한다.
        check('머리글 배경이 불투명(줄이 비치지 않음)', st['opaque'], st['bg'])
        pg.screenshot(path=os.path.join(SHOTS, 'rank-390-scrolled.png'))

        # ------------------------------------------------------ 미국 목록: 회사명 제목 + 티커 작게
        pg.evaluate("()=>{const b=[...document.querySelectorAll('[data-mkt]')].find(x=>x.textContent.trim()==='미국'); if(b) b.click();}")
        pg.wait_for_timeout(1300)
        us = pg.evaluate("""()=>{
          const sec=[...document.querySelectorAll('section.panel')].find(x=>x.querySelector('h2')&&x.querySelector('h2').textContent.trim()==='순위');
          const r=sec.querySelector('tbody tr.row');
          return {nm:r.querySelector('.nm2').textContent, cd:r.querySelector('.cd2').textContent, code:r.getAttribute('data-stock')};
        }""")
        check('미국: 회사명이 제목, 티커가 옆에', us['cdticker' if False else 'cd'] == us['code'] and us['nm'] != us['cd'],
              us)

        # ------------------------------------------------------ 관심 종목 표도 같은 규칙
        pg.evaluate("""()=>{localStorage.setItem('stockrebal.watch.kr', JSON.stringify([
          {sym:'005930',name:'삼성전자'},{sym:'000660',name:'SK하이닉스'},{sym:'373220',name:'LG에너지솔루션'}]));}""")
        pg.goto(base + 'index.html#/market')
        pg.wait_for_timeout(1400)
        pg.evaluate("()=>{const b=[...document.querySelectorAll('[data-mkt]')].find(x=>x.textContent.trim()==='국내'); if(b) b.click();}")
        pg.wait_for_timeout(1500)
        wl = pg.evaluate("""()=>{
          const sec=[...document.querySelectorAll('section.panel')].find(x=>x.querySelector('h2')&&x.querySelector('h2').textContent.trim()==='관심 종목');
          if(!sec) return null;
          const r=sec.querySelector('tbody tr.row');
          if(!r) return null;
          const n=r.querySelector('.nline');
          return {nm:r.querySelector('.nm2').textContent, cd:r.querySelector('.cd2').textContent,
                  nlineH:+n.getBoundingClientRect().height.toFixed(1), rowH:+r.getBoundingClientRect().height.toFixed(1),
                  scrollW:sec.querySelector('.tbl-wrap').scrollWidth, wrapW:sec.querySelector('.tbl-wrap').clientWidth};
        }""")
        check('관심 종목 표: 이름+코드 한 줄', bool(wl) and wl['nlineH'] <= 24 and wl['rowH'] <= 40, wl)
        check('관심 종목 표: 이름이 한국어', bool(wl) and wl['nm'] == '삼성전자', wl and wl['nm'])
        check('관심 종목 표: 가로 넘침 없음', bool(wl) and wl['scrollW'] <= wl['wrapW'] + 1, wl)

        # ------------------------------------------------------ 넓은 화면
        ctx2 = b.new_context(viewport={'width': 1280, 'height': 900})
        pg2 = ctx2.new_page()
        pg2.on('console', lambda m: console.append(m.text) if m.type == 'error' else None)
        pg2.goto(base + 'index.html#/market')
        pg2.wait_for_timeout(1500)
        pg2.evaluate("()=>{const b=[...document.querySelectorAll('[data-mkt]')].find(x=>x.textContent.trim()==='국내'); if(b) b.click();}")
        pg2.wait_for_timeout(1400)
        wide = pg2.evaluate("""()=>{
          const sec=[...document.querySelectorAll('section.panel')].find(x=>x.querySelector('h2')&&x.querySelector('h2').textContent.trim()==='순위');
          const r=sec.querySelector('tbody tr.row');
          return {nm:r.querySelector('.nm2').textContent, nmW:+r.querySelector('.nm2').getBoundingClientRect().width.toFixed(1),
                  cut:r.querySelector('.nm2').scrollWidth>r.querySelector('.nm2').clientWidth+1,
                  cap:getComputedStyle(sec.querySelector('th.c-cap')).display,
                  rowH:+r.getBoundingClientRect().height.toFixed(1)};
        }""")
        check('1280: 이름이 잘리지 않음', wide['nm'] == '삼성전자' and not wide['cut'], wide)
        check('1280: 시가총액 열 보임', wide['cap'] != 'none', wide['cap'])
        pg2.screenshot(path=os.path.join(SHOTS, 'rank-1280.png'))
        ctx2.close()
        ctx.close()
        b.close()

    errs = [c for c in console if 'favicon' not in c]
    check('콘솔 오류 0', not errs, errs[:3])
    bads = [u for u in bad if 'favicon' not in u]
    check('HTTP 404 없음', not bads, bads[:3])

    fails = [r for r in results if not r[1]]
    print('\n%d/%d 통과' % (len(results) - len(fails), len(results)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
