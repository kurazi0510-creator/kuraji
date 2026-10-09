/**
 * 倉治整骨院 追加機能：自動バックアップ（kr_backup.gs）
 *
 * ■ 新規追加ファイル。既存ファイルは変更しません。kr_common.gs が必要です。
 *
 * 1) 週次バックアップ  krBackupWeekly()  … 毎週日曜 3時
 *    スプレッドシート全体をGoogleドライブの「倉治整骨院_バックアップ」フォルダへコピー。
 *    ・コピー後に 患者/予約表/売上 の行数を照合
 *    ・前回正常時より患者数・予約数が急に減っていたら（例: 61人→43人事件）院長へ即アラート
 *      → 異常のあいだは古いバックアップを【絶対に削除しない】（正常な世代を守る）
 *    ・古いバックアップは最新8世代を残して、自分が作ったもの（名前が決まった接頭辞）だけをゴミ箱へ
 * 2) 月次CSV  krBackupMonthly() … 毎月1日 4時
 *    患者/予約表/売上 などをCSV（Excelで文字化けしないBOM付き）でドライブに保存。12か月分保持。
 *    ※スプレッドシート自体が壊れても、CSVから復旧できる“二重の保険”です。
 */

var KR_BACKUP_PREFIX = "倉治整骨院_週次バックアップ_";
var KR_BACKUP_FOLDER = "倉治整骨院_バックアップ";
var KR_BACKUP_CSV_FOLDER = "月次CSV";
var KR_BACKUP_KEEP = 8;          // 週次コピーの保持世代数
var KR_BACKUP_CSV_KEEP = 12;     // 月次CSVの保持か月数
var KR_BACKUP_WATCH = ["患者", "予約表", "売上"];            // 行数を監視するシート
var KR_BACKUP_CSV_SHEETS = ["患者", "予約表", "売上", "LINE_IDs"]; // CSV保存対象（存在するものだけ）

// ───────── 純粋関数（テスト可能） ─────────

// 前回の正常な行数(prev)と今回(cur)を比べて異常を判定
// 異常 = 5行以上の減少 もしくは 10%超の減少（前回が1行以上のとき）
function krBackupAnomaly_(prev, cur) {
  var reasons = [];
  Object.keys(prev || {}).forEach(function (name) {
    var p = Number(prev[name]) || 0;
    var c = Number((cur || {})[name]);
    if (isNaN(c)) { reasons.push(name + "シートが見つかりません（前回 " + p + "件）"); return; }
    if (p <= 0) return;
    var drop = p - c;
    if (drop >= 5 || (drop > 0 && drop / p > 0.1)) {
      reasons.push(name + "が " + p + "件 → " + c + "件に減っています（" + drop + "件減）");
    }
  });
  return { anomaly: reasons.length > 0, reasons: reasons };
}

// 週次コピー一覧 [{id,name}] から削除対象を返す。接頭辞が違うものは絶対に対象にしない。
function krBackupSelectOld_(files, keep) {
  var mine = (files || []).filter(function (f) { return String(f.name).indexOf(KR_BACKUP_PREFIX) === 0; });
  mine.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); }); // 新しい順
  return mine.slice(keep);
}

// 月次フォルダ名 ["202610", ...] から削除対象を返す（yyyyMM形式のみ）
function krBackupSelectOldMonths_(names, keep) {
  var ok = (names || []).filter(function (n) { return /^\d{6}$/.test(n); });
  ok.sort().reverse();
  return ok.slice(keep);
}

function krCsvCell_(v) {
  var s = String(v === null || v === undefined ? "" : v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function krToCsv_(rows) {
  return (rows || []).map(function (r) { return r.map(krCsvCell_).join(","); }).join("\r\n");
}

// ───────── Drive操作 ─────────
function krBackupFolder_() {
  var id = krProp_("KR_BACKUP_FOLDER_ID", "");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { krLog_("krBackupFolder_", "WARN", "指定フォルダが開けません: " + e.message); } }
  var it = DriveApp.getFoldersByName(KR_BACKUP_FOLDER);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(KR_BACKUP_FOLDER);
}
function krSubFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function krSheetCounts_(ss) {
  var c = {};
  KR_BACKUP_WATCH.forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh) c[n] = Math.max(0, sh.getLastRow() - 1);
  });
  return c;
}

