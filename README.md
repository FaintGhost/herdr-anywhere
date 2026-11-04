# Herdr Anywhere

Your Herdr spaces and agents, on your phone.

You start a few agents in Herdr and walk away from the Mac. With Herdr Anywhere you keep using them from your phone:
start another agent in any folder, type into any agent's terminal, see which ones are working, done or waiting, and
answer the one that stops to ask. When one is waiting, your phone plays Herdr's "needs you" sound.

The phone shows what the desktop app shows: the same spaces, tabs, panes and agents, live terminals you can type in,
and the agents sorted by who needs you. It talks to the herdr-core on your Mac, with no account to create and no server
of your own to run. Paired through Tailcat, the connection is end-to-end encrypted, also when Tailcat's public relays
carry it. Paired over your LAN, it is not encrypted ([Security](#security)).

Fully open source: change whatever you like.

## Try it

1. On the Mac, install the companion, the small program the phone connects to, and the Add phone dialog:

   ```sh
   mkdir -p ~/.local/bin
   curl -fsSL -o ~/.local/bin/herdr-anywhere https://github.com/jt-wang/herdr-anywhere/releases/latest/download/herdr-anywhere-macos-arm64
   chmod +x ~/.local/bin/herdr-anywhere
   ~/.local/bin/herdr-anywhere install-dialog
   ```

2. On the phone, download [Herdr-Anywhere.apk](https://github.com/jt-wang/herdr-anywhere/releases/latest/download/Herdr-Anywhere.apk) and open it.

3. In the Herdr desktop app press `cmd-shift-m`, press Start, and scan the QR code with the phone app. The phone and the
   Mac can be on different networks from then on.

Paired phones are listed under the code, and you can remove them there. After a restart of the Mac, press Start in the
dialog once.

### From a terminal instead of the dialog

```sh
~/.local/bin/herdr-anywhere serve --tailcat     # keep it running
~/.local/bin/herdr-anywhere pair                # in another terminal: shows a QR code that works once, for 2 minutes
```

`herdr-anywhere devices` lists the paired phones and `herdr-anywhere revoke <id>` cuts one off at once.

### Over your own network only

This uses no relay, and it is not encrypted ([Security](#security)). The phone and the Mac must be on the same network.

```sh
~/.local/bin/herdr-anywhere serve --lan         # keep it running
~/.local/bin/herdr-anywhere pair                # prints a link like http://192.168.1.20:7681/#pair=…
```

Paste the link into the app. It works once, for 10 minutes.

### Setting it up with an AI agent

Point your coding agent at [INSTALL.md](INSTALL.md). It lists the same steps as commands to run in order, with
a check after each one.

## What it does

- **Alerts, as on the desktop.** An agent that becomes blocked or fails always alerts; one that finishes alerts only
  if you weren't looking at it. Each alert plays Herdr's own sound and shows a toast. Settings › Alerts turns each kind
  off.
- **Live terminals.** Each pane streams from herdr-core as it does to the desktop app. A key bar above the keyboard
  has the keys a phone keyboard lacks: Esc, Tab, Ctrl, the arrows, paste and copy.
- **Start work.** Open a new tab or space from the phone, with a shell or one of the agents Herdr knows.
- **Your phone's language.** English, Simplified and Traditional Chinese, Spanish, Korean, Japanese and Russian, following
  the phone. What your agents and the computer say stays as they said it.

## Where it stands

- **Android:** scanning the code and connecting has been tested on a real phone. System notifications post while the
  app is alive; there is no background service, so nothing posts once the system stops the app. The sound has not
  been heard on a real phone yet.
- **iOS:** runs on the simulator so far. It plays the sound and shows the toast while it is open, and posts no system
  notifications. A phone you revoke keeps trying to reconnect instead of asking to pair again.
- **Agents:** the status and the alerts come from each agent's own reports. Claude Code, Pi, Kimi and Antigravity send
  them. OpenCode, Grok, Cursor and Codex 0.159 don't, so they open and work but never alert. Codex 0.163 has the code
  for it, but it has not been seen reporting yet.
- **Languages:** the translations have not been read by native speakers.

## Security

herdr-core can run any command as you, and so can a paired phone. The companion:

- listens on `127.0.0.1` unless you pass `--lan`, which adds your Mac's private LAN address (never `0.0.0.0`);
- accepts only paired phones; a pairing code works once and expires after 10 minutes;
- closes a revoked phone's connections at once.

Through [Tailcat](https://github.com/tailscale/tailcat), which the dialog and `serve --tailcat` use, traffic is
end-to-end encrypted with WireGuard. It goes straight to the Mac when it can, otherwise through Tailcat's public relays,
which see only encrypted packets. Settings › Computer shows which one it is using.

Over `--lan`, traffic is plain `ws://`, which anyone on that network can read. Use it on a network you trust.

## Build from source

The app is TSX on [NSH](https://nsh.dev) 0.3.0, in `app/`. The companion is Go, in `companion/`.

```sh
git clone https://github.com/jt-wang/herdr-anywhere
cd herdr-anywhere/companion
go build -o ~/.local/bin/herdr-anywhere ./cmd/herdr-anywhere    # needs Go 1.27.1 or newer
~/.local/bin/herdr-anywhere install-dialog
```

| | Command | Output |
|---|---|---|
| Android | `app/android/build.sh` (needs a JDK, the Android SDK and NDK, and Go) | `app/android/build/Herdr.apk` |
| iOS simulator | `app/ios/build.sh App.tsx simulator` (needs Xcode, xcodegen and Go) | `app/ios/build/Herdr.app` |
| iPhone, under your Apple account (not yet tried on a phone) | [app/ios/README.md](app/ios/README.md) | `app/ios/build/Herdr.app` |
| Web | `cd app && nsh package --target web -o dist/web` | `app/dist/web/Herdr Anywhere` |
| The release's companion | `cd companion && CGO_ENABLED=0 go build -trimpath -ldflags '-s -w' -o herdr-anywhere-macos-arm64 ./cmd/herdr-anywhere` | `companion/herdr-anywhere-macos-arm64` |

**In a browser instead of an app:** the companion can serve the web build over your network. Start it with the build
and open the link `pair` prints. The app then also posts a system notification when an agent needs you while the page
is in the background; Settings › Alerts asks the browser for permission.

```sh
herdr-anywhere serve --lan --web "app/dist/web/Herdr Anywhere"
```

Tests:

```sh
cd companion && go test ./...
cd app && scripts/test.sh                                # unit and screen tests
ANDROID_SERIAL=emulator-5554 app/e2e/android.sh          # on a device or emulator
SIM_UDID=<simulator udid> app/e2e/ios.sh                 # on a simulator
SIM_UDID=<simulator udid> app/e2e/ios-tailcat.sh         # on a simulator, through TailPocket (needs the internet)
SIM_UDID=<simulator udid> app/e2e/ios-glyphs.sh          # on an iOS 26 simulator: agents' symbols are not the missing box
app/e2e/user-path.sh <folder with the release files>     # INSTALL.md's steps, without Go
```

## License

Herdr Anywhere's own code is [MIT](LICENSE). It uses Herdr's icons, program table and sounds from [herdr-app](https://github.com/herdrdev/herdr-app)
(Apache License 2.0). [NOTICE](NOTICE) lists everything it includes and the licenses.
