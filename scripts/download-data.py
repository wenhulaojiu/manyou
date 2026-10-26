"""Optional download fallback using the OS proxy. Does not execute downloaded data."""
import sys
import shutil
import urllib.request
with urllib.request.urlopen(sys.argv[1], timeout=180) as response, open(sys.argv[2], 'wb') as output:
    shutil.copyfileobj(response, output)
