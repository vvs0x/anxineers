"""Generate the participant QR and display page. Requires: pip install 'qrcode[pil]'."""
import argparse
from html import escape
from pathlib import Path
from urllib.parse import urlsplit

import qrcode

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('url', help='Confirmed HTTPS experience root, e.g. https://10.4.25.20:8443')
args = parser.parse_args()
url = args.url.rstrip('/')
parsed = urlsplit(url)
if parsed.scheme != 'https' or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
    parser.error('Use the HTTPS experience root URL, without a path, credentials, query, or fragment.')

public = Path(__file__).resolve().parents[1] / 'public'
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=20, border=4)
qr.add_data(url)
qr.make(fit=True)
qr.make_image(fill_color='black', back_color='white').save(public / 'join-qr.png')
matrix = qr.get_matrix()
size = len(matrix)
path = ' '.join(f'M{x},{y}h1v1h-1z' for y, row in enumerate(matrix) for x, black in enumerate(row) if black)
(public / 'join-qr.svg').write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size * 20}" height="{size * 20}" shape-rendering="crispEdges"><title>Join {escape(url)}</title><rect width="100%" height="100%" fill="white"/><path d="{path}" fill="black"/></svg>\n''')
safe_url = escape(url, quote=True)
(public / 'join.html').write_text('''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Join the experience · I am still here</title>
  <style>
    @font-face { font-family:Roboto Mono; src:url('/fonts/RobotoMono-Variable.ttf') format('truetype'); font-display:swap; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100svh; display:grid; place-items:center; padding:28px 20px; background:#08090b; color:#edf2f6; font:14px/1.6 'Roboto Mono',monospace; text-align:center; }
    main { width:min(100%,600px); }
    .brand { margin:0 0 12px; color:#9fc4ff; font-size:12px; letter-spacing:1px; }
    h1 { font-size:clamp(24px,5vw,36px); line-height:1.3; font-weight:500; margin:0 0 12px; }
    .instructions { color:#b9c6d2; margin:0 auto 24px; max-width:440px; }
    .qr { display:block; width:min(100%,420px); margin:0 auto; background:white; border-radius:12px; overflow:hidden; }
    img { display:block; width:100%; height:auto; }
    .address { display:inline-block; margin:18px 0; color:#b5cfea; overflow-wrap:anywhere; }
    .download { display:inline-block; padding:10px 18px; border:1px solid #ffffff30; border-radius:24px; color:#d5dde8; text-decoration:none; }
    a:focus-visible { outline:3px solid #9fc4ff; outline-offset:5px; }
    @media print { body { background:white; color:black; } .brand,.instructions,.address { color:black; } .download { display:none; } }
  </style>
</head>
<body>
  <main>
    <p class="brand">I am still here</p>
    <h1>Join the experience</h1>
    <p class="instructions">Connect to <strong>eth-visitors</strong> Wi-Fi,<br>then scan to begin.</p>
    <a class="qr" href="''' + safe_url + '''"><img src="/join-qr.svg" width="740" height="740" alt="QR code to join the experience at ''' + safe_url + '''"></a>
    <a class="address" href="''' + safe_url + '''">''' + safe_url + '''</a>
    <div><a class="download" href="/join-qr.png" download>Download QR code</a></div>
  </main>
</body>
</html>
''')
print(f'Generated join-qr.png, join-qr.svg and join.html for {url}')