// ───────── 週次バックアップ ─────────
function krBackupWeekly() {
  return krWithLock_(function () {
    try {
      return krBackupWeeklyRun_();
    } catch (e) {
      krLog_("krBackupWeekly", "ERROR", e.message);
      krNotifyOwner_("【倉治整骨院】⚠ 週次バックアップに失敗しました",
        "週次バックアップ中にエラーが発生しました。\n\n" + e.message + "\n\nGASの実行ログ、またはドライブの空き容量をご確認ください。\n手動で krBackupNow を実行すると再試行できます。",
        null, { line: "⚠ 週次バックアップに失敗しました。メールをご確認ください。" });
      return { ok: false, error: e.message };
    }
  });
}

function krBackupWeeklyRun_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var now = Utilities.formatDate(new Date(), KR_TZ, "yyyyMMdd_HHmm");
  var cur = krSheetCounts_(ss);
  var prev = {};
  try { prev = JSON.parse(krProp_("KR_BACKUP_LAST_COUNTS", "{}")) || {}; } catch (e) { prev = {}; }

  var folder = krBackupFolder_();
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(KR_BACKUP_PREFIX + now, folder);

  // コピーの照合
  var verifyNote = "";
  var verifyOk = true;
  try {
    var cs = SpreadsheetApp.openById(copy.getId());
    var cc = krSheetCounts_(cs);
    Object.keys(cur).forEach(function (n) {
      if (cc[n] === undefined || Math.abs(cc[n] - cur[n]) > 2) { verifyOk = false; verifyNote += n + ":元" + cur[n] + "/コピー" + cc[n] + " "; }
    });
  } catch (e2) { verifyOk = false; verifyNote = "コピーを開けませんでした: " + e2.message; }

  var an = krBackupAnomaly_(prev, cur);
  var flagged = krProp_("KR_BACKUP_ANOMALY", "") === "1";
  var pruned = 0;
  var summary = Object.keys(cur).map(function (n) { return n + " " + cur[n] + "件"; }).join(" / ");

  if (an.anomaly) {
    krSetProp_("KR_BACKUP_ANOMALY", "1");
    krLog_("krBackupWeekly", "ALERT", an.reasons.join(" / "));
    krNotifyOwner_("【倉治整骨院】🚨 データが急に減っています（バックアップは保護中）",
      "週次バックアップ時に、データの急な減少を検知しました。\n\n" +
      an.reasons.map(function (r) { return "・" + r; }).join("\n") + "\n\n" +
      "▼ 安全のため、古いバックアップの自動削除を【停止】しました（正常だった頃のコピーは残っています）。\n" +
      "▼ ドライブの「" + KR_BACKUP_FOLDER + "」から、減る前の日付のコピーを開いて復元できます。\n" +
      "▼ 意図した削除（整理）だった場合は、GASで krBackupAcknowledge を実行すると基準値が更新されます。\n\n" +
      "今回のコピー: " + copy.getName(),
      null, { line: "🚨 患者/予約データが急に減っています。メールをご確認ください（古いバックアップは保護中）" });
  } else if (!flagged) {
    krSetProp_("KR_BACKUP_LAST_COUNTS", JSON.stringify(cur));
  }

  if (!an.anomaly && !flagged && verifyOk) {
    // 古い世代の整理（自分の接頭辞のファイルだけ）
    var list = [];
    var it = folder.getFiles();
    while (it.hasNext()) { var f = it.next(); list.push({ id: f.getId(), name: f.getName() }); }
    krBackupSelectOld_(list, KR_BACKUP_KEEP).forEach(function (o) {
      try { DriveApp.getFileById(o.id).setTrashed(true); pruned++; } catch (e3) {}
    });
  }

  if (!verifyOk) {
    krLog_("krBackupWeekly", "WARN", "照合差異: " + verifyNote);
    krNotifyOwner_("【倉治整骨院】⚠ バックアップの照合に差異があります",
      "バックアップは作成しましたが、元データとの件数に差異があります（作成中に入力があった可能性もあります）。\n" + verifyNote + "\nコピー: " + copy.getName() + "\n念のため krBackupNow で再作成してください。",
      null, { line: "⚠ バックアップの件数照合に差異があります。メールをご確認ください。" });
  }

  krLog_("krBackupWeekly", "INFO", "作成 " + copy.getName() + " / " + summary + " / 整理 " + pruned + "件" + (an.anomaly ? " / 異常あり" : ""));
  if (krProp_("KR_BACKUP_NOTIFY_SUCCESS", "") === "1" && !an.anomaly) {
    krNotifyOwner_("【倉治整骨院】週次バックアップ完了",
      "バックアップを作成しました。\n" + copy.getName() + "\n" + summary + "\n古い世代の整理: " + pruned + "件",
      null, { noLine: true });
  }
  return { ok: true, name: copy.getName(), counts: cur, anomaly: an.anomaly, pruned: pruned };
}

