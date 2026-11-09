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

SEED = {  # the user's tasks before the batch: P1, under it T1–T4, each on its own pane
    "P1": w("Acme 1.0 launch", "Acme 1.0 发布", "Acme 1.0 發布", "Lanzamiento de Acme 1.0", "Acme 1.0 のリリース", "Acme 1.0 출시", "Выпуск Acme 1.0"),
    "T1": w("Fix the total_items count", "修好 total_items 计数", "修好 total_items 計數", "Arreglar el conteo de total_items", "total_items の件数を直す", "total_items 개수 고치기", "Исправить подсчёт total_items"),
    "T2": w("Write the release email", "写发布邮件", "寫發布郵件", "Escribir el correo del lanzamiento", "リリースのメールを書く", "출시 메일 쓰기", "Написать письмо о выпуске"),
    "T3": w("Update the FAQ", "更新 FAQ", "更新 FAQ", "Actualizar las FAQ", "FAQ を更新する", "FAQ 업데이트", "Обновить FAQ"),
    # Left by an earlier scan of the long session (v4), still "doing": the scan after an update finds it again (R13).
    "T4": w("Check emails on the Nimbus signup page", "Nimbus 注册页校验邮箱", "Nimbus 註冊頁檢查電郵", "Validar el correo en el registro de Nimbus",
            "Nimbus の登録でメールをチェック", "Nimbus 가입에서 이메일 검사", "Проверка email при регистрации в Nimbus"),
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

# A pane's current session, found when the page is turned on: each thing the user said with the agent's answer (None:
# it had not answered). `want` lists the tasks in it (`keep` tells them apart); R7 checks done or not, `stages` (R10)
# the exact stage, and `group` (R11) that the tasks of the sessions sharing it go under one task.
SESSIONS = [
    dict(want=[dict(done=True)],
         turns=w([("Add a check for the cart quantity limit", "Added the limit check to the cart."), ("and a test", "The check and the test are in; all pass.")],
                 [("加一个购物车数量上限的校验", "购物车加上了数量上限校验。"), ("再加个测试", "校验和测试都加好了，全过。")],
                 [("加一個購物車數量上限的檢查", "購物車加上了數量上限檢查。"), ("再加個測試", "檢查和測試都加好了，全過。")],
                 [("Añade una validación del límite de cantidad del carrito", "Añadí la validación del límite al carrito."), ("y una prueba", "La validación y la prueba están; todo pasa.")],
                 [("カートの数量上限のチェックを追加して", "カートに数量上限のチェックを追加しました。"), ("テストも", "チェックとテストを追加しました。すべて通ります。")],
                 [("장바구니 수량 한도 검사를 추가해 줘", "장바구니에 수량 한도 검사를 추가했어요."), ("테스트도", "검사와 테스트 추가했어요. 모두 통과해요.")],
                 [("Добавь проверку лимита количества в корзине", "Добавил проверку лимита в корзину."), ("и тест", "Проверка и тест добавлены, всё проходит.")])),
    dict(want=[dict(keep="8080", done=True), dict(keep="CHANGELOG", done=False)],
         turns=w([("Change the README port to 8080", None), ("also update the CHANGELOG", "Port changed. I haven't touched the CHANGELOG yet; shall I?")],
                 [("README 端口改成 8080", None), ("顺便把 CHANGELOG 也更新一下", "端口改好了，CHANGELOG 还没动，要我现在写吗？")],
                 [("README 埠改成 8080", None), ("順便把 CHANGELOG 也更新一下", "埠改好了，CHANGELOG 還沒動，要我現在寫嗎？")],
                 [("Cambia el puerto del README a 8080", None), ("y actualiza también el CHANGELOG", "Puerto cambiado. Aún no toqué el CHANGELOG; ¿lo hago?")],
                 [("README のポートを 8080 に変えて", None), ("ついでに CHANGELOG も更新して", "ポートは変えました。CHANGELOG はまだです。今やりますか？")],
                 [("README 포트를 8080으로 바꿔 줘", None), ("CHANGELOG도 업데이트해 줘", "포트는 바꿨어요. CHANGELOG는 아직이에요. 지금 할까요?")],
                 [("Поменяй порт в README на 8080", None), ("и обнови CHANGELOG", "Порт поменял. CHANGELOG ещё не трогал — сделать?")])),
    dict(want=[],
         turns=w([("hi", "Hi! What shall we work on?"), ("which model are you?", "I'm Claude.")], [("你好", "你好！今天做什么？"), ("你是什么模型", "我是 Claude。")],
                 [("你好", "你好！今天做什麼？"), ("你是什麼模型", "我是 Claude。")], [("hola", "¡Hola! ¿En qué trabajamos?"), ("¿qué modelo eres?", "Soy Claude.")],
                 [("こんにちは", "こんにちは！何をしましょう？"), ("どのモデル？", "Claude です。")], [("안녕", "안녕하세요! 뭘 할까요?"), ("어떤 모델이야?", "저는 Claude예요.")],
                 [("привет", "Привет! Чем займёмся?"), ("какая ты модель?", "Я Claude.")])),
    # A long session: three things finished, one still going after the user moved on, the last one asks the user.
    dict(stages=True, want=[dict(keep="Nimbus", stage="done"), dict(keep="Orbit", stage="done"), dict(keep="Comet", stage="done"),
                            dict(keep="Quasar", stage="doing"), dict(keep="Zephyr", stage="waiting")],
         turns=w([("Make the Nimbus signup page check the email address", "Done: Nimbus signup now checks the email; tests pass."),
                  ("Add dark mode to Orbit", "Dark mode is in Orbit, saved per user."), ("Ship Comet 2.3 to the App Store", "Comet 2.3 is live on the App Store."),
                  ("Quasar search is slow, make it faster", "Added an index; Quasar queries still take 4 s. I'm still looking."),
                  ("Translate the Zephyr onboarding into German", "The German texts are in. On the first screen, 'Konto' or 'Account'?")],
                 [("让 Nimbus 注册页校验邮箱地址", "好了：Nimbus 注册页现在会校验邮箱，测试通过。"), ("给 Orbit 加深色模式", "Orbit 加上深色模式了，按用户保存。"),
                  ("把 Comet 2.3 发到 App Store", "Comet 2.3 已经在 App Store 上线。"), ("Quasar 搜索太慢，弄快一点", "加了索引，Quasar 查询还是要 4 秒，我还在查。"),
                  ("把 Zephyr 的引导页翻译成德语", "德语文案放进去了。第一屏用 'Konto' 还是 'Account'？")],
                 [("讓 Nimbus 註冊頁檢查電郵地址", "好了：Nimbus 註冊頁現在會檢查電郵，測試通過。"), ("給 Orbit 加深色模式", "Orbit 加上深色模式了，按使用者儲存。"),
                  ("把 Comet 2.3 發到 App Store", "Comet 2.3 已經在 App Store 上架。"), ("Quasar 搜尋太慢，弄快一點", "加了索引，Quasar 查詢還是要 4 秒，我還在查。"),
                  ("把 Zephyr 的導覽頁翻譯成德文", "德文文案放進去了。第一屏用 'Konto' 還是 'Account'？")],
                 [("Haz que la página de registro de Nimbus valide el correo", "Hecho: el registro de Nimbus valida el correo; las pruebas pasan."),
                  ("Añade modo oscuro a Orbit", "El modo oscuro está en Orbit, guardado por usuario."), ("Publica Comet 2.3 en la App Store", "Comet 2.3 ya está en la App Store."),
                  ("La búsqueda de Quasar es lenta, hazla más rápida", "Añadí un índice; las consultas de Quasar siguen tardando 4 s. Sigo investigando."),
                  ("Traduce la bienvenida de Zephyr al alemán", "Los textos en alemán están. En la primera pantalla, ¿'Konto' o 'Account'?")],
                 [("Nimbus の登録ページでメールアドレスをチェックして", "できました。Nimbus の登録でメールをチェックします。テストも通ります。"),
                  ("Orbit にダークモードを付けて", "Orbit にダークモードを付けました。ユーザーごとに保存されます。"), ("Comet 2.3 を App Store に出して", "Comet 2.3 は App Store で公開されました。"),
                  ("Quasar の検索が遅いので速くして", "インデックスを足しましたが、Quasar の検索はまだ 4 秒かかります。引き続き調べています。"),
                  ("Zephyr のオンボーディングをドイツ語に訳して", "ドイツ語の文言を入れました。最初の画面は 'Konto' と 'Account' のどちらにしますか？")],
                 [("Nimbus 가입 페이지에서 이메일 주소를 검사하게 해 줘", "완료: Nimbus 가입에서 이메일을 검사해요. 테스트 통과했어요."),
                  ("Orbit에 다크 모드 추가해 줘", "Orbit에 다크 모드 넣었어요. 사용자별로 저장돼요."), ("Comet 2.3을 App Store에 올려 줘", "Comet 2.3이 App Store에 출시됐어요."),
                  ("Quasar 검색이 느려, 빠르게 해 줘", "인덱스를 추가했지만 Quasar 검색은 아직 4초 걸려요. 계속 보고 있어요."),
                  ("Zephyr 온보딩을 독일어로 번역해 줘", "독일어 문구 넣었어요. 첫 화면은 'Konto'로 할까요, 'Account'로 할까요?")],
                 [("Сделай, чтобы страница регистрации Nimbus проверяла email", "Готово: регистрация Nimbus проверяет email, тесты проходят."),
                  ("Добавь тёмную тему в Orbit", "Тёмная тема в Orbit есть, сохраняется для каждого пользователя."), ("Выложи Comet 2.3 в App Store", "Comet 2.3 уже в App Store."),
                  ("Поиск в Quasar медленный, ускорь его", "Добавил индекс, но запросы Quasar всё ещё идут 4 с. Продолжаю разбираться."),
                  ("Переведи онбординг Zephyr на немецкий", "Немецкие тексты на месте. На первом экране 'Konto' или 'Account'?")])),
    # Two panes working on one move of the docs site that no task names yet: their tasks go under one task (R11).
    dict(group="docs", want=[dict(keep="docs.acme.dev")],
         turns=w([("Point docs.acme.dev at the new docs server", "docs.acme.dev now points at the new server."), ("turn on HTTPS for it too", "HTTPS is on for docs.acme.dev.")],
                 [("把 docs.acme.dev 指向新的文档服务器", "docs.acme.dev 已经指向新服务器了。"), ("也给它开 HTTPS", "docs.acme.dev 的 HTTPS 开好了。")],
                 [("把 docs.acme.dev 指向新的文件伺服器", "docs.acme.dev 已經指向新伺服器了。"), ("也給它開 HTTPS", "docs.acme.dev 的 HTTPS 開好了。")],
                 [("Apunta docs.acme.dev al nuevo servidor de documentación", "docs.acme.dev ya apunta al nuevo servidor."), ("activa también HTTPS", "HTTPS está activo en docs.acme.dev.")],
                 [("docs.acme.dev を新しいドキュメントサーバーに向けて", "docs.acme.dev は新しいサーバーを向いています。"), ("HTTPS も有効にして", "docs.acme.dev で HTTPS を有効にしました。")],
                 [("docs.acme.dev를 새 문서 서버로 연결해 줘", "docs.acme.dev가 이제 새 서버를 가리켜요."), ("HTTPS도 켜 줘", "docs.acme.dev에 HTTPS를 켰어요.")],
                 [("Направь docs.acme.dev на новый сервер документации", "docs.acme.dev теперь указывает на новый сервер."), ("и включи для него HTTPS", "HTTPS для docs.acme.dev включён.")])),
    dict(group="docs", want=[dict(keep="/help")],
         turns=w([("For the docs move: redirect the old /help links to docs.acme.dev", "The redirects are in; I'm checking them now.")],
                 [("文档迁移的事：把旧的 /help 链接跳转到 docs.acme.dev", "跳转加好了，我正在逐个检查。")],
                 [("文件搬遷的事：把舊的 /help 連結轉到 docs.acme.dev", "轉址加好了，我正在逐一檢查。")],
                 [("Para la mudanza de la documentación: redirige los enlaces antiguos de /help a docs.acme.dev", "Las redirecciones están; las estoy comprobando.")],
                 [("ドキュメント移行の件：古い /help のリンクを docs.acme.dev にリダイレクトして", "リダイレクトを入れました。今確認しています。")],
                 [("문서 이전 건: 예전 /help 링크를 docs.acme.dev로 리디렉션해 줘", "리디렉션 넣었어요. 지금 확인하고 있어요.")],
                 [("Про переезд документации: перенаправь старые ссылки /help на docs.acme.dev", "Перенаправления добавлены, сейчас проверяю.")])),
]

# After the batch the user tells the filing pane itself that a task is finished (R12).
CORRECTION = dict(task="T2", want="done", text=w("The release email went out yesterday, so that task is finished.", "发布邮件昨天已经发出去了，那个任务做完了。",
    "發布郵件昨天已經寄出去了，那個任務做完了。", "El correo del lanzamiento salió ayer, así que esa tarea está terminada.",
    "リリースのメールは昨日送りました。あのタスクは終わっています。", "출시 메일은 어제 보냈어요. 그 작업은 끝났어요.", "Письмо о выпуске ушло вчера, так что эта задача готова."))

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
        items.append({"id": f"v{i}", "kind": "session", "turns": s["turns"][l], "want": s["want"],
                      **({"stages": True} if s.get("stages") else {}), **({"group": s["group"]} if s.get("group") else {})})
    for i, m in enumerate(MESSAGES, 1):
        items.append({"id": f"m{i}", "kind": "message", "pane": m["pane"], "agent_said": m["said"][l], "text": m["text"][l], "want": m["want"],
                      "keep": [m["keep"]] if m.get("keep") else [], "other": m.get("other", False)})
    runs.append({"lang": l, "seed": seed, "items": items, "correction": {"task": CORRECTION["task"], "want": CORRECTION["want"], "text": CORRECTION["text"][l]}})
out = pathlib.Path(__file__).resolve().parent / "cases.json"
out.write_text(json.dumps({"runs": runs}, ensure_ascii=False, indent=1) + "\n")
print(f"wrote {out.name}: {len(runs)} languages, {sum(len(r['items']) for r in runs)} items")
