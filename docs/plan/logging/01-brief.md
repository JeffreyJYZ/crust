# An informative log system

Today `logging` is a sink: `write({ level, message })`, a 1 MiB file with one archive, a 200-line ring
and `tail`. Nothing calls it. A crust app therefore logs only what its author remembers to log, as
`ISO LEVEL message`, which cannot be queried by field.

Goal: the framework writes the story of a run itself, structured enough to answer "why did this invoke
fail" without adding print statements.

## Format

One JSON object per line (JSONL), in `logs/app.jsonl` under the app's data directory.

```
ts         ISO 8601 with milliseconds
level      trace | debug | info | warn | error
source     app · window · bridge · page · platform · plugin
event      stable dotted name, e.g. bridge.invoke, window.create, page.error
msg        one human sentence
…fields    source-specific, listed below
pid        process id, so a dev restart's lines are separable
seq        monotonic per process, so ordering survives equal timestamps
```

Source fields, and they are the whole point:

```
bridge.invoke     window, ns, cmd, durMs, ok, code (on failure), bytesIn, bytesOut
bridge.refuse     reason (origin, token, capability), window, ns, cmd
window.*          label, width, height, visible, event (create/close/focus/resize)
app.*             version, config summary (window count, capabilities count — never secrets)
page.console      level, args (serialised, truncated), url
page.error        message, stack (first frames), url, line, col
platform.*        api, code, detail — everything a `not-implemented` refusal already carries
```

Never logged: bearer tokens, seed tokens, keychain/stronghold values, file contents. A redaction pass
runs over fields by name (`token`, `secret`, `password`, `key`) and over the message string, because a
URL can carry a token in its query.

## Files and rotation

```
logs/app.jsonl          live file, rotates at 5 MiB
logs/app.1.jsonl …      3 generations, oldest deleted last
logs/errors.jsonl       warn and above only, rotates at 5 MiB, 1 generation
```

`tail { limit, level?, source?, since? }` reads the live file and answers parsed objects, not strings.
A corrupt line is returned with `raw` set rather than breaking the read.

## Config

```
logging: {
  level: "info",        // default; "debug" in crust dev unless set
  console: false,       // mirror warn+ to stderr with the human line
  dir: "logs",          // relative to the app data dir
  generations: 3,
  maxBytes: 5242880,
}
```

`crust dev` streams `debug` to the terminal so a person watching sees the same events. A built app
writes files and stays quiet unless `console` is set.

## Wiring (automatic, no author code)

- app start/ready/quit, config summary, versions, platform and arch
- window create/close/focus/resize, with label and frame
- every bridge invoke: duration, outcome, code, and the labels that made it possible to attribute a
  failure to a window
- page console and uncaught errors, captured in the page's own world by the existing content-world
  script (the `testing` console tap is evidence this works)
- every `not-implemented` and platform error, with the API that refused

## Proof

An e2e that runs a scratch app, drives one invoke that succeeds and one that fails (a missing grant),
throws from the page, closes the window, and then asserts on the JSONL: every expected `event` present,
the failure carries `code: "forbidden"`, `durMs` is a number, no line contains the bridge token, and
rotation produced `app.1.jsonl` after writing past `maxBytes`.
