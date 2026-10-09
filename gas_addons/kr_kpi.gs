/**
 * 倉治整骨院 追加機能：月次の数字 自動集計（kr_kpi.gs）
 *
 * ■ 新規追加ファイル。既存ファイルは変更しません。kr_common.gs が必要です。
 * ■ 毎月1日 8時に「先月の数字」を 予約表 から自動集計し、院長へメール(＋LINE要約)で送ります。
 *   院長は月1回、このメールを30分見るだけでOK。履歴は kr_kpi_monthly シートに積み上がります。
 *
 * 数字の定義（kanri.htmlと同じ考え方）
 *  ・来院 = キャンセルでも「継続」でもない予約行
 *  ・新患 = 来院のうち 区分リスト に「新規」を含む人（同一人物は1人）
 *  ・売上 = 支払金額の合計 ／ 物販 = 物販(JSON)の合計 ／ 施術分 = 支払金額−物販
 *           施術分の内訳：区分に「保険」→保険、なければ「交通事故」→交通事故、他→自費
 *  ・稼働率 = 予約された枠数(継続枠含む) ÷ その月に開いていた枠数
 *  ・次回予約率 = 来院のうち、その後の日付に有効な予約が入っている割合（目標60%）
 *  ・新患の30日以内再来院率 = 初診日の翌日〜30日後に再来院した割合
 *      （2か月前の新患は確定値、先月の新患は途中経過の参考値）
 */

var KR_KPI_SHEET = "kr_kpi_monthly";
var KR_KPI_HEADERS = ["対象月", "来院数", "来院人数", "新患数", "キャンセル数", "キャンセル率%", "売上合計", "保険", "自費", "交通事故", "物販",
                      "1来院単価", "稼働率%", "物販比率%", "次回予約率%", "LINE登録率%", "新患30日再来率%(確定)", "集計日時"];

