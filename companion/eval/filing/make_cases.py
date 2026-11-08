#!/usr/bin/env python3 -I
"""Writes cases.json: the same made-up scene for each of the app's seven languages, the phone set to that language.
Most of what the user and the agents say is in that language; two items are in another one (English, or Chinese
for the English phone), and the filing agent must still write in the phone's language. All names are made up."""
import json, pathlib

LANGS = ["en", "zh-Hans", "zh-Hant", "es", "ja", "ko", "ru"]

# Words in each language: (en, zh-Hans, zh-Hant, es, ja, ko, ru).
def w(*t):
    assert len(t) == 7, t
    return dict(zip(LANGS, t))

SEED = {  # the user's tasks before the batch: P1, under it T1–T3, each on its own pane
    "P1": w("Acme 1.0 launch", "Acme 1.0 发布", "Acme 1.0 發布", "Lanzamiento de Acme 1.0", "Acme 1.0 のリリース", "Acme 1.0 출시", "Выпуск Acme 1.0"),
    "T1": w("Fix the total_items count", "修好 total_items 计数", "修好 total_items 計數", "Arreglar el conteo de total_items", "total_items の件数を直す", "total_items 개수 고치기", "Исправить подсчёт total_items"),
    "T2": w("Write the release email", "写发布邮件", "寫發布郵件", "Escribir el correo del lanzamiento", "リリースのメールを書く", "출시 메일 쓰기", "Написать письмо о выпуске"),
    "T3": w("Update the FAQ", "更新 FAQ", "更新 FAQ", "Actualizar las FAQ", "FAQ を更新する", "FAQ 업데이트", "Обновить FAQ"),
}

# A pane stops on its task; `want` is where the task goes, `keep` what the question must say as it is.
STOPS = [
    dict(want="done", title=w("Fix total_items", "修 total_items", "修 total_items", "Arreglar total_items", "total_items を直す", "total_items 고치기", "Починить total_items"),
         text=w("Fixed total_items; all tests pass, committed a1b2c3.", "total_items 修好了，测试全过，已提交 a1b2c3。", "total_items 修好了，測試全過，已提交 a1b2c3。",
                "total_items arreglado; pasan todas las pruebas, commit a1b2c3.", "total_items を直しました。テストはすべて通り、a1b2c3 でコミット済みです。",
                "total_items 고쳤어요. 테스트 모두 통과했고 a1b2c3로 커밋했어요.", "total_items исправлен, все тесты проходят, коммит a1b2c3.")),
    dict(want="waiting", keep=["README", "8080"], title=w("Fix the API port docs", "改 API 端口说明", "改 API 埠說明", "Corregir la documentación del puerto de la API", "API のポートの説明を直す", "API 포트 설명 고치기", "Исправить описание порта API"),
         text=w("Done. Shall I also change the README port to 8080?", "改好了。要不要顺便把 README 的端口也改成 8080？", "改好了。要不要順便把 README 的埠也改成 8080？",
                "Listo. ¿Cambio también el puerto del README a 8080?", "直しました。ついでに README のポートも 8080 に変えますか？",
                "고쳤어요. README 포트도 8080으로 바꿀까요?", "Готово. Поменять заодно порт в README на 8080?")),
    dict(want="waiting", keep=["Stripe"], title=w("Add Stripe payments", "接入 Stripe 支付", "接入 Stripe 支付", "Añadir pagos con Stripe", "Stripe の決済を入れる", "Stripe 결제 붙이기", "Подключить оплату через Stripe"),
         text=w("I need a Stripe test key to run the payment tests.", "需要你给我 Stripe 的测试 key 才能跑支付的测试。", "需要你給我 Stripe 的測試 key 才能跑支付的測試。",
                "Necesito una clave de prueba de Stripe para correr las pruebas de pago.", "決済のテストを動かすには Stripe のテスト用キーが必要です。",
                "결제 테스트를 돌리려면 Stripe 테스트 키가 필요해요.", "Чтобы запустить тесты оплаты, нужен тестовый ключ Stripe.")),
    dict(want="doing", title=w("Fix the order API tests", "修订单接口的测试", "修訂單介面的測試", "Arreglar las pruebas de la API de pedidos", "注文 API のテストを直す", "주문 API 테스트 고치기", "Починить тесты API заказов"),
         text=w("3 tests still fail because the database connection times out; I'm looking into it.", "还有 3 个测试失败，原因是数据库连接超时，我接着查。", "還有 3 個測試失敗，原因是資料庫連線逾時，我接著查。",
                "Aún fallan 3 pruebas porque la conexión a la base de datos se agota; sigo investigando.", "まだ 3 件のテストが失敗しています。データベース接続のタイムアウトが原因なので、引き続き調べます。",
                "테스트 3개가 아직 실패해요. 데이터베이스 연결 시간 초과 때문이라 계속 보고 있어요.", "3 теста всё ещё падают из-за таймаута соединения с базой; продолжаю разбираться.")),
    dict(want="waiting", title=w("Fix the mobile layout", "修移动端布局", "修行動版版面", "Arreglar el diseño en móvil", "スマホのレイアウトを直す", "모바일 레이아웃 고치기", "Исправить мобильную вёрстку"),
         text=w("Two ways: A changes the frontend, B the backend. I lean to B. Which do you want?", "两种做法：A 改前端，B 改后端。我倾向 B，你选哪个？", "兩種做法：A 改前端，B 改後端。我傾向 B，你選哪個？",
                "Dos opciones: A cambia el frontend, B el backend. Prefiero B. ¿Cuál quieres?", "やり方は二つです。A はフロントエンド、B はバックエンドを変えます。B がよいと思いますが、どちらにしますか？",
                "방법이 두 가지예요. A는 프런트엔드, B는 백엔드를 바꿔요. 저는 B가 좋은데 어느 쪽으로 할까요?", "Два варианта: A меняет фронтенд, B — бэкенд. Я за B. Какой выбираете?")),
    dict(want="done", title=w("Write the launch email draft", "写发布邮件草稿", "寫發布郵件草稿", "Escribir el borrador del correo", "告知メールの下書きを書く", "출시 메일 초안 쓰기", "Написать черновик письма"),
         text=w("The launch email draft is in docs/launch-email.md.", "发布邮件草稿写好了，在 docs/launch-email.md。", "發布郵件草稿寫好了，在 docs/launch-email.md。",
                "El borrador del correo está en docs/launch-email.md.", "告知メールの下書きを docs/launch-email.md に書きました。",
                "출시 메일 초안을 docs/launch-email.md에 써 뒀어요.", "Черновик письма лежит в docs/launch-email.md.")),
    dict(want="doing", title=w("Upgrade frontend dependencies", "升级前端依赖", "升級前端相依套件", "Actualizar dependencias del frontend", "フロントエンドの依存を上げる", "프런트엔드 의존성 올리기", "Обновить зависимости фронтенда"),
         text=w("npm install failed: it can't reach the registry.", "出错了：npm install 失败，连不上 registry。", "出錯了：npm install 失敗，連不上 registry。",
                "Falló npm install: no llega al registry.", "npm install が失敗しました。registry につながりません。",
                "npm install이 실패했어요. registry에 연결이 안 돼요.", "npm install упал: нет доступа к registry.")),
    # In another language than the phone's: the question must still be written in the phone's.
    dict(want="waiting", keep=["$29"], other=True, title=w("Write five FAQ entries", "写五条 FAQ", "寫五條 FAQ", "Escribir cinco entradas de FAQ", "FAQ を五つ書く", "FAQ 다섯 개 쓰기", "Написать пять пунктов FAQ"),
         text=w("FAQ 那 5 条写完了。第 3 条里的价格是 $29 吗？你确认一下。", "The five FAQ entries are written. Is the price in entry 3 really $29?", "The five FAQ entries are written. Is the price in entry 3 really $29?",
                "The five FAQ entries are written. Is the price in entry 3 really $29?", "The five FAQ entries are written. Is the price in entry 3 really $29?",
                "The five FAQ entries are written. Is the price in entry 3 really $29?", "The five FAQ entries are written. Is the price in entry 3 really $29?")),
]

