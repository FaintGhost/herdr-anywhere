# Changelog

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