// 意図した減少だった場合に、基準値を現在値へ更新して保護を解除
function krBackupAcknowledge() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cur = krSheetCounts_(ss);
  krSetProp_("KR_BACKUP_LAST_COUNTS", JSON.stringify(cur));
  PropertiesService.getScriptProperties().deleteProperty("KR_BACKUP_ANOMALY");
  krLog_("krBackupAcknowledge", "INFO", "基準値を更新: " + JSON.stringify(cur));
  return "基準値を更新し、保護を解除しました: " + JSON.stringify(cur);
}

// ───────── 月次CSV ─────────
function krBackupMonthly() {
  return krWithLock_(function () {
    try {
      return krBackupMonthlyRun_();
    } catch (e) {
      krLog_("krBackupMonthly", "ERROR", e.message);
      krNotifyOwner_("【倉治整骨院】⚠ 月次CSVバックアップに失敗しました",
        "月次CSV保存中にエラーが発生しました。\n\n" + e.message, null, { line: "⚠ 月次CSVバックアップに失敗しました。メールをご確認ください。" });
      return { ok: false, error: e.message };
    }
  });
}

function krBackupMonthlyRun_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ym = Utilities.formatDate(new Date(), KR_TZ, "yyyyMM");
  var root = krSubFolder_(krBackupFolder_(), KR_BACKUP_CSV_FOLDER);
  var dir = krSubFolder_(root, ym);
  var saved = [];
  KR_BACKUP_CSV_SHEETS.forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh || sh.getLastRow() < 1) return;
    var csv = "﻿" + krToCsv_(sh.getDataRange().getDisplayValues());
    var fname = n + "_" + ym + ".csv";
    var old = dir.getFilesByName(fname);
    while (old.hasNext()) old.next().setTrashed(true); // 同月の再実行は自分のファイルだけ置き換え
    dir.createFile(fname, csv, MimeType.CSV);
    saved.push(n + "(" + (sh.getLastRow() - 1) + "行)");
  });

  var pruned = 0;
  if (krProp_("KR_BACKUP_ANOMALY", "") !== "1") {
    var names = [], map = {};
    var it = root.getFolders();
    while (it.hasNext()) { var f = it.next(); names.push(f.getName()); map[f.getName()] = f; }
    krBackupSelectOldMonths_(names, KR_BACKUP_CSV_KEEP).forEach(function (n) { map[n].setTrashed(true); pruned++; });
  }
  krLog_("krBackupMonthly", "INFO", ym + " 保存: " + saved.join(", ") + " / 整理 " + pruned + "件");
  return { ok: true, month: ym, saved: saved, pruned: pruned };
}

// ───────── 手動実行・トリガー ─────────
function krBackupNow() {
  var w = krBackupWeekly();
  var m = krBackupMonthly();
  return JSON.stringify({ weekly: w, monthly: m });
}

function krBackupInstallTriggers() {
  krDeleteTriggers_("krBackupWeekly");
  krDeleteTriggers_("krBackupMonthly");
  ScriptApp.newTrigger("krBackupWeekly").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  ScriptApp.newTrigger("krBackupMonthly").timeBased().onMonthDay(1).atHour(4).create();
  return "週次(日曜3時台)・月次(1日4時台)のバックアップを設定しました";
}
function krBackupRemoveTriggers() {
  return (krDeleteTriggers_("krBackupWeekly") + krDeleteTriggers_("krBackupMonthly")) + "件のトリガーを削除しました";
}
