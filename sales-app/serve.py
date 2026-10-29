#!/usr/bin/env python3
"""Serve the sales app on the local network so phones on the same Wi-Fi can open it.

Usage:  python3 serve.py [port]
"""
import http.server
import os
import socket
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map[".webmanifest"] = "application/manifest+json"

with socketserver.ThreadingTCPServer(("", PORT), handler) as httpd:
    print(f"على الكمبيوتر:  http://localhost:{PORT}")
    print(f"على الموبايل:   http://{local_ip()}:{PORT}")
    print("Ctrl+C للإيقاف")
    httpd.serve_forever()