# A pane's current session, found when the page is turned on: the tasks in it (`keep` tells them apart), or none.
SESSIONS = [
    dict(want=[dict(done=True)],
         said=w(["Add a check for the cart quantity limit", "and a test", "ok"], ["加一个购物车数量上限的校验", "再加个测试", "好"], ["加一個購物車數量上限的檢查", "再加個測試", "好"],
                ["Añade una validación del límite de cantidad del carrito", "y una prueba", "vale"], ["カートの数量上限のチェックを追加して", "テストも", "OK"],
                ["장바구니 수량 한도 검사를 추가해 줘", "테스트도", "좋아"], ["Добавь проверку лимита количества в корзине", "и тест", "ок"]),
         last=w("The check and the test are in; all pass.", "校验和测试都加好了，全过。", "檢查和測試都加好了，全過。", "La validación y la prueba están; todo pasa.",
                "チェックとテストを追加しました。すべて通ります。", "검사와 테스트 추가했어요. 모두 통과해요.", "Проверка и тест добавлены, всё проходит.")),
    dict(want=[dict(keep="8080", done=True), dict(keep="CHANGELOG", done=False)],
         said=w(["Change the README port to 8080", "also update the CHANGELOG"], ["README 端口改成 8080", "顺便把 CHANGELOG 也更新一下"], ["README 埠改成 8080", "順便把 CHANGELOG 也更新一下"],
                ["Cambia el puerto del README a 8080", "y actualiza también el CHANGELOG"], ["README のポートを 8080 に変えて", "ついでに CHANGELOG も更新して"],
                ["README 포트를 8080으로 바꿔 줘", "CHANGELOG도 업데이트해 줘"], ["Поменяй порт в README на 8080", "и обнови CHANGELOG"]),
         last=w("Port changed. I haven't touched the CHANGELOG yet; shall I?", "端口改好了，CHANGELOG 还没动，要我现在写吗？", "埠改好了，CHANGELOG 還沒動，要我現在寫嗎？",
                "Puerto cambiado. Aún no toqué el CHANGELOG; ¿lo hago?", "ポートは変えました。CHANGELOG はまだです。今やりますか？",
                "포트는 바꿨어요. CHANGELOG는 아직이에요. 지금 할까요?", "Порт поменял. CHANGELOG ещё не трогал — сделать?")),
    dict(want=[],
         said=w(["hi", "which model are you?"], ["你好", "你是什么模型"], ["你好", "你是什麼模型"], ["hola", "¿qué modelo eres?"], ["こんにちは", "どのモデル？"], ["안녕", "어떤 모델이야?"], ["привет", "какая ты модель?"]),
         last=w("I'm Claude.", "我是 Claude。", "我是 Claude。", "Soy Claude.", "Claude です。", "저는 Claude예요.", "Я Claude.")),
]

