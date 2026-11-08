#!/bin/sh
# Labels spelled in English in a screen's source: what screen readers and dialogs read, which no screen test sees.
# Everything a person reads comes from src/strings (t). Prints file:line for each; fails if there are any,
# or if Android's strings.xml differ from src/strings.
set -u
# The screens are in src; tests and fixtures hold sample data (tab titles), which is not a label.
[ $# -gt 0 ] || set -- src
hits=$(grep -rnE --include='*.tsx' \
  -e "(accessibilityLabel|label|placeholder|detail)=\"[A-Z][a-z]+" \
  -e "(accessibilityLabel|label|title|description|body): *['\"\`][A-Z][a-z]+" \
  -e ">[A-Z][a-z]+( [a-z]+)*[.…]?</Text>" "$@" | grep -vE '^[^:]+:[0-9]+: *(//|\*)|"Herdr"|"Herdr Anywhere"|>Herdr<' | cut -d: -f1,2)
status=0
if [ -n "$hits" ]; then
  echo "English labels left, use t() from src/strings:" >&2
  echo "$hits" >&2
  status=1
fi
# Words in any other language written straight into a screen or model (the progress page shipped Chinese that way
# once): every one comes from src/strings too. Comments, tests and sample data are not words a person reads.
cjk=$(python3 -I - "$@" <<'PY'
import pathlib, re, sys
roots = [pathlib.Path(a) for a in sys.argv[1:]] + [pathlib.Path("src/model")]
for root in roots:
    for f in sorted(set(root.rglob("*.ts")) | set(root.rglob("*.tsx"))) if root.is_dir() else [root]:
        if ".test." in f.name or "testing" in f.parts or "strings" in f.parts:
            continue
        block = False
        for n, line in enumerate(f.read_text().splitlines(), 1):
            code = line
            if block:
                if "*/" not in code:
                    continue
                code, block = code.split("*/", 1)[1], False
            code = re.sub(r"/\*.*?\*/", "", code)
            if "/*" in code:
                code, block = code.split("/*", 1)[0], True
            code = re.sub(r"(^|\s)//.*", "", code)
            if re.search(r"[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff]", code):
                print(f"{f}:{n}")
PY
)
if [ -n "$cjk" ]; then
  echo "Words written into the code, use t() from src/strings:" >&2
  echo "$cjk" >&2
  status=1
fi
# Android's notification channels say what the app says.
res=android/app/src/main/res
for pair in values:en values-b+zh+Hans:zh-Hans values-b+zh+Hant:zh-Hant values-es:es values-ko:ko values-ja:ja values-ru:ru; do
  sed -nE 's/.*<string name="[^"]*">(.*)<\/string>.*/\1/p' "$res/${pair%%:*}/strings.xml" | while IFS= read -r word; do
    grep -qF "'$word'" "src/strings/${pair##*:}.ts" || { echo "$res/${pair%%:*}/strings.xml: not in src/strings: $word" >&2; exit 1; }
  done || status=1
done
exit $status
