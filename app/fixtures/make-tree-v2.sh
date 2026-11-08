#!/bin/sh
# Writes fixtures/tree-v2.json (Chinese) and fixtures/tree-en.json (English): the real `herdr-anywhere track tree --json`
# for the sample scene, over a fake hc and a fake ~/.claude. Run it again when the tree's shape changes.
#   P1 the Acme shop's new checkout › T1 (in a pane, with ✓/· items), T5 waits its turn, T6 asks the user in pane mobile
#   P2 comparing payment providers: just finished, with what the agent said
#   T7: a message the filing pane wasn't sure of, filed where it guessed (version one asks nothing)
# Each pane is put on its task as the filing pane does it (file, then place). Times start at 1700000000000 (2023),
# so the files don't say when they were made.
set -eu
app=$(cd "$(dirname "$0")/.." && pwd)
w=$(mktemp -d)
trap 'rm -rf "$w"' EXIT
(cd "$app/../companion" && go build -o "$w/herdr-anywhere" ./cmd/herdr-anywhere)
cat > "$w/ls.json" <<'J'
{"terminals":[
{"address":"t2","name":"checkout","state":"live","status":"working","turn":7,"cwd":"/p/acme-shop","agent":"claude-code"},
{"address":"t3","name":"payments","state":"live","status":"done","turn":4,"cwd":"/p/acme-shop","agent":"claude-code"},
{"address":"t4","name":"mobile","state":"live","status":"idle","turn":2,"cwd":"/p/acme-app","agent":"claude-code"}]}
J
echo '{"address":"t2","state":"live","status":{"state":"working"},"status_ms":1,"foreground":{"pid":4202}}' > "$w/get-t2.json"
# t3's last words, in the scene's language: research() writes get-t3.json.
echo '{"address":"t4","state":"live","status":{"state":"idle"},"status_ms":1,"foreground":{"pid":4204}}' > "$w/get-t4.json"
cat > "$w/hc" <<J
#!/bin/sh
case "\$1" in --version) echo 'hc 0.1.18' ;; ls) cat '$w/ls.json' ;; get) cat "$w/get-\$2.json" ;; esac
J
chmod +x "$w/hc"
export HOME="$w/home"
# The sorting agent writes titles and questions in the phone's language; the pane's own words are its agent's.
research() { printf '{"address":"t3","state":"live","status":{"state":"done","msg":"%s"},"status_ms":9999999999999,"foreground":{"pid":4203}}\n' "$1" > "$w/get-t3.json"; }
scene() { # out, then the scene's words
  out=$1; shift
  rm -f "$w/track.json"; research "$1"
  t() { "$w/herdr-anywhere" track "$@" --file "$w/track.json" --hc "$w/hc" --herdr -; }
  t add P2 "$2" >/dev/null
  t file --pane hc:payments "$3" >/dev/null; t place Q1 --task P2 >/dev/null
  t set P2 --stage done >/dev/null
  t add --std "$4" P1 "$5" >/dev/null
  t add --under P1 --stage doing T1 "$6" >/dev/null
  t file --pane hc:checkout "$7" >/dev/null; t place Q1 --task T1 >/dev/null
  t add --under T1 --stage done T2 "$8" >/dev/null
  t add --under T1 --stage parked T3 "$9" >/dev/null
  shift 9
  t add --under T1 --stage parked T4 "$1" >/dev/null
  t add --under P1 --stage parked --next "$2" T5 "$3" >/dev/null
  t add --under P1 --stage doing T6 "$4" >/dev/null
  t file --pane hc:mobile "$5" >/dev/null; t place Q1 --task T6 >/dev/null
  t set T6 --stage waiting --waiting "$6" >/dev/null
  t file --pane hc:checkout "$7" >/dev/null
  t place Q1 --task new --under P1 --title "$8" --why "$9" >/dev/null
  t tree --json | python3 -c '
import json, sys
d = json.load(sys.stdin)
def walk(x, f):
    if isinstance(x, dict):
        for k, v in x.items():
            if k in ("at", "created", "updated") and isinstance(v, int) and v > 10**12: f(x, k, v)
            else: walk(v, f)
    elif isinstance(x, list):
        for v in x: walk(v, f)
times = []
walk(d, lambda o, k, v: times.append(v))
shift = min(times) - 1700000000000
walk(d, lambda o, k, v: o.__setitem__(k, v - shift))
print(json.dumps(d, ensure_ascii=False, indent=2))' > "$app/fixtures/$out"
  echo "wrote fixtures/$out"
}
scene tree-v2.json "对比写好了，等你看" "比较几家支付服务商" "比较三家支付服务商，写个结论" "顾客两步就能付完款" \
  "上线 Acme 商店的新结账流程" "让顾客能保存银行卡" "先做银行卡表单" "加上银行卡表单" \
  "输入时就校验卡号" "让顾客能删掉存过的卡" "等银行卡的活做完再跑 · 你说过：跑完告诉我" \
  "在 Android 手机上测一遍结账" "按顾客的币种显示价格" "每个价格按顾客自己的币种显示" \
  "价格取整，还是保留到分？" "顺便在付款后发一封收据邮件" "付款后发收据邮件" "可能是一件新的事"
scene tree-en.json "The comparison is ready for you to read" "Compare payment providers" "Compare three payment providers and write it up" "Customers can pay in two steps" \
  "Ship the new checkout for the Acme shop" "Let customers save their card" "Start with the card form" "Add the card form" \
  "Check the card number as it is typed" "Let customers remove a saved card" "Waits for the card work · you said: tell me when it's done" \
  "Test the checkout on an Android phone" "Show prices in the customer's currency" "Show each price in the customer's own currency" \
  "Round prices to whole numbers, or keep the cents?" "Also send a receipt email after payment" "Send a receipt email after payment" "Looks like a new task"