# What the user types in a pane: the task it goes on (T1–T3) or a new one under P1 (`keep` in its title).
MESSAGES = [
    dict(pane="a1", want="T1", said=w("total_items is fixed.", "total_items 修好了。", "total_items 修好了。", "total_items está arreglado.", "total_items を直しました。", "total_items 고쳤어요.", "total_items исправлен."),
         text=w("also cover the case where the count is exactly the limit", "再补一个数量正好等于上限的情况", "再補一個數量剛好等於上限的情況", "cubre también el caso en que la cantidad es justo el límite",
                "件数がちょうど上限のケースも足して", "개수가 딱 한도인 경우도 넣어 줘", "добавь ещё случай, когда количество ровно на пределе")),
    dict(pane="a2", want="T2", said=w("Here is the first draft of the email.", "邮件第一稿在这里。", "郵件第一稿在這裡。", "Aquí está el primer borrador del correo.", "メールの初稿です。", "메일 초안이에요.", "Вот первый черновик письма."),
         text=w("make it shorter, under 200 words", "再短一点，200 字以内", "再短一點，200 字以內", "hazlo más corto, menos de 200 palabras", "もっと短く、200 語以内で", "더 짧게, 200단어 이내로", "сделай короче, до 200 слов")),
    dict(pane="a3", want="new", keep="1.0", said=w("The FAQ is updated.", "FAQ 更新好了。", "FAQ 更新好了。", "Las FAQ están actualizadas.", "FAQ を更新しました。", "FAQ 업데이트했어요.", "FAQ обновлён."),
         text=w("next, add a 1.0 launch banner to the homepage", "接下来给官网首页加一个 1.0 发布的横幅", "接下來給官網首頁加一個 1.0 發布的橫幅", "ahora añade un banner del lanzamiento 1.0 en la portada",
                "次はトップページに 1.0 リリースのバナーを付けて", "다음엔 홈페이지에 1.0 출시 배너를 달아 줘", "теперь добавь на главную баннер о выпуске 1.0")),
    # Typed in T1's pane, in another language, about the FAQ.
    dict(pane="a1", want="T3", other=True, said=w("total_items is fixed.", "total_items 修好了。", "total_items 修好了。", "total_items está arreglado.", "total_items を直しました。", "total_items 고쳤어요.", "total_items исправлен."),
         text=w("FAQ 里再加一条：怎么重置密码", "Add an FAQ entry on how to reset a password", "Add an FAQ entry on how to reset a password", "Add an FAQ entry on how to reset a password",
                "Add an FAQ entry on how to reset a password", "Add an FAQ entry on how to reset a password", "Add an FAQ entry on how to reset a password")),
]

runs = []
for l in LANGS:
    seed = [{"id": k, "title": v[l], **({"under": "P1"} if k != "P1" else {})} for k, v in SEED.items()]
    items = []
    for i, s in enumerate(STOPS, 1):
        items.append({"id": f"s{i}", "kind": "stop", "title": s["title"][l], "text": s["text"][l], "want": s["want"], "keep": s.get("keep", []), "other": s.get("other", False)})
    for i, s in enumerate(SESSIONS, 1):
        items.append({"id": f"v{i}", "kind": "session", "said": s["said"][l], "last": s["last"][l], "want": s["want"]})
    for i, m in enumerate(MESSAGES, 1):
        items.append({"id": f"m{i}", "kind": "message", "pane": m["pane"], "agent_said": m["said"][l], "text": m["text"][l], "want": m["want"],
                      "keep": [m["keep"]] if m.get("keep") else [], "other": m.get("other", False)})
    runs.append({"lang": l, "seed": seed, "items": items})
out = pathlib.Path(__file__).resolve().parent / "cases.json"
out.write_text(json.dumps({"runs": runs}, ensure_ascii=False, indent=1) + "\n")
print(f"wrote {out.name}: {len(runs)} languages, {sum(len(r['items']) for r in runs)} items")
