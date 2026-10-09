/**
 * 倉治整骨院 追加機能：一括セットアップ（kr_setup.gs）
 *
 * ■ 新規追加ファイル。既存ファイルは変更しません。
 * ■ 使い方：GASエディタで krSetupAll を1回だけ実行 → 許可 → 完了メールが届けばOK。
 *
 * ⚠ 重要：既存の setupAllTriggers() は「プロジェクトの全トリガーを削除」してから再作成します。
 *    それを実行すると、ここで作ったトリガーも消えます。実行した後は必ず krSetupAll を再実行してください
 *    （krSetupAll は何度実行しても二重にならない設計です）。krStatus で現在の状態を確認できます。
 */

var KR_TRIGGERS = ["krFollowupDaily", "krBackupWeekly", "krBackupMonthly", "krKpiMonthly"];

function krSetupAll() {
  var msgs = [];
  msgs.push(krFollowupInstallTrigger());   // モードは未設定なら dryrun（送信せず予定だけメール）
  msgs.push(krBackupInstallTriggers());
  msgs.push(krKpiInstallTrigger());
  // シートを先に作っておく（空でも壊れない）
  krEnsureSheet_("kr_followup_exclude", ["診察券No", "患者名", "理由"]);
  krEnsureSheet_("kr_followup_log", KR_FOLLOWUP_LOG_HEADERS);
  krEnsureSheet_(KR_KPI_SHEET, KR_KPI_HEADERS);
  var status = krStatus();
  var body = "追加機能のセットアップが完了しました。\n\n" + msgs.join("\n") + "\n\n" + status +
    "\n\n【次にやること】\n1) 再来院フォローは今「テスト運転(dryrun)」です。患者さんには送られず、毎日“送る予定の人”がこのメールに届きます。\n" +
    "2) 3日ほど内容を確認して問題なければ、GASで krFollowupSetMode('live') を実行すると本番になります。\n" +
    "3) 文面確認は krFollowupTestToOwner（院長のLINEにだけ送信）。\n" +
    "4) バックアップを今すぐ試すなら krBackupNow、月次の数字を試すなら krKpiPreview。";
  krNotifyOwner_("【倉治整骨院】追加機能のセットアップ完了", body, null, { line: "✅ 追加機能のセットアップが完了しました（再来院フォローはテスト運転中）。メールをご確認ください。" });
  krLog_("krSetupAll", "INFO", "セットアップ完了");
  return body;
}

function krStatus() {
  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  var lines = ["【現在の状態】"];
  KR_TRIGGERS.forEach(function (h) { lines.push((triggers.indexOf(h) >= 0 ? "✅ " : "❌ 未設定 ") + h); });
  lines.push("再来院フォロー モード: " + krProp_("KR_FOLLOWUP_MODE", "(未設定=dryrun扱い)"));
  lines.push("LINE_TOKEN: " + (PropertiesService.getScriptProperties().getProperty("LINE_TOKEN") ? "設定あり" : "❌ 未設定"));
  lines.push("LINE_USER_ID(院長): " + (PropertiesService.getScriptProperties().getProperty("LINE_USER_ID") ? "設定あり" : "❌ 未設定（LINE通知なし・メールのみ）"));
  lines.push("通知先メール: " + (krOwnerEmail_() || "❌ 取得できません（KR_OWNER_EMAIL を設定）"));
  lines.push("バックアップ異常フラグ: " + (krProp_("KR_BACKUP_ANOMALY", "") === "1" ? "⚠ 検知中（krBackupAcknowledge で解除）" : "なし"));
  var s = lines.join("\n");
  Logger.log(s);
  return s;
}

// 緊急停止：再来院フォローを止め、追加機能のトリガーだけを削除（既存のトリガーには触れません）
function krStopAll() {
  krSetProp_("KR_FOLLOWUP_MODE", "off");
  var n = 0;
  KR_TRIGGERS.forEach(function (h) { n += krDeleteTriggers_(h); });
  krLog_("krStopAll", "WARN", "緊急停止: トリガー" + n + "件削除・フォローOFF");
  return "追加機能を停止しました（トリガー" + n + "件削除、再来院フォローOFF）。再開は krSetupAll。";
}
