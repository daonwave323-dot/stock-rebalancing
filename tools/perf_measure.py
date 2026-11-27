#!/usr/bin/env python3
"""최적화 측정 — 커밋 전/후 첫 화면 표시 시간, 받는 요청 수·바이트.

  python3 tools/perf_measure.py <root> [label]
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(root):
    httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(H, directory=root))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, 'http://127.0.0.1:%d/' % httpd.server_address[1]


def measure(root, label):
    httpd, base = serve(root)
    from playwright.sync_api import sync_playwright
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, hash_path in (('home', '#/'), ('market', '#/market')):
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, bypass_csp=True)
            pg = ctx.new_page()
            sizes = []

            def on_response(r):
                try:
                    h = r.headers
                    n = int(h.get('content-length') or 0)
                    if n:
                        sizes.append((r.url.split('/')[-1], n))
                except Exception:
                    pass
            pg.on('response', on_response)
            reqs = []
            pg.on('request', lambda r: reqs.append(r.url))
            pg.goto(base + 'index.html' + hash_path, wait_until='load')
            pg.wait_for_timeout(2500)
            metrics = pg.evaluate("""() => {
                const nav = performance.getEntriesByType('navigation')[0] || {};
                const paints = performance.getEntriesByType('paint');
                const res = performance.getEntriesByType('resource');
                let bytes = 0;
                res.forEach(r => { bytes += (r.transferSize || 0); });
                return {
                    domContentLoaded: nav.domContentLoadedEventEnd || null,
                    loadEvent: nav.loadEventEnd || null,
                    firstPaint: (paints.find(p => p.name === 'first-paint') || {}).startTime || null,
                    firstContentfulPaint: (paints.find(p => p.name === 'first-contentful-paint') || {}).startTime || null,
                    requests: res.length + 1,
                    transferBytes: bytes + (nav.transferSize || 0),
                    bodyLen: document.body.innerText.length
                };
            }""")
            out[name] = metrics
            ctx.close()
        b.close()
    httpd.shutdown()
    print(label, json.dumps(out, ensure_ascii=False))
    return out


if __name__ == '__main__':
    root = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else root
    measure(os.path.abspath(root), label)
