#!/bin/zsh
# Start crust dev on the Vite example, then call the bridge directly with the
# credentials the page was served — proving the route, token and dev origin
# without relying on a page's console.
set -u
# Capture the human's current app before any launch activates a window.
FRONTMOST=$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' 2>/dev/null)
# Restore on every path, not only on the last line: a kill or a Ctrl-C ends this script
# without reaching the line at the bottom otherwise.
trap 'open -a "${FRONTMOST:-Ghostty}" 2>/dev/null || true' EXIT INT TERM
cd /Users/jyz/dev/crust
bun run src/cli/index.ts dev --dir examples/vite > /tmp/vite3.out 2>&1 &
pid=$!
sleep 7

# The runtime writes the handshake in the OS temp dir, not under the served project.
J=$(bun -e 'import { devHandshakePath } from "./src/dev-handshake-path.ts"; console.log(devHandshakePath(process.argv[1]))' "$PWD/examples/vite")
U=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$J','utf8')).url)")
T=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$J','utf8')).token)")
print -r -- "bridge=$U"

curl -s -o /tmp/invoke.json -w "status=%{http_code}\n" -X POST "$U/_crust/invoke" \
	-H "Authorization: Bearer $T" \
	-H "Origin: http://localhost:5173" \
	-H "content-type: application/json" \
	--data '{"plugin":"app","command":"invoke","args":{"name":"greet","args":{"name":"curl"}}}'
print -r -- "body=$(cat /tmp/invoke.json)"

print -r -- "--- runtime ---"
cat /tmp/vite3.out
kill -TERM $pid 2>/dev/null
wait $pid
pkill -f examples/vite 2>/dev/null
