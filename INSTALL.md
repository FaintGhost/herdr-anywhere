# Installing Herdr Anywhere (for AI agents)

Run these steps in order on the user's Mac. They only download files from the latest release; nothing is cloned or
built. Each step ends with a check; stop and tell the user what failed if a check does not pass.

## 1. herdr-core is installed

```sh
hc --version || ~/.local/bin/hc --version
```

Passes when it prints `hc <version>`. If neither command exists, ask the user to install Herdr
(https://github.com/herdrdev/herdr-app, whose installer also installs herdr-core). Do not run that installer without
the user's go.

## 2. Download the companion

```sh
uname -m
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/herdr-anywhere https://github.com/jt-wang/herdr-anywhere/releases/latest/download/herdr-anywhere-macos-arm64
chmod +x ~/.local/bin/herdr-anywhere
~/.local/bin/herdr-anywhere --version
```

Passes when `uname -m` prints `arm64` and the last command prints `herdr-anywhere <version>`. On an Intel Mac (`x86_64`)
stop before downloading: there is no ready-made companion for it, and the user has to build one (see the README's
Build from source). If `~/.local/bin` is not on the user's PATH, call it by its full path below.

## 3. Add the pairing dialog to the Herdr desktop app

Tell the user first: the dialog is a Herdr mod that runs `herdr-anywhere` on this Mac, and this step adds one key to their
`keys.json`.

```sh
~/.local/bin/herdr-anywhere install-dialog
```

Passes when it prints `Add phone is installed`. It says which key opens the dialog (`cmd-shift-m`, or the key to bind
yourself if that one is taken). If it says to open Herdr once, do that and run it again. Run it again after moving the
`herdr-anywhere` binary: the dialog keeps its full path.

## 4. Pair the phone

Tell the user to install the app on their Android phone from https://github.com/jt-wang/herdr-anywhere/releases/latest/download/Herdr-Anywhere.apk, press the
dialog's key in Herdr, press Start, and scan the QR code with the app. An iPhone has no ready-made app yet: the user has
to build it (see the README's Build from source).

Check:

```sh
~/.local/bin/herdr-anywhere devices
```

Passes when the phone is listed. `herdr-anywhere revoke <id>` removes it.

## If the user doesn't use the Herdr desktop app

Run this in a terminal the user keeps open, then show them the QR code `pair` prints from another terminal. It works
once, for 2 minutes.

```sh
herdr-anywhere serve --tailcat
herdr-anywhere pair
```

## If the user wants their own network only

This uses no relay and is not encrypted: anyone on that network can read it. Tell the user before choosing it.

```sh
herdr-anywhere serve --lan
curl -fsS http://127.0.0.1:7681/api/info    # passes when it prints JSON
herdr-anywhere pair
```

Give the user the printed link (`http://<LAN address>:7681/#pair=…`) to paste into the app. It works once and expires
after 10 minutes. If serve says `--lan: this Mac has no private IPv4 LAN address`, the Mac is not on a Wi-Fi or Ethernet
network the phone could share.