function krPct_(a, b) { return b > 0 ? Math.round(a * 1000 / b) / 10 : null; }
function krYen_(n) { return (Math.round(Number(n) || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function krFmtPct_(v) { return v === null || v === undefined ? "―" : v + "%"; }

// 月ごとの集計（純粋関数）
// bookings: krLoadBookings_() の結果 / patients: krLoadPatients_() の結果
// slotsFn(dateStr) → その日の開いている枠数（不明なら null）
function krKpiCompute_(ym, bookings, patients, slotsFn) {
  var inMonth = bookings.filter(function (b) { return krMonthStr_(b.date) === ym; });
  var visits = inMonth.filter(function (b) { return !b.cancelled && !b.cont; });
  var cancels = inMonth.filter(function (b) { return b.cancelled && !b.cont; });
  var activeRows = inMonth.filter(function (b) { return !b.cancelled; }); // 継続枠も稼働に数える

  var uniq = {};
  visits.forEach(function (b) { if (b.key) uniq[b.key] = true; });

  // 新患（月内の最初の「新規」来院を人ごとに）
  var newFirst = {};
  visits.forEach(function (b) {
    if (b.key && b.kubunList.some(function (k) { return k.indexOf("新規") > -1; })) {
      if (!newFirst[b.key] || b.day < newFirst[b.key].day) newFirst[b.key] = b;
    }
  });
  var newKeys = Object.keys(newFirst);

  // 売上
  var total = 0, hoken = 0, jihi = 0, jiko = 0, bussan = 0, paidVisits = 0;
  activeRows.forEach(function (b) {
    if (b.pay <= 0) return;
    total += b.pay;
    bussan += b.bussan;
    if (!b.cont) paidVisits++;
    var seturyo = Math.max(0, b.pay - b.bussan);
    if (b.kubunList.indexOf("保険") >= 0) hoken += seturyo;
    else if (b.kubunList.indexOf("交通事故") >= 0) jiko += seturyo;
    else jihi += seturyo;
  });

  // 稼働率
  var days = {};
  activeRows.forEach(function (b) { days[b.date] = (days[b.date] || 0) + 1; });
  var booked = activeRows.length, capacity = 0, usedFallback = false;
  Object.keys(days).forEach(function (d) {
    var n = null;
    try { n = slotsFn ? slotsFn(d) : null; } catch (e) { n = null; }
    if (n === null || n === undefined || !(n > 0)) { n = 28; usedFallback = true; }
    capacity += n;
  });

  // 次回予約率：来院の後に同じ人の有効予約があるか
  var byKey = {};
  bookings.forEach(function (b) { if (!b.cancelled && !b.cont && b.key) (byKey[b.key] = byKey[b.key] || []).push(b.day); });
  var withNext = 0;
  visits.forEach(function (b) {
    if (!b.key) return;
    var arr = byKey[b.key] || [];
    if (arr.some(function (d) { return d > b.day; })) withNext++;
  });

  // 流入元別（新患）・予約ルート別（来院）
  var bySrc = {}, byRoute = {};
  newKeys.forEach(function (k) {
    var p = patients.byKey[k] || patients.byId[newFirst[k].id];
    var s = (p && p.src) || newFirst[k].route || "不明";
    bySrc[s] = (bySrc[s] || 0) + 1;
  });
  visits.forEach(function (b) { var r = b.route || "不明"; byRoute[r] = (byRoute[r] || 0) + 1; });

  // LINE登録率（その月に来院した人のうち、患者シートのLINE列が入っている割合）
  var lineReg = 0, lineBase = 0;
  Object.keys(uniq).forEach(function (k) {
    var p = patients.byKey[k];
    if (!p) return;
    lineBase++;
    if (p.line) lineReg++;
  });

  return {
    month: ym,
    visits: visits.length, people: Object.keys(uniq).length,
    newPatients: newKeys.length, cancels: cancels.length,
    cancelRate: krPct_(cancels.length, visits.length + cancels.length),
    total: total, hoken: hoken, jihi: jihi, jiko: jiko, bussan: bussan,
    unit: paidVisits > 0 ? Math.round(total / paidVisits) : null,
    paidVisits: paidVisits,
    utilization: krPct_(booked, capacity), capacityFallback: usedFallback,
    bussanRate: krPct_(bussan, total),
    nextRate: krPct_(withNext, visits.length),
    lineRate: krPct_(lineReg, lineBase),
    bySrc: bySrc, byRoute: byRoute
  };
}

// 新患コホートの30日以内再来院率。cohortYm の新患のうち、翌日〜30日後に再来院した割合
function krKpiReturn30_(cohortYm, bookings) {
  var first = {};
  bookings.forEach(function (b) {
    if (krMonthStr_(b.date) !== cohortYm || b.cancelled || b.cont || !b.key) return;
    if (b.kubunList.some(function (k) { return k.indexOf("新規") > -1; })) {
      if (!first[b.key] || b.day < first[b.key]) first[b.key] = b.day;
    }
  });
  var keys = Object.keys(first), back = 0;
  keys.forEach(function (k) {
    var d0 = first[k];
    var ok = bookings.some(function (b) { return b.key === k && !b.cancelled && !b.cont && b.day > d0 && b.day <= d0 + 30; });
    if (ok) back++;
  });
  return { base: keys.length, back: back, rate: krPct_(back, keys.length) };
}

function krDelta_(cur, prev, unit) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return "―";
  var d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return "±0" + (unit || "");
  return (d > 0 ? "+" : "") + (unit === "円" ? krYen_(d) : d) + (unit || "");
}

// 気づきコメント（数字の読み方をヒントとして添える）
function krKpiInsights_(m, p, r30conf) {
  var out = [];
  if (m.nextRate !== null) {
    if (m.nextRate < 60) out.push("次回予約率が " + m.nextRate + "%（目標60%）。会計時に「次はいつがよいですか」と先に聞くのが最も効きます。");
    else out.push("次回予約率 " + m.nextRate + "% は目標の60%以上。この習慣を維持しましょう。");
  }
  if (r30conf && r30conf.base >= 3 && r30conf.rate !== null && r30conf.rate < 50)
    out.push("新患の30日以内再来院率が " + r30conf.rate + "%（" + r30conf.base + "人中" + r30conf.back + "人）。初診後の2回目予約の取り方・初診後フォローを見直す余地があります。");
  if (m.cancelRate !== null && m.cancelRate >= 10)
    out.push("キャンセル率が " + m.cancelRate + "% とやや高めです。前日のリマインドLINEを確認しましょう。");
  if (p && p.newPatients > 0 && m.newPatients < p.newPatients)
    out.push("新患が前月より " + (p.newPatients - m.newPatients) + "人減っています。流入元別の内訳を確認してください。");
  if (m.utilization !== null && m.utilization < 50)
    out.push("稼働率が " + m.utilization + "% です。空き枠の多い曜日・時間帯への集客策（LINE配信・口コミ依頼）を検討してください。");
  if (m.capacityFallback) out.push("※稼働率の枠数は一部、標準28枠で概算しています。");
  if (!out.length) out.push("大きな注意点はありません。");
  return out;
}

function krKpiBuildReport_(m, p, r30conf, r30prov) {
  var lines = [];
  var row = function (label, val, delta) { lines.push(label + "：" + val + (delta ? "（前月比 " + delta + "）" : "")); };
  lines.push("■ " + m.month + " の数字");
  row("来院数", m.visits + "回", p ? krDelta_(m.visits, p.visits, "回") : "");
  row("来院人数", m.people + "人", p ? krDelta_(m.people, p.people, "人") : "");
  row("新患数", m.newPatients + "人", p ? krDelta_(m.newPatients, p.newPatients, "人") : "");
  row("売上合計", krYen_(m.total) + "円", p ? krDelta_(m.total, p.total, "円") : "");
  lines.push("　内訳 保険 " + krYen_(m.hoken) + "円 / 自費 " + krYen_(m.jihi) + "円 / 交通事故 " + krYen_(m.jiko) + "円 / 物販 " + krYen_(m.bussan) + "円");
  row("1来院あたり売上", m.unit === null ? "―" : krYen_(m.unit) + "円", p && p.unit !== null && m.unit !== null ? krDelta_(m.unit, p.unit, "円") : "");
  row("稼働率", krFmtPct_(m.utilization), p ? krDelta_(m.utilization, p.utilization, "pt") : "");
  row("キャンセル率", krFmtPct_(m.cancelRate) + "（" + m.cancels + "件）", p ? krDelta_(m.cancelRate, p.cancelRate, "pt") : "");
  row("物販比率", krFmtPct_(m.bussanRate), "");
  row("次回予約率（目標60%）", krFmtPct_(m.nextRate), p ? krDelta_(m.nextRate, p.nextRate, "pt") : "");
  row("LINE登録率", krFmtPct_(m.lineRate), "");
  lines.push("新患の30日以内再来院率：" + (r30conf.base ? krFmtPct_(r30conf.rate) + "（確定・" + r30conf.base + "人中" + r30conf.back + "人）" : "対象なし") +
             (r30prov.base ? " ／ 先月分の途中経過 " + krFmtPct_(r30prov.rate) + "（" + r30prov.base + "人中" + r30prov.back + "人）" : ""));
  var srcKeys = Object.keys(m.bySrc);
  if (srcKeys.length) lines.push("新患の流入元：" + srcKeys.map(function (k) { return k + " " + m.bySrc[k] + "人"; }).join(" / "));
  var rKeys = Object.keys(m.byRoute);
  if (rKeys.length) lines.push("予約ルート：" + rKeys.map(function (k) { return k + " " + m.byRoute[k]; }).join(" / "));
  lines.push("");
  lines.push("■ 今月のひとこと");
  krKpiInsights_(m, p, r30conf).forEach(function (s) { lines.push("・" + s); });
  lines.push("");
  lines.push("■ 月1回・30分のチェック手順");
  lines.push("1) 売上と新患の増減 → 2) 次回予約率・再来院率 → 3) キャンセルと稼働率 → 4) 来月の1アクションを1つだけ決める");
  return lines.join("\n");
}

function krEsc_(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function krKpiHtml_(text) {
  var html = ['<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#222">'];
  text.split("\n").forEach(function (l) {
    if (l.indexOf("■") === 0) html.push('<h3 style="margin:16px 0 4px;border-left:4px solid #2a7;padding-left:8px">' + krEsc_(l.slice(1).trim()) + "</h3>");
    else if (l === "") html.push("");
    else html.push("<div>" + krEsc_(l) + "</div>");
  });
  html.push("</div>");
  return html.join("\n");
}

function krKpiLineSummary_(m, p, r30conf) {
  return "📊 " + m.month + " 月次の数字\n" +
    "来院 " + m.visits + "回 / 新患 " + m.newPatients + "人\n" +
    "売上 " + krYen_(m.total) + "円" + (p ? "（前月比 " + krDelta_(m.total, p.total, "円") + "）" : "") + "\n" +
    "次回予約率 " + krFmtPct_(m.nextRate) + " / キャンセル率 " + krFmtPct_(m.cancelRate) + "\n" +
    "詳細はメールをご確認ください。";
}

function krSlotsFn_() {
  if (typeof getSlotsForDate_ !== "function") return null;
  return function (dateStr) {
    var r = getSlotsForDate_(dateStr);
    return r && r.length !== undefined ? r.length : null;
  };
}

// ───────── 実行 ─────────
// ym 省略時は「先月」。例: krKpiForMonth("2026-09")
function krKpiForMonth(ym, opts) {
  opts = opts || {};
  ym = ym || krPrevMonth_(krMonthStr_(krTodayStr_()));
  var bookings = krLoadBookings_();
  var patients = krLoadPatients_();
  var slotsFn = krSlotsFn_();
  var m = krKpiCompute_(ym, bookings, patients, slotsFn);
  var p = krKpiCompute_(krPrevMonth_(ym), bookings, patients, slotsFn);
  if (p.visits === 0 && p.total === 0) p = null; // 前月データなし
  var r30conf = krKpiReturn30_(krPrevMonth_(ym), bookings);
  var r30prov = krKpiReturn30_(ym, bookings);
  var text = krKpiBuildReport_(m, p, r30conf, r30prov);

  if (!opts.preview) {
    krKpiSaveHistory_(m, r30conf);
    krNotifyOwner_("【倉治整骨院】" + ym + " 月次の数字", text, krKpiHtml_(text), { line: krKpiLineSummary_(m, p, r30conf) });
    krLog_("krKpiForMonth", "INFO", ym + " 集計・送信 来院" + m.visits + " 売上" + m.total);
  }
  return text;
}

function krKpiSaveHistory_(m, r30conf) {
  var sh = krEnsureSheet_(KR_KPI_SHEET, KR_KPI_HEADERS);
  var data = sh.getDataRange().getValues();
  var row = [m.month, m.visits, m.people, m.newPatients, m.cancels, m.cancelRate, m.total, m.hoken, m.jihi, m.jiko, m.bussan,
             m.unit, m.utilization, m.bussanRate, m.nextRate, m.lineRate, r30conf.rate, Utilities.formatDate(new Date(), KR_TZ, "yyyy-MM-dd HH:mm")];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === m.month) { sh.getRange(i + 1, 1, 1, row.length).setValues([row]); return; } // 同月は上書き
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

// 毎月1日のトリガーから呼ぶ
function krKpiMonthly() {
  return krWithLock_(function () {
    try { return krKpiForMonth(); }
    catch (e) {
      krLog_("krKpiMonthly", "ERROR", e.message);
      krNotifyOwner_("【倉治整骨院】⚠ 月次の数字の集計に失敗しました", e.message, null, { line: "⚠ 月次の数字の集計に失敗しました。メールをご確認ください。" });
    }
  });
}

// 送らずに画面(ログ)で確認したいとき
function krKpiPreview(ym) { var t = krKpiForMonth(ym, { preview: true }); Logger.log(t); return t; }

function krKpiInstallTrigger() {
  krDeleteTriggers_("krKpiMonthly");
  ScriptApp.newTrigger("krKpiMonthly").timeBased().onMonthDay(1).atHour(8).create();
  return "毎月1日 8時台に月次の数字を送るよう設定しました";
}
function krKpiRemoveTrigger() { return krDeleteTriggers_("krKpiMonthly") + "件のトリガーを削除しました"; }
