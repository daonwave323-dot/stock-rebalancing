#!/usr/bin/env python3
"""반도체(SOXL) 리뉴얼 화면 점검 — 콘솔 오류·가로 넘침·화면 요소 확인 + 캡처.
   LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/soxl_smoke.py [base_url] [out_dir]"""
import functools, http.server, socketserver, threading, os, sys, json
from playwright.sync_api import sync_playwright

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=sys.argv[2] if len(sys.argv)>2 else '/workspace/screens-soxl'
os.makedirs(OUT, exist_ok=True)
use_local = len(sys.argv)<2 or sys.argv[1]=='local'
errs=[]; bad=[]
def run(pg, base, w):
    def shot(name, full=False):
        p=os.path.join(OUT,name)
        pg.screenshot(path=p, full_page=full)
        return p
    pg.goto(base+'#/gauge', wait_until='networkidle'); pg.wait_for_timeout(1000)
    pg.click('[data-target="sox"]'); pg.wait_for_timeout(900)
    pg.evaluate("()=>{const c=document.querySelector('.g-card'); c.scrollIntoView({block:'start'}); window.scrollBy(0,-8);}")
    pg.wait_for_timeout(300)
    print('score', pg.eval_on_selector('#gScore','e=>e.textContent'), '| verdict', pg.eval_on_selector('#gVerdict','e=>e.textContent'))
    print('brake', pg.evaluate("()=>!!document.querySelector('#gBrake')"), 'backtest', pg.evaluate("()=>!!document.querySelector('#gBacktest')"))
    shot('soxl-gauge-%d.png'%w)
    pg.click('[data-toggle="crash"]'); pg.wait_for_timeout(1000)
    pg.evaluate("()=>{const s=document.querySelector('.g-sec[data-sec=crash]'); s.scrollIntoView({block:'start'}); window.scrollBy(0,-8);}")
    pg.wait_for_timeout(400)
    print('crash rows', pg.evaluate("()=>document.querySelectorAll('.g-crashrow').length"))
    shot('soxl-crash-%d.png'%w)
    pg.goto(base+'#/', wait_until='networkidle'); pg.wait_for_timeout(900)
    pg.evaluate("()=>{const c=document.querySelector('.score-card.sox'); if(c) c.scrollIntoView({block:'center'});}")
    pg.wait_for_timeout(300)
    shot('soxl-home-%d.png'%w)
    print('overflow', pg.evaluate("()=>document.documentElement.scrollWidth - document.documentElement.clientWidth"))
    print('errs', len(errs), errs[:4])
    print('404s', len(bad), bad[:4])
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
if use_local:
    httpd=socketserver.TCPServer(('127.0.0.1',0), functools.partial(H,directory=ROOT))
    httpd.allow_reuse_address=True
    threading.Thread(target=httpd.serve_forever,daemon=True).start()
    base='http://127.0.0.1:%d/'%httpd.server_address[1]
else:
    base=sys.argv[1]
with sync_playwright() as pw:
    b=pw.chromium.launch(args=['--no-sandbox'])
    for w in (390,1280):
        pg=b.new_page(viewport={'width':w,'height':844 if w==390 else 950})
        pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
        pg.on('response', lambda r: bad.append(r.url) if r.status>=400 else None)
        run(pg, base, w)
        pg.close()
    b.close()
if use_local: httpd.shutdown()
