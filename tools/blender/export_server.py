#!/usr/bin/env python3
"""Static server for canal_airship.html plus a POST sink for the scene export."""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'renders')
os.makedirs(OUT, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        if '/__upload' not in (args[0] if args else ''):
            super().log_message(fmt, *args)

    def do_POST(self):
        if not self.path.startswith('/__upload/'):
            self.send_error(404)
            return
        name = os.path.basename(self.path[len('/__upload/'):]) or 'scene.glb'
        length = int(self.headers.get('Content-Length', 0))
        remaining = length
        dest = os.path.join(OUT, name)
        with open(dest, 'wb') as f:
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 20, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok')
        print(f'[upload] {name} {length} bytes -> {dest}', flush=True)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
