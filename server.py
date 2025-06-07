import http.server
import socketserver
import os

PORT = 8000
WEB_DIR = 'static'

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # To serve files from the 'static' directory
        super().__init__(*args, directory=WEB_DIR, **kwargs)

# This allows the server to be run from any directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at http://localhost:{PORT}")
    print("Open this URL in your browser.")
    print(f"Serving files from the '{os.path.join(os.getcwd(), WEB_DIR)}' directory.")
    print("Press Ctrl+C to stop the server.")
    httpd.serve_forever()
