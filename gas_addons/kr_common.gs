/**
 * 倉治整骨院 追加機能：共通部品（kr_common.gs）
 *
 * ■ これは「新規追加ファイル」です。gas_full_v5.gs など既存ファイルは一切変更しません。
 * ■ 既存のGASプロジェクトに、このファイルを含む kr_*.gs を同じプロジェクトへ追加して使います。
 * ■ 関数名は全て kr で始まり、既存の関数名とぶつかりません。
 * ■ 既存の関数（sendLineMessagingAPI / findLineUidForPatient_ / getSlotsForDate_）は
 *   存在すれば利用し、無くても動くようにしてあります。
 */

var KR_TZ = "Asia/Tokyo";

// ───────── スクリプトプロパティ ─────────
function krProp_(key, def) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === undefined || v === "") ? def : v;
}
function krSetProp_(key, val) {
  PropertiesService.getScriptProperties().setProperty(key, String(val));
}

// ───────── 日付 ─────────
function krTodayStr_() {
  return Utilities.formatDate(new Date(), KR_TZ, "yyyy-MM-dd");
}
// "yyyy-MM-dd" → 1970-01-01からの日数（タイムゾーンに左右されない）
function krDayNum_(str) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(str || ""));
  if (!m) return NaN;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}
// シートのセル値（Date or 文字列）→ "yyyy-MM-dd"（読めなければ空文字）
function krCellDateStr_(v, tz) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    return Utilities.formatDate(v, tz || KR_TZ, "yyyy-MM-dd");
  }
  var s = String(v === null || v === undefined ? "" : v).trim();
  if (!s) return "";
  var m = /^(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/.exec(s);
  if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  return "";
}
function krMonthStr_(dateStr) { return String(dateStr || "").slice(0, 7); }
// "2026-09" → "2026-08"
function krPrevMonth_(ym) {
  var p = String(ym).split("-");
  var y = +p[0], m = +p[1] - 1;
  if (m < 1) { y -= 1; m = 12; }
  return y + "-" + ("0" + m).slice(-2);
}
function krNextMonth_(ym) {
  var p = String(ym).split("-");
  var y = +p[0], m = +p[1] + 1;
  if (m > 12) { y += 1; m = 1; }
  return y + "-" + ("0" + m).slice(-2);
}
function krDaysInMonth_(ym) {
  var p = String(ym).split("-");
  return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate();
}
function krJstHour_() {
  return parseInt(Utilities.formatDate(new Date(), KR_TZ, "H"), 10);
}

// ───────── 予約表の読み込み ─────────
// 既存ロジック（dailyLineAlert / sendDormantPatientOutreach）と同じ考え方：
//  ・区分に「キャンセル」を含む行 = キャンセル
//  ・区分に「継続」を含む行 = 2枠目以降（来院回数・新患数・来院人数には数えない）
//  ・同じ患者は「スペースを除いた患者名」で同一人物として扱う
function krLoadBookings_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("予約表");
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var h = data[0].map(function (x) { return String(x || "").trim(); });
  var di = h.indexOf("日付"), ki = h.indexOf("区分"), ni = h.indexOf("患者名"),
      ii = h.indexOf("診察券No"), ri = h.indexOf("予約ルート"), pi = h.indexOf("支払金額"),
      bi = h.indexOf("物販(JSON)"), li = h.indexOf("区分リスト");
  if (di < 0 || ni < 0) return [];
  var tz = ss.getSpreadsheetTimeZone() || KR_TZ;
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var dateStr = krCellDateStr_(r[di], tz);
    if (!dateStr) continue;
    var kubun = String(ki >= 0 ? r[ki] : "").trim();
    var listRaw = String(li >= 0 ? r[li] : "").trim();
    var list = listRaw ? listRaw.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s; }) : (kubun ? [kubun] : []);
    var name = String(r[ni] || "").trim();
    var bussan = 0;
    if (bi >= 0 && r[bi]) {
      try {
        JSON.parse(r[bi]).forEach(function (b) { bussan += (Number(b.price) || 0) * (Number(b.qty) || 1); });
      } catch (e) {}
    }
    out.push({
      date: dateStr,
      day: krDayNum_(dateStr),
      kubun: kubun,
      kubunList: list,
      name: name,
      key: name.replace(/[\s　]+/g, ""),
      id: String(ii >= 0 ? r[ii] : "").trim(),
      route: String(ri >= 0 ? r[ri] : "").trim(),
      pay: parseInt(pi >= 0 ? r[pi] : 0, 10) || 0,
      bussan: bussan,
      cancelled: kubun.indexOf("キャンセル") > -1,
      cont: kubun.indexOf("継続") > -1
    });
  }
  return out;
}

