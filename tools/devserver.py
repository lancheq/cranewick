#!/usr/bin/env python3
"""
devserver.py — CRANEWICK 本地预览服务（禁缓存的静态服务）

为什么不用 `python3 -m http.server`：
  它只发 Last-Modified、**不发 Cache-Control**，浏览器于是按启发式规则把 ES module 缓存住。
  后果是"改了代码但浏览器还在跑旧模块"，症状极难排查 —— 本次就栽在这上面：
  textures.js 明明是新的，页面里 WALLS['quayFlag'] 却是 undefined（拿的是旧模块）。

本服务对所有代码类文件：
  ① 回 `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
  ② 忽略 If-Modified-Since / If-None-Match，始终 200 全量返回
这样"刷新即可见"，不依赖给每个 import 加 ?v= 查询串。

用法：python3 tools/devserver.py [port]     默认 8817
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8817
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_CACHE_EXT = ('.js', '.mjs', '.html', '.htm', '.css', '.json', '.map')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _redirect_root(self):
        if self.path.split('?')[0] == '/':
            self.send_response(302)
            self.send_header('Location', '/launcher.html')
            self.end_headers()
            return True
        return False

    def do_GET(self):
        if self._redirect_root():
            return
        super().do_GET()

    def do_HEAD(self):
        if self._redirect_root():
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path.split('?')[0])
        if path.endswith(NO_CACHE_EXT):
            # 去掉条件请求头 ⇒ 不走 304，始终全量返回
            for h in ('If-Modified-Since', 'If-None-Match'):
                if h in self.headers:
                    del self.headers[h]
        return super().send_head()

    def log_message(self, fmt, *args):
        # 只记录非 200，避免刷屏
        if args and str(args[1]) != '200':
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as httpd:
        print('───────────────────────────────────────────────')
        print(' CRANEWICK 预览服务（禁缓存）')
        print(' 根目录 : %s' % ROOT)
        print(' 启动台 : http://localhost:%d/launcher.html' % PORT)
        print(' 预览   : http://localhost:%d/preview/' % PORT)
        print(' 停止   : 按 Ctrl-C')
        print('───────────────────────────────────────────────')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
