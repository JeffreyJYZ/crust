#!/bin/zsh
# Start crust dev on the Vite example, then call the bridge directly with the
# credentials the page was served — proving the route, token and dev origin
# without relying on a page's console.
set -u
cd /Users/jyz/dev/crust
bun run src/cli/index.ts dev --dir examples/vite > /tmp/vite3.out 2>&1 &
pid=$!
sleep 7

J=examples/vite/.crust/dev.json
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