// 患者シートを { rows:[{id,name,key,src,line,lastVisit,count}], byId, byKey } で返す（読み取りのみ）
function krLoadPatients_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("患者");
  var res = { rows: [], byId: {}, byKey: {}, header: [] };
  if (!sh) return res;
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return res;
  var h = data[0].map(function (x) { return String(x || "").trim(); });
  res.header = h;
  var c = function (n) { return h.indexOf(n); };
  var idI = c("診察券No"), nmI = c("患者名"), srcI = c("流入元"), lnI = c("LINE"),
      cntI = c("通院回数"), dormI = c("休眠促進送信"), fuI = c("再来院フォロー送信");
  if (idI < 0) idI = 0;
  if (nmI < 0) nmI = 1;
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var id = String(r[idI] || "").trim();
    var name = String(r[nmI] || "").trim();
    if (!id && !name) continue;
    var row = {
      id: id,
      name: name,
      key: name.replace(/[\s　]+/g, ""),
      src: String(srcI >= 0 ? r[srcI] : "").trim(),
      line: String(lnI >= 0 ? r[lnI] : "").trim(),
      count: parseInt(cntI >= 0 ? r[cntI] : 0, 10) || 0,
      optOutDormant: dormI >= 0 && String(r[dormI] || "").toUpperCase() === "FALSE",
      optOutFollow: fuI >= 0 && String(r[fuI] || "").toUpperCase() === "FALSE"
    };
    res.rows.push(row);
    if (id) res.byId[id] = row;
    if (row.key) res.byKey[row.key] = row;
  }
  return res;
}

// ───────── LINE ─────────
function krFindLineUid_(name, id) {
  try {
    if (typeof findLineUidForPatient_ === "function") {
      return findLineUidForPatient_({ name: name, cards: id ? [String(id)] : [] }) || "";
    }
  } catch (e) {
    krLog_("krFindLineUid_", "WARN", name + ": " + e.message);
  }
  return "";
}
function krSendLine_(uid, msg) {
  var token = PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
  if (!token) return { ok: false, error: "LINE_TOKENが未設定です" };
  if (!uid) return { ok: false, error: "送信先が空です" };
  if (typeof sendLineMessagingAPI === "function") return sendLineMessagingAPI(token, uid, msg);
  try {
    var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      method: "post",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      payload: JSON.stringify({ to: uid, messages: [{ type: "text", text: msg }] }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    return code === 200 ? { ok: true } : { ok: false, error: "LINE API エラー(コード" + code + ")" };
  } catch (e) { return { ok: false, error: "例外: " + e.message }; }
}

// ───────── 院長への通知（メール＋LINE） ─────────
function krOwnerEmail_() {
  var e = krProp_("KR_OWNER_EMAIL", "");
  if (e) return e;
  try { return Session.getEffectiveUser().getEmail() || ""; } catch (err) { return ""; }
}
// opts: { line: "短い本文(省略可)", noEmail: true, noLine: true }
function krNotifyOwner_(subject, textBody, htmlBody, opts) {
  opts = opts || {};
  var result = { email: false, line: false };
  if (!opts.noEmail) {
    try {
      var to = krOwnerEmail_();
      if (to) {
        var mail = { to: to, subject: subject, body: textBody, name: "倉治整骨院 自動レポート" };
        if (htmlBody) mail.htmlBody = htmlBody;
        MailApp.sendEmail(mail);
        result.email = true;
      }
    } catch (e) { krLog_("krNotifyOwner_", "ERROR", "メール送信失敗: " + e.message); }
  }
  if (!opts.noLine && opts.line) {
    try {
      var owner = PropertiesService.getScriptProperties().getProperty("LINE_USER_ID");
      if (owner) result.line = !!krSendLine_(owner, opts.line).ok;
    } catch (e2) { krLog_("krNotifyOwner_", "ERROR", "LINE送信失敗: " + e2.message); }
  }
  return result;
}

// ───────── シート操作 ─────────
function krEnsureSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 && headers && headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function krAppendRows_(sh, rows) {
  if (!rows || !rows.length) return;
  var start = sh.getLastRow() + 1;
  var rng = sh.getRange(start, 1, rows.length, rows[0].length);
  rng.setNumberFormat("@");
  rng.setValues(rows);
}

// ───────── ログ（kr_system_log シート。自分のログだけを整理する） ─────────
function krLog_(func, level, message) {
  try {
    Logger.log("[" + level + "] " + func + ": " + message);
    var sh = krEnsureSheet_("kr_system_log", ["日時", "処理", "レベル", "内容"]);
    krAppendRows_(sh, [[Utilities.formatDate(new Date(), KR_TZ, "yyyy-MM-dd HH:mm:ss"), func, level, String(message).slice(0, 500)]]);
    if (sh.getLastRow() > 3000) sh.deleteRows(2, 1000); // 自分のログシートだけ古い順に整理
  } catch (e) { /* ログ失敗で本処理を止めない */ }
}

// ───────── 二重実行防止 ─────────
function krWithLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    krLog_("krWithLock_", "WARN", "別の処理が実行中のため今回はスキップしました");
    return null;
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

// ───────── トリガー管理（kr で始まる関数のトリガーだけを対象にする） ─────────
function krDeleteTriggers_(handler) {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}
function krHasTrigger_(handler) {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === handler; });
}
