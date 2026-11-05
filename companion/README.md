# herdr-anywhere companion

The Mac side of Herdr Anywhere. It lets a paired phone use herdr-core (`hc`) on this Mac: for each phone WebSocket it
starts one `hc connect` and copies bytes both ways unchanged. The phone speaks herdr-core's protocol itself. The
companion also serves the PWA, so the page and its WebSocket share one origin.

## Use it

```sh
go build ./cmd/herdr-anywhere          # needs Go 1.27.1
./herdr-anywhere serve --lan           # 127.0.0.1:7681 plus this Mac's private LAN address
./herdr-anywhere serve --tailcat       # also reachable through Tailcat, from any network
./herdr-anywhere pair                  # prints a QR code and a link; scan it with the phone
./herdr-anywhere devices               # id, name, created, last seen
./herdr-anywhere revoke <id>           # the device's live connections close within a second
./herdr-anywhere start                 # serve --tailcat in the background, on any free local port; returns once it answers
./herdr-anywhere install-dialog        # adds the Add phone dialog and its key to the Herdr desktop app
```

`pair --json` and `devices --json` are what the dialog reads: `pair --json` prints `{invite, expires, qr}`, with `qr` as
rows of 0 and 1, or `{"error":"not-running"}` and exit 1 without creating a code. `start` logs to `serve.log` (0600) in
the state dir. Its serve lives until the Mac restarts or it is killed; nothing restarts it.

`serve` options: `--listen ADDR` (repeatable), `--lan`, `--tailcat`, `--web DIR` (the PWA build), `--hc PATH`,
`--state DIR`.

With `serve --tailcat` running, `pair` asks it for a Tailcat invite (`herdr1:…`, valid 2 minutes) and prints that as
the QR code for the Herdr Anywhere app, plus the `#pair=` link for the same single-use code when serve listens on the LAN.
The Tailcat identity (private keys) and paired phones' keys are in `tailcat.json` (0600) in the state dir; the
control socket `serve.sock` (0600) is there too, so the state dir path must stay under 103 bytes. `revoke` also drops
the phone from Tailcat, which restarts Tailcat's node: every phone's Tailcat connections drop and reconnect.
`pair` options: `--name`, `--ttl` (default 10m), `--url` (default: this Mac's LAN IPv4 on the port the running `serve`
listens on, else 7681; pass your tailnet name here to pair over the tailnet). `pair` works whether or not `serve` is running; a running `serve` accepts the new code
at once.

`hc` is found as `--hc`, else `hc` on PATH, else `~/.local/bin/hc`; it must print `hc <version>` for `--version`.
`hc connect` inherits the companion's environment, so `HC_SESSION` / `HC_SOCKET` choose the core.

## HTTP

| Route | What |
|---|---|
| `GET /api/info` | `{"name","version","hc"}`; no auth, no secrets |
| `POST /api/pair` | `{"code","device"}` → `{"token","device","name"}`; 401 unknown code, 410 expired or used, 429 after 10 failures a minute from one IP |
| `GET /api/folders?path=` | A folder's subfolders, for picking a space's folder: `{"path","home","parent","git","folders":[{"name","git"}]}`, hidden ones left out unless `hidden=1` (then marked `"hidden":true`); `~` and empty mean home. 404 `{"missing":true,"path","existing"}` when it does not exist (`existing` is the nearest folder above that does), 400 for a file or a relative path. `Authorization: Bearer <token>` |
| `POST /api/folders` | `{"path"}` → `{"path","created"}`: makes the folder and its missing parents, after the phone asked; 409 when part of the path is a file. Same auth |
| `GET /hc?token=…[&enc=b64]` | WebSocket to `hc connect`: binary messages both ways, or base64 text with `enc=b64`. 401 bad token, 403 foreign `Origin`, 503 no hc. Closes with 4401 on revoke, "core closed" when hc exits |
| anything else | files from `--web` |

## Security

herdr-core's API can run any command as you, so whoever holds a device token can too.

- `serve` binds to `127.0.0.1` by default; `--lan` adds only private RFC 1918 addresses, never `0.0.0.0`.
- Pairing codes are single use, 128-bit, and expire after 10 minutes. Device tokens are 256-bit. Only their SHA-256
  hashes are stored, in `~/.config/herdr-anywhere/state.json` (dir 0700, file 0600; `--state` or `HERDR_ANYWHERE_STATE`
  move it).
- A WebSocket with an `Origin` header must come from the companion's own origin. Request logs never include the query
  string, where the token travels.
- Plain `ws://` over the LAN can be read by anyone on that network, token included. Use it on a network you trust, or
  reach the Mac over an encrypted path such as your tailnet.

## Tests

`go test ./...` runs unit tests and, when `~/.local/bin/hc` exists, integration tests against a real herdr-core in its
own scratch session (`HC_SESSION=hmtest-<random>`, scratch XDG dirs, stopped with `hc server stop` afterwards).
`HM_TAILCAT_LIVE=1 go test ./cmd/herdr-anywhere -run TestLiveTailcat -v` also pairs an in-process Go phone through
Tailcat's real relays and opens `/hc` through its forwarder; it needs the internet and `hc`.

Dependencies: `github.com/coder/websocket` (ISC), `github.com/mdp/qrterminal/v3` (MIT) and its `rsc.io/qr` (BSD-3-Clause),
TailPocket (`github.com/jt-wang/tailpocket`, MIT: its packages are copied into
the repository's `third_party/tailpocket-8ae23dd`; it brings in `tailscale.com` and `github.com/tailscale/tailcat`).
