# Contributing to Herdr Anywhere

A pull request that shows it works gets merged quickly. Here is what that takes.

## 1. Write the test first and watch it fail

Put the test where the change lives:

| You changed | Write | Run |
|---|---|---|
| Logic: `app/src/model`, `app/src/hc`, `app/src/store.ts` | A unit test next to the file (`*.test.ts`) | `cd app && scripts/test.sh` |
| A screen | A screen test against the fake computer (`app/App*.test.tsx`, `app/src/testing/fakecore.ts`) | `cd app && scripts/test.sh` |
| The terminal page: touch, scrolling, the keyboard | A check in `app/e2e/page-touch.mjs` | `cd app && e2e/page-touch.sh` |
| The companion | A Go test next to the file | `cd companion && go test ./...` |
| Something only a phone shows: the keyboard, notifications, the system's focus | A step in the device suite | `app/e2e/android.sh` on an emulator; `app/e2e/ios.sh` and `app/e2e/ios-keyboard.sh` on a simulator |
| Talking to herdr-core | The live suite against a real herdr-core | `app/e2e/run.sh` |

Every pull request runs the unit, screen, page and companion tests, plus a secret scan
(`.github/workflows/tests.yml`). The device and live suites need an emulator, a simulator or herdr-core. Run the
ones your change touches, and say in the pull request which ones you ran.

## 2. Fake data only

Tests, fixtures, screenshots and recordings use made-up names: projects like `acme-api` and `beta-web`, a made-up
user's home folder, example addresses. Never use a real project, host, account, path or token. The device suites already run
against a throwaway herdr-core with a fake project, so their screenshots are safe to attach.

## 3. Before you open the pull request

- Every test passes.
- `CHANGELOG.md` says what a user will notice.
- A UI change comes with a before and after screenshot.
- Changes to `.github/`, build files (`app/android/`, `app/ios/`, `companion/go.mod`) or `third_party/` get the
  owner's review (`.github/CODEOWNERS`). Say why they're needed.

## The description

**Context:** the moment a user hits the problem. **What:** what they will notice. **Why** this way. **Reviewer
action:** the one decision you need.
