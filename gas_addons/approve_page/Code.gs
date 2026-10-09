/**
 * 倉治整骨院：再来院フォロー「スマホ承認ページ」（別プロジェクト用・新規）
 *
 * ■ 管理専用・無題のプロジェクトには一切触れません。この専用の小さなプロジェクトに貼ります。
 * ■ このページは「文面の編集」と「送信OKのチェック」をシートに書くだけです。
 *    LINEを送る処理はしません（送るのは従来どおり kr_all.gs の毎時の送信。送信直前の再確認もそのまま働きます）。
 * ■ LINE_TOKEN はこのプロジェクトには置きません。
 *
 * スクリプトプロパティ（2つ）：
 *   AP_SHEET_ID … 「整骨院向け予約管理スプレッドシート作成」のID（URLの /d/ と /edit の間）
 *   AP_TOKEN    … 長いランダムな文字列（apMakeToken を実行すると作れます）
 */
var AP_SHEET = "kr_followup_queue";
var AP_HEADERS = ["候補日", "診察券No", "患者名", "前回来院日", "経過日数", "タイミング", "ステージ", "次回予約", "送信する文面（編集できます）", "送信OK", "結果", "結果日時", "メモ", "重複チェック用キー"];

function apProp_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ""; }

function apMakeToken() {
  var t = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty("AP_TOKEN", t);
  Logger.log("AP_TOKEN を設定しました。URLの末尾に ?t=" + t + " を付けて開きます。");
  return t;
}

function apCheck_(t) {
  var tok = apProp_("AP_TOKEN");
  if (!tok || String(t || "") !== tok) throw new Error("アクセスできません（URLが違います）");
}

function apSheet_() {
  var id = apProp_("AP_SHEET_ID");
  if (!id) throw new Error("AP_SHEET_ID が未設定です");
  var sh = SpreadsheetApp.openById(id).getSheetByName(AP_SHEET);
  if (!sh) throw new Error("シート " + AP_SHEET + " がありません");
  var head = sh.getRange(1, 1, 1, AP_HEADERS.length).getValues()[0];
  for (var i = 0; i < AP_HEADERS.length; i++) {
    if (String(head[i]) !== AP_HEADERS[i]) throw new Error("見出しが想定と違うため停止しました（" + (i + 1) + "列目）。シートの1行目は変更しないでください");
  }
  return sh;
}

function doGet(e) {
  var t = (e && e.parameter && e.parameter.t) || "";
  try { apCheck_(t); } catch (err) {
    return HtmlService.createHtmlOutput("<p style='font:16px sans-serif;padding:24px'>アクセスできません。LINEに届いたURLから開いてください。</p>");
  }
  var tpl = HtmlService.createTemplateFromFile("index");
  tpl.token = t;
  return tpl.evaluate().setTitle("再来院フォロー 承認").addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function apFmt_(v) { return (v instanceof Date) ? Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd") : String(v == null ? "" : v); }

// 結果が空の行（まだ送っていない・中止されていない行）だけを返す
function apList(t) {
  apCheck_(t);
  var sh = apSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, AP_HEADERS.length).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    if (String(r[10] || "") !== "") return;
    if (!String(r[2] || "").trim()) return;
    out.push({ row: i + 2, date: apFmt_(r[0]), id: apFmt_(r[1]), name: String(r[2]), prev: apFmt_(r[3]), days: apFmt_(r[4]),
      timing: String(r[5]), next: String(r[7] || ""), text: String(r[8] || ""), ok: r[9] === true, key: String(r[13] || "") });
  });
  return out;
}

// items: [{row, key, text, ok}]。行がずれていないか（キー一致）・結果が空かを確認してから書く
function apSave(t, items) {
  apCheck_(t);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = apSheet_(), res = [];
    (items || []).forEach(function (it) {
      var row = Number(it.row);
      if (!(row >= 2) || row > sh.getLastRow()) { res.push({ row: row, ok: false, msg: "行が見つかりません" }); return; }
      var r = sh.getRange(row, 1, 1, AP_HEADERS.length).getValues()[0];
      if (String(r[13] || "") !== String(it.key || "")) { res.push({ row: row, ok: false, msg: "シートが変わっています。読み込み直してください" }); return; }
      if (String(r[10] || "") !== "") { res.push({ row: row, ok: false, msg: "すでに処理済みです（" + r[10] + "）" }); return; }
      var text = String(it.text == null ? "" : it.text);
      if (it.ok && !text.trim()) { res.push({ row: row, ok: false, msg: "文面が空です" }); return; }
      sh.getRange(row, 9).setValue(text);
      sh.getRange(row, 10).setValue(it.ok === true);
      res.push({ row: row, ok: true, msg: it.ok ? "送信OKにしました（次の自動送信で、直前の再確認のうえ送られます）" : "保存しました（送信はしません）" });
    });
    SpreadsheetApp.flush();
    return res;
  } finally { lock.releaseLock(); }
}
