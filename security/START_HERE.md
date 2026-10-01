## 2026-10-01 12:00 JST checkpoint（最新）

- 11:59に先生から「24できた」と報告。元のGASの現行v97と給与用v30だけを残す段階。
- 次は旧給与データのバックアップ。その後、管理専用の給与画面で保存・取得を確認してv30も閉じる。

## 2026-10-01 11:52 JST checkpoint

- 11:45の写真で元のGASのアクティブが3件。v1〜7の旧公開先をアーカイブ後、v97（現行）、v30（給与）、v24（修復ツール）を残した状態。
- 11:47に給与ページは使いたいが未完成との回答。v30はデータ引継ぎまで保留。v24だけのアーカイブを案内したが、完了報告はまだない。
- 管理専用の給与画面とバックアップ機能をコードで準備し検証。Google/GitHub Pagesの実環境へは未反映。詳しくは [SALARY_CUTOVER.md](SALARY_CUTOVER.md)。
- 給与用v30を閉じる前に旧ブラウザ・旧Script Propertiesのデータを引き継ぐ。全体移行完了とはしない。

## 2026-10-01 11:00 JST checkpoint

- 中継URLのキー33文字／GAS64文字の不一致を修正し、LINE検証は09:44に成功。
- Workerに ctx.waitUntil を追加した版を反映。09:55の実際のLINEテストで upstream 200、accepted:true、denied:false を写真で確認。永続キューや再送保証ではない。
- book.htmlからのテスト申込が10:02に受付成功。10:06に管理専用GAS（script.google.com）の「同期済み」と一覧への表示を確認。
- テスト名「動作確認 郡」のみ削除したと10:58に先生から報告。既存患者の申込は削除対象外。
- GitHubの旧kanri.htmlは公開GASの管理API制限によりオフライン。管理専用GASを使用する。
- 次：元の公開GASの「デプロイを管理」を確認し、稼働中の患者用デプロイを残して旧公開先の用途を監査する。名称「無題」だけでアーカイブしない。
- コードには患者用以外に3つの異なるGAS URLが残る。稼働状態・別プロジェクトとの対応は未確認。予約状況公開専用GASも別途監査する。
- 予約確認ページの確認コード方式の公開、本人確認済みLINE対応表、売上データの引継ぎ、旧公開先の閉鎖は未完了。全体の移行完了とはしない。

以下は過去の経過記録であり、最新状態は上記を優先する。

## 2026-10-01 09:50 JST checkpoint

- Cloudflare diagnostics showed keyLength 33 versus GAS property length 64, with denied true. Owner corrected GAS_WEBHOOK_URL; LINE verification now reports success (09:44 screenshot).
- Owner sent a real test message at 09:45. Worker invocation shows outcome canceled, wallTimeMs 1980; no upstream/result logs. Real message processing is not yet verified, and GAS may have continued separately.
- Prepared Worker lifetime fix: register the authenticated forwarding promise with ctx.waitUntil while still awaiting GAS acceptance before returning 200. Invalid signatures do not schedule work; upstream failures still return 502. Tests cover pending upstream retention and no early success.
- This does not provide durable delivery, retry, or an immediate successful response to LINE. Cloudflare grants up to 30 seconds after disconnect; live completion must be checked. If latency still causes webhook timeouts, use a durable queue and audit GAS event idempotency before enabling retries.
- Next: replace only Cloudflare Worker code with the prepared version, deploy, send one fresh owner test message, inspect relay_result after disconnect. Secrets and GAS source need no reentry for this change.
- Old active deployment audit and WEB reservation checks remain pending. Do not label full security cutover complete.

# 移行の現在地（2026年9月30日）

## 18:40 JST時点の確認結果

- 元の患者用デプロイ（ID先頭 `AKfycbxN8Gua`）は制限版へ更新済み。先生の画面で `kuraji-public-boundary-20260930`、`managementAccess:false`、`webhookRequiresRelay:true` を確認。
- 同じ元のGAS内で、中継キー設定あり・64文字・空イベントのローカル受信 `{ok:true}` を確認。
- 元のGASから公開中の `/exec` へ、設定済みキー付き空イベントを直接POSTするテストは HTTP 200、受付成功 true、認証拒否 false。
- Cloudflare Worker `kuraji-line-relay` と2つのProduction Secretを設定済み。LINE DevelopersのWebhook URLは `https://kuraji-line-relay.kurazi0510.workers.dev/`。
- **公開GAS更新後、LINEの検証は502で失敗。未解決。** Workerの診断ログは未取得であり、転送先の値・認証・応答形式・通信のどこで失敗したかは未確定。
- 公開GASの状態確認と空イベントPOSTは、実際の予約申込・LINEメッセージ処理・全ての管理API遮断の本番確認を代替しない。
- 古い公開デプロイのアーカイブ、GitHub Pagesの切替、本人確認済みLINE対応表、別の公開専用GASの監査は未完了。

先生の疲労により手動作業はいったん中断。次の調査はデプロイ済みWorkerの `relay_target` / `relay_upstream_status` / `relay_result` / `relay_failed` ログ取得から行う。原因を確定する前に同じコード貼替やSecret入替を繰り返さない。

こちらではCloudflare/Apps Scriptの直接操作用接続が見つからず、クラウドブラウザはCloudflareの認証前のブロック、公開GASの読み取りは実行環境のDNS失敗で取得不可。先生のローカルPCのログイン状態は共有されていない。外部設定を代行済みとは記録しない。

新しい管理専用GASは先生が「自分のみ」で公開済みです。予約表、患者一覧、カルテの体図・描画、売上画面、各画面から戻る操作、院長へのLINEテストは確認できました。ログアウト状態ではGoogleログインが表示されました。

これらは先生からの確認結果です。患者用公開APIの遮断や、売上の保存・過去データの引継ぎまで完了した意味ではありません。

## こちらで準備したもの

[修正用PR](https://github.com/kurazi0510-creator/kuraji/pull/1) に管理用コード、公開API制限版、LINE署名検証用中継コード、検証テストがあります。最新の追加修正は先生のApps Scriptへ自動反映されません。

診察券番号等のURL引数の受渡し、不正なAPI操作と本文の拒否、LINE中継先の失敗を成功扱いしない処理を修正しました。

## 残る外部設定・確認

先生の操作をまとめた具体的な切替手順は [CUTOVER.md](CUTOVER.md) に用意しました。

1. LINE中継の502原因を診断ログで特定し、修正後に検証と実際のLINE受信を確認する。
2. 更新済み公開GASで空き枠取得・Web予約を確認する。
3. 管理操作を許す古い公開デプロイを停止する。
4. 患者向け予約確認ページを確認コード方式へ切り替える。

現在は公開GAS更新後に中継が失敗している段階です。管理APIを再公開するロールバックは行わず、中継を先に直します。PR全体のマージは患者用機能の確認が整ってからです。

## 引継ぎの注意

- 元の通知トリガーが動いている間、新しい管理GASに同じトリガーを追加しないでください。二重送信になります。
- 売上は従来からブラウザ内に保存されています。新画面に過去の売上が自動移行されたとは確認できていません。旧ブラウザのデータを消さないでください。
- 電話番号の自己申告だけでは予約照会を許可しません。院側で本人確認した電話番号とLINEユーザーIDだけをサーバーの BOOKING_LOOKUP_VERIFIED_LINKS に設定します。未設定の方は院へ問い合わせる案内になります。
- 左右分割画面、印刷画面のURL引数、売上の保存はGoogle環境で追加確認が必要です。
- 秘密情報の値をチャット・GitHub・写真に載せないでください。

詳細は [README.md](README.md) にあります。
