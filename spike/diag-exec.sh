#!/bin/zsh
# Diagnostic: which binaries hang at exec on this machine?
# Each candidate runs in the background for 3s; ALIVE after 3s = hung.

probe() {
	local label="$1"; shift
	"$@" >/tmp/diag.out 2>&1 </dev/null &
	local pid=$!
	local waited=0
	while (( waited < 30 )); do
		if ! kill -0 $pid 2>/dev/null; then
			wait $pid 2>/dev/null
			printf '%-22s EXIT rc=%s  out=%s\n' "$label" "$?" "$(head -c 120 /tmp/diag.out | tr '\n' ' ')"
			return
		fi
		sleep 0.1
		(( waited++ ))
	done
	printf '%-22s HUNG (alive after 3s)\n' "$label"
	kill -9 $pid 2>/dev/null
}

probe "echo"        /bin/echo ok
probe "git"         git --version
probe "node"        node --version
probe "bun"         bun --version
probe "python3"     python3 --version
probe "codesign"    codesign -dv /bin/ls
probe "sw_vers"     sw_vers
probe "rg"          rg --version
probe "uname"       uname -a
