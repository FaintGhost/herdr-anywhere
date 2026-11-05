# Changelog

## v0.1.5

Herdr Anywhere stays with your agents after you put the phone down, and the terminal now behaves like one on a phone.

**It stays connected**

- On Android the app keeps its connection in the background, with a quiet notification saying so, and an agent's question reaches you as a notification while you're away. Settings can turn this off. The app asks once to post notifications.
- A connection that died without a word no longer sits there showing Connected: the app notices in about 15 seconds and reconnects, through TailPocket too.

**The terminal**

- Scrolling carries on after your finger lifts and slows down.
- Lines with emoji and Chinese stay in their columns.
- The keyboard opening no longer resizes the terminal, which printed a long answer into the scrollback twice.
- Links open wherever they are, even wrapped across rows. Press and drag selects text.
- Two fingers no longer change the text size: it's in Settings.
- Settings and other screens open with the keyboard put away, not half hidden under it.

**Telling agents what to do**

- The composer grows with what you type, for several lines.
- The key row has Enter, and Ctrl turns the keys it can combine into Ctrl+Enter, Ctrl+Tab and Ctrl+arrows.
- Attach photos and files up to 2 GB: their path goes in your message, and the file lands where the terminal runs, on another machine too.

**Agents and panes**

- Add an agent from a space's header or from any space on home.
- Home and each pane show what the agent is doing.
- Split right and Split down work on a phone: it says what a small screen costs, then shows the panes side by side, and a tap picks the one you're typing to.

Android: `Herdr-Anywhere.apk`, which updates an installed 0.1.3. Mac: `herdr-anywhere-macos-arm64`, which attachments need.

## v0.1.4

The README's Try it goes straight to the steps. `INSTALL.md` checks the Mac and Herdr for you.

Build the app for your own iPhone under your own Apple account: `app/ios/README.md`. Try it on the pairing screen opens the app on sample data, with no computer. Settings and the pairing screen link to the privacy page.

No new app or companion: the download links still give the v0.1.3 files.

## v0.1.3

Herdr Anywhere has its own icon: a ram drawn for this app, with a curled horn, the prompt on its face and signal arcs above its head. It replaces the previous icon.

- On Android the icon follows the shape your launcher uses, and the notification icon is the new ram too.
- iOS builds now have an app icon.

Android: `Herdr-Anywhere.apk`, which updates an installed 0.1.2. Mac: `herdr-anywhere-macos-arm64`, unchanged apart from the version it prints.

## v0.1.2

The terminal now carries the symbols agents print, so they no longer depend on the fonts of the phone.

- Claude Code's `⎿` and Pi's spinner no longer show as a box with a question mark. Found on the iOS 26.3 simulator.
- More technical symbols come with the app too: `⎰`–`⎽` and `⏜`–`⏡`.

Android: `Herdr-Anywhere.apk`, which updates an installed 0.1.1. Mac: `herdr-anywhere-macos-arm64`.

## v0.1.1

Using Herdr Anywhere no longer takes a clone or Go. The release holds everything ready to run, under names that stay the same from one version to the next.

- `herdr-anywhere-macos-arm64`: the companion for Apple silicon Macs. The README's Try it installs it with one command.
- `Herdr-Anywhere.apk`: the Android app. It updates an installed 0.1.0.
- `INSTALL.md` now only downloads these files, so a coding agent can set it up without building anything. Building, for an Intel Mac, an iPhone or the browser, has its own section in the README.

## v0.1.0

The first public release. Use the agents running in Herdr on your Mac from your phone.

- See which agents need you, answer them, and open any terminal, from an Android or iOS app or a browser.
- Pair by pressing `cmd-shift-m` in the Herdr desktop app and scanning a QR code. It then connects from any network, end-to-end encrypted, with no account to create.
- Settings › Computer shows whether the connection is direct or through a relay. You can remove a phone from the dialog or with `herdr-anywhere revoke`.
- A sound and a toast when an agent needs you or finishes; system notifications on Android and in the browser while the app is alive.
- In English, 简体中文, 繁體中文, 日本語, 한국어, Español and Русский.

Android: `Herdr-Anywhere-0.1.0.apk` below. iOS: build it with Xcode, simulator tested so far.
