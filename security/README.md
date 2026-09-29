# 倉治整骨院：公開・管理APIの分離（移行用）

**この一式は移行準備であり、本番反映済みではありません。** 公開GASだけ先に置き換えると管理画面とLINEの受信が止まります。必ず下記の順序で切り替えてください。

## 生成物

`node security/build.mjs` で `security/dist/` を再生成します。

- `Admin.gs` と `Admin.html` ほか7ページ：院長専用の別Apps Scriptプロジェクト用。既存 `kanri.html` からのGAS通信を `google.script.run` に橋渡しします。**Webアプリのアクセス権を「自分のみ」**にします。
- `Public.gs`：既存の患者向け・LINE受信用Apps Scriptプロジェクト用。管理用GET/POSTを拒否し、空き枠・公開申込など必要な処理だけを許可します。LINEイベントは中継キーを確認してから処理します。
- `line-webhook-worker.js`：LINE署名を生のリクエスト本文で検証してから、公開GASに転送するCloudflare Workerの例です。
- `confirm.html`：電話番号だけで予約詳細を開示せず、登録済みLINEに届く8文字の確認コードを要するよう変更します。

## 切替手順（院長のGoogle・LINE・Cloudflareでの操作が必要）

1. 既存スプレッドシートから新しい**スプレッドシート紐付けApps Scriptプロジェクト**を作ります。生成した `Admin.gs` をコードへ、`Admin.html`・`Karte.html`・`TodaySplit.html`・`LineSetup.html`・`TriggerSetup.html`・`Uriage.html`・`MondoPrint.html`・`MondoKotsuPrint.html` を同名のHTMLファイルへ追加します。Script Properties に新プロジェクトで使う `LINE_TOKEN` と `LINE_USER_ID` を設定します。値をGitHubやチャットに貼り付けないでください。
2. この管理プロジェクトを「次のユーザーとして実行：自分」「アクセスできるユーザー：自分のみ」で**新規**デプロイします。新しい管理URLに院長のGoogleアカウントで入り、患者一覧・予約編集・LINEの院長宛てテスト・電子カルテ・売上を確認します。第三者やログアウト状態では管理URLに入れないことを確認します。旧GitHub Pagesの `kanri.html` を管理に使い続けないでください。
3. Cloudflare Workerを作成し、`security/line-webhook-worker.js` を設定します。Secret `LINE_CHANNEL_SECRET` はLINE Developersから、`GAS_WEBHOOK_URL` は既存の公開GAS URLの末尾に `?webhookKey=` と**新たに生成したランダムな長い値**を付けたものです。同じ値を既存GASのScript Property `LINE_WEBHOOK_FORWARD_KEY` に設定します。いずれもGitHub・HTML・チャットには記載しません。
4. LINE DevelopersのWebhook URLをWorkerのURLへ変え、検証と実際の友だちからのメッセージ受信を確認します。署名がない、または不正なPOSTをWorkerが401で拒否することも確認します。
5. 既存の公開GASを `Public.gs` へ貼り替え、「新バージョン」で既存Webアプリのデプロイを更新します。患者向け予約URLは変えません。管理操作 `getAll`、`lineNotifyV2`、`saveBookings`、`testLineOwner` が公開URLで拒否され、空き枠取得・予約申込・LINE受信は通ることを確認します。
6. GitHub Pagesの `confirm.html` を更新します。登録済みの院長自身の電話番号で、LINE確認コードと予約照会をテストします。予約のない番号でも「登録の有無」は返さず、未登録者はLINEか電話へ案内します。
7. 他の公開された古いGASデプロイ、復旧ページ、`kanri2.html` を監査します。古いデプロイが管理処理を公開していれば無効化します。**旧デプロイが残ると、この移行だけでは防げません。**

## 注意点

- コードのみではGoogleのデプロイ権限とCloudflare/LINE設定は変更できません。上述の手動操作と本番での動作確認が終わるまで安全対策完了とは言えません。
- 既存の患者向け申込・問診票は公開入力のため、スパムや大量送信に対して別途レート制限・CAPTCHAなどの対策が必要です。
- `confirm.html` の電話番号だけによる旧照会は公開側で無効になります。LINE未連携の方は直接お問い合わせいただく仕様です。
- 一時的な中継キーだけでLINE署名検証を省略しないでください。Workerの`LINE_CHANNEL_SECRET`とGASの`LINE_WEBHOOK_FORWARD_KEY`は異なる値です。

## ローカル検証

`node security/build.mjs && node security/test.mjs`
