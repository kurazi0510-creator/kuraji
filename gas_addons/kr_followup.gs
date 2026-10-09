/**
 * 倉治整骨院 追加機能①：再来院フォロー【半自動】（kr_followup.gs）
 *
 * ■ 仕組み（患者さんへ勝手には送りません）
 *   1) 毎朝10:20、「今日送る候補」をシート kr_followup_queue に並べ、院長へメールでお知らせ
 *   2) 院長が内容を見て、送ってよい行の「送信OK」にチェック（文面はその場で編集もできます）
 *   3) 1時間ごとに、チェックされた行だけを送信。【送信の直前に必ず再確認】し、
 *      次回予約あり・交通事故・送信拒否/除外・期限切れ・再来院済みなどに当たれば送らず、理由を「結果」列に記録
 *   ・チェックの入っていない行は、何があっても送りません。
 *
 * ■ 送るタイミング … 初診の翌日／初診7〜10日後／14日後(再診)／45日後（詳細は KR_FOLLOWUP_STAGES）
 * ■ 安全設計
 *   ・同じ患者・同じ来院日・同じタイミングは、表示も送信も1回だけ（重複チェック用キー）
 *   ・患者シートが空のときは、送信拒否の確認ができないため送信を停止
 *   ・1回30通・月100通までの上限、送信は9〜20時のみ
 *   ・完全自動モードは用意していません。krStopAll() でいつでも緊急停止
 *   ・既存の 休眠促進(90日以上)・初診料アラート とは競合しません。既存の除外設定(休眠促進送信=FALSE)も尊重
 *   ・医療広告ガイドラインに配慮し、効果をうたう表現・割引の訴求は入れていません
 */

// 送るタイミング（最終来院日からの経過日数）
//  1  = 初診の翌日        … 来院1回だけの方。次回予約の有無に関係なく送る（アフターフォロー）
//  7  = 初診から7〜10日後 … 来院1回だけで、次回予約がまだ無い方
//  14 = 14日後           … 再診（来院2回以上）で、次回予約が無い方
//  45 = 45日後           … 全員で、次回予約が無い方
var KR_FOLLOWUP_STAGES = [1, 7, 14, 45];
var KR_FOLLOWUP_WINDOWS = { 1: 1, 7: 3, 14: 2, 45: 2 };  // N日〜N+窓日の間に1回だけ（トリガー失敗の取りこぼし吸収）
function krStageRule_(st) {
  if (st === 1) return { first: true, ignoreFuture: true };
  if (st === 7) return { first: true };
  if (st === 14) return { repeat: true };
  return {};
}
function krStageLabel_(st) { return st === 1 ? "初診の翌日" : (st === 7 ? "初診7日後" : st + "日フォロー"); }
var KR_FOLLOWUP_LOG = "kr_followup_log";
var KR_FOLLOWUP_EXCLUDE = "kr_followup_exclude";
var KR_FOLLOWUP_LOG_HEADERS = ["実行日", "患者名", "診察券No", "前回来院日", "経過日数", "ステージ", "結果", "メモ"];

// ───────── メッセージ文面（院長が KR_MSG_1 / KR_MSG_7 / KR_MSG_14 / KR_MSG_45 で自由に変更可能。{name} が患者名） ─────────
function krFollowupMessage_(stage, name) {
  var custom = krProp_("KR_MSG_" + stage, "");
  var base;
  if (custom) {
    base = custom.replace(/\\n/g, "\n");
  } else if (stage === 1) {
    base = "{name}様、昨日は倉治整骨院へお越しいただき、ありがとうございました。\n\n施術のあと、お身体の調子はいかがでしょうか？\n気になることや、「これは大丈夫かな？」と思うことがあれば、このLINEにそのまま送ってください😊 私が確認してお返事します。\n\nどうぞお大事にお過ごしください。\n倉治整骨院 郡";
  } else if (stage === 7) {
    base = "{name}様、倉治整骨院の郡です。\n\n初めてお越しいただいてから、1週間ほどたちました。その後の調子はいかがでしょうか。\n\nまだ気になるところや、日常で引っかかる動きがあれば、教えてください。状態を伺って、これからどうしていくとよいか、一緒に考えます。\nご希望でしたら、このLINEに「予約希望」と送ってください😊";
  } else if (stage === 14) {
    base = "{name}様、こんにちは。倉治整骨院の郡です。\n\n前回から2週間ほどたちましたが、その後の調子はいかがですか？\n\n前に気になっていたところが続いていたり、新しく気になる動きが出てきたら、このLINEで気軽に教えてください。状況に合わせてお答えします😊";
  } else {
    base = "{name}様、こんにちは。倉治整骨院の郡です。\n\n前回のご来院から少し時間があいていますが、その後お変わりありませんか？\n\n肩や腰など、気になることが出てきたら、我慢せずに声をかけてください。\nご予約をご希望のときは、このLINEに希望日時を送っていただければ確認します😊";
  }
  return base.split("{name}").join(name);
}

// ───────── ①送信対象の判定（純粋関数：シートや通信に触らないのでテストしやすい） ─────────
// 入力: todayStr "yyyy-MM-dd" / bookings(krLoadBookings_の結果) / excluded {ids,keys} / sentSet / unregSet
// 出力: { targets:[], jiko:[], skippedFuture:n, skippedExcluded:n, skippedSent:n }
function krFollowupPlan_(todayStr, bookings, excluded, sentSet, unregSet, stages, windowDays) {
  stages = stages || KR_FOLLOWUP_STAGES;
  excluded = excluded || { ids: {}, keys: {} };
  sentSet = sentSet || {};
  unregSet = unregSet || {};
  var today = krDayNum_(todayStr);
  var cnt = {};       // key -> 今日までの来院回数（日数）
  var seenDay = {};
  var last = {};      // key -> {day, date, name, id, jiko}
  var future = {};    // key -> true（今日より先の有効な予約あり）
  bookings.forEach(function (b) {
    if (!b.key || b.cancelled || b.cont) return;
    if (b.day > today) { future[b.key] = true; return; }
    if (!seenDay[b.key + "|" + b.date]) { seenDay[b.key + "|" + b.date] = true; cnt[b.key] = (cnt[b.key] || 0) + 1; } // 来院回数は「日」で数える
    var isJiko = b.kubunList.indexOf("交通事故") > -1 || b.kubun === "交通事故";
    var cur = last[b.key];
    if (!cur || b.day > cur.day) {
      last[b.key] = { day: b.day, date: b.date, name: b.name, id: b.id || (cur ? cur.id : ""), jiko: isJiko };
    } else if (cur) {
      if (!cur.id && b.id) cur.id = b.id;
      if (b.day === cur.day && isJiko) cur.jiko = true; // 同じ日に交通事故の行があれば交通事故扱い
    }
  });
  var out = { targets: [], jiko: [], skippedFuture: 0, skippedExcluded: 0, skippedSent: 0 };
  Object.keys(last).forEach(function (key) {
    var v = last[key];
    var diff = today - v.day;
    var stage = null, ignoreFuture = false;
    for (var i = 0; i < stages.length; i++) {
      var st = stages[i], rule = krStageRule_(st);
      var w = (typeof windowDays === "number") ? windowDays : (KR_FOLLOWUP_WINDOWS[st] === undefined ? 2 : KR_FOLLOWUP_WINDOWS[st]);
      if (rule.first && cnt[key] !== 1) continue;       // 初診向け：来院1回の方だけ
      if (rule.repeat && !(cnt[key] >= 2)) continue;    // 再診向け：来院2回以上の方だけ
      if (diff >= st && diff <= st + w) { stage = st; ignoreFuture = !!rule.ignoreFuture; break; }
    }
    if (stage === null) return;
    if (future[key] && !ignoreFuture) { out.skippedFuture++; return; }
    if ((v.id && excluded.ids[v.id]) || excluded.keys[key]) { out.skippedExcluded++; return; }
    var dedupKey = key + "|" + v.date + "|" + stage;
    if (sentSet[dedupKey]) { out.skippedSent++; return; }
    var item = { key: key, name: v.name, id: v.id, lastVisit: v.date, diff: diff, stage: stage, dedupKey: dedupKey, alreadyReportedUnreg: !!unregSet[dedupKey] };
    if (v.jiko) out.jiko.push(item); else out.targets.push(item);
  });
  out.targets.sort(function (a, b) { return b.diff - a.diff; });
  return out;
}

// ───────── ②シートから材料を集める ─────────
function krFollowupExcluded_() {
  var ex = { ids: {}, keys: {} };
  var pts = krLoadPatients_();
  pts.rows.forEach(function (p) {
    if (p.optOutFollow || p.optOutDormant) { // 既存の「休眠促進送信=FALSE」も尊重
      if (p.id) ex.ids[p.id] = true;
      if (p.key) ex.keys[p.key] = true;
    }
  });
  var sh = krEnsureSheet_(KR_FOLLOWUP_EXCLUDE, ["診察券No", "患者名", "理由"]);
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    var id = String(d[i][0] || "").trim();
    var nm = String(d[i][1] || "").trim().replace(/[\s　]+/g, "");
    if (id) ex.ids[id] = true;
    if (nm) ex.keys[nm] = true;
  }
  return ex;
}
function krFollowupHistory_() {
  var sh = krEnsureSheet_(KR_FOLLOWUP_LOG, KR_FOLLOWUP_LOG_HEADERS);
  var d = sh.getDataRange().getValues();
  var sent = {}, unreg = {};
  var sentThisMonth = 0;
  var ym = krTodayStr_().slice(0, 7);
  for (var i = 1; i < d.length; i++) {
    var key = String(d[i][1] || "").replace(/[\s　]+/g, "");
    var last = String(d[i][3] || "");
    var stage = String(d[i][5] || "");
    var res = String(d[i][6] || "");
    var dk = key + "|" + last + "|" + stage;
    if (res === "送信済み") {
      sent[dk] = true;
      if (String(d[i][0] || "").slice(0, 7) === ym) sentThisMonth++;
    }
    if (res === "LINE未登録") unreg[dk] = true;
  }
  return { sent: sent, unreg: unreg, sentThisMonth: sentThisMonth, sheet: sh };
}

// ───────── ③ 送信候補キュー（シート kr_followup_queue） ─────────
var KR_FQ_SHEET = "kr_followup_queue";
var KR_FQ_HEADERS = ["候補日", "診察券No", "患者名", "前回来院日", "経過日数", "タイミング", "ステージ", "次回予約", "送信する文面（編集できます）", "送信OK", "結果", "結果日時", "メモ", "重複チェック用キー"];
var KR_FQ = { date: 0, id: 1, name: 2, last: 3, diff: 4, label: 5, stage: 6, next: 7, msg: 8, ok: 9, result: 10, at: 11, memo: 12, key: 13 };

// モード：off（何もしない）／queue（半自動・初期値）。過去の設定値 dryrun/live も安全側の queue として扱う
function krFollowupMode_() { return krProp_("KR_FOLLOWUP_MODE", "queue") === "off" ? "off" : "queue"; }

function krFutureBookingDate_(bookings, key, todayN) {
  var best = "";
  bookings.forEach(function (b) {
    if (b.key === key && !b.cancelled && !b.cont && b.day > todayN && (!best || b.date < best)) best = b.date;
  });
  return best;
}

function krFqNow_() { return Utilities.formatDate(new Date(), KR_TZ, "yyyy-MM-dd HH:mm"); }

function krFqFormatText_(sh, start, n) {
  [1, 2, 4, 12, 14].forEach(function (c) { sh.getRange(start, c, n, 1).setNumberFormat("@"); });
}

// 送信OKが入ったまま送る期限を過ぎた行を閉じる（遅れて送らないため）
function krFollowupExpire_(sh, data, today) {
  var todayN = krDayNum_(today), n = 0;
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (String(r[KR_FQ.result] || "").trim() !== "") continue;
    var st = parseInt(r[KR_FQ.stage], 10);
    var lastN = krDayNum_(krCellDateStr_(r[KR_FQ.last]));
    if (isNaN(st) || isNaN(lastN)) continue;
    var w = KR_FOLLOWUP_WINDOWS[st] === undefined ? 2 : KR_FOLLOWUP_WINDOWS[st];
    if (todayN - lastN > st + w) {
      sh.getRange(i + 1, KR_FQ.result + 1, 1, 2).setValues([["期限切れ（送らず終了）", krFqNow_()]]);
      data[i][KR_FQ.result] = "期限切れ（送らず終了）";
      n++;
    }
  }
  return n;
}

// 毎朝（トリガー）：候補をキューに積む。患者さんには何も送らない
function krFollowupDaily() {
  return krWithLock_(function () { return krFollowupBuildQueue_({}); });
}

function krFollowupBuildQueue_(opts) {
  opts = opts || {};
  if (krFollowupMode_() === "off") { krLog_("krFollowupBuildQueue_", "INFO", "OFFのため何もしません"); return { mode: "off" }; }
  var today = opts.today || krTodayStr_();
  var todayN = krDayNum_(today);
  var bookings = krLoadBookings_();
  if (!bookings.length) { krLog_("krFollowupBuildQueue_", "WARN", "予約表が読めませんでした"); return { error: "no bookings" }; }
  var patients = krLoadPatients_();
  if (!patients.rows.length) {
    krLog_("krFollowupBuildQueue_", "ALERT", "患者シートが空のため候補作成を停止");
    krNotifyOwner_("【倉治整骨院】⚠ 患者シートが空です（再来院フォローを停止しました）",
      "患者シートにデータがありません。送信拒否などの確認ができないため、今日のフォロー候補の作成を止めました。\nファイル→版の履歴から患者シートを確認してください。",
      null, { line: "⚠ 患者シートが空です。再来院フォローを停止しました。メールをご確認ください。" });
    return { error: "no patients" };
  }

  var hist = krFollowupHistory_();
  var sh = krEnsureSheet_(KR_FQ_SHEET, KR_FQ_HEADERS);
  var data = sh.getDataRange().getValues();
  var expired = krFollowupExpire_(sh, data, today);
  var shownSet = {};
  Object.keys(hist.sent).forEach(function (k) { shownSet[k] = true; });
  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][KR_FQ.key] || "");
    if (k) shownSet[k] = true;                     // 一度でも候補に出た組み合わせは二度と出さない
  }

  var plan = krFollowupPlan_(today, bookings, krFollowupExcluded_(), shownSet, hist.unreg);
  var newRows = [], unregList = [], logRows = [], shown = [];
  plan.targets.forEach(function (t) {
    var uid = krFindLineUid_(t.name, t.id);
    if (!uid) {
      if (!t.alreadyReportedUnreg) {
        logRows.push([today, t.name, t.id, t.lastVisit, t.diff, t.stage, "LINE未登録", "電話・来院時のお声がけ対象"]);
        unregList.push(t);
      }
      return;
    }
    var fut = krFutureBookingDate_(bookings, t.key, todayN);
    newRows.push([today, t.id, t.name, t.lastVisit, t.diff, krStageLabel_(t.stage), t.stage,
      fut ? "あり（" + fut + "）" : "なし", krFollowupMessage_(t.stage, t.name), false, "", "", "", t.dedupKey]);
    shown.push(t);
  });

  if (!opts.noWrite) {
    if (newRows.length) {
      var start = sh.getLastRow() + 1, n = newRows.length;
      krFqFormatText_(sh, start, n);
      sh.getRange(start, 1, n, KR_FQ_HEADERS.length).setValues(newRows);
      try { sh.getRange(start, KR_FQ.ok + 1, n, 1).insertCheckboxes(); } catch (e) { krLog_("krFollowupBuildQueue_", "WARN", "チェックボックス設定に失敗: " + e.message); }
    }
    krAppendRows_(hist.sheet, logRows);
  }
  var anything = shown.length || unregList.length || plan.jiko.length;
  if (anything && !opts.noNotify) krFollowupNotifyQueue_(today, shown, unregList, plan, expired);
  return { mode: "queue", queued: shown.length, unreg: unregList.length, jiko: plan.jiko.length, expired: expired, plan: plan, rows: newRows };
}

function krFollowupNotifyQueue_(today, shown, unregList, plan, expired) {
  var label = function (t) { return "・" + t.name + (t.id ? "（" + t.id + "号）" : "") + " 前回" + t.lastVisit.slice(5).replace("-", "/") + "（" + t.diff + "日前／" + krStageLabel_(t.stage) + "）"; };
  var L = ["【再来院フォロー 送信候補】" + today, "まだ誰にも送っていません。送ってよい人を、シート「" + KR_FQ_SHEET + "」の「送信OK」にチェックしてください。", ""];
  L.push("■ 送信候補：" + shown.length + "名");
  shown.forEach(function (t) { L.push(label(t)); });
  if (unregList.length) { L.push(""); L.push("■ LINE未登録の方（送れません。お声がけ候補）：" + unregList.length + "名"); unregList.forEach(function (t) { L.push(label(t)); }); }
  if (plan.jiko.length) { L.push(""); L.push("■ 交通事故の患者さん（自動では扱いません。必要なら個別にご連絡ください）：" + plan.jiko.length + "名"); plan.jiko.forEach(function (t) { L.push(label(t)); }); }
  if (expired) { L.push(""); L.push("■ 送る期限を過ぎて閉じた行：" + expired + "件"); }
  L.push(""); L.push("※ チェック後、1時間以内に送信されます。送信の直前に、次回予約・除外などをもう一度確認します。");
  krNotifyOwner_("【倉治整骨院】再来院フォロー 送信候補 " + today, L.join("\n"), null,
    { line: "[再来院フォロー] 送信候補" + shown.length + "名。" + (krProp_("KR_APPROVE_URL", "") ? "スマホで文面を確認・編集して送れます：\n" + krProp_("KR_APPROVE_URL", "") : "シートで「送信OK」にチェックしてください。") });
}

// ───────── ④ 送信直前の再確認（純粋関数：テスト対象） ─────────
// item: { key(スペースなしの患者名), id, lastVisit, stage }
// 戻り値: { ok:true } または { ok:false, reason:"送信中止：…" }
function krFollowupRecheck_(todayStr, bookings, excluded, sentSet, item) {
  excluded = excluded || { ids: {}, keys: {} };
  sentSet = sentSet || {};
  var dedupKey = item.key + "|" + item.lastVisit + "|" + item.stage;
  if (sentSet[dedupKey]) return { ok: false, reason: "送信中止：すでに送信済み（二重送信防止）" };
  var plan = krFollowupPlan_(todayStr, bookings, excluded, sentSet, {});
  if (plan.targets.some(function (t) { return t.dedupKey === dedupKey; })) return { ok: true };
  if (plan.jiko.some(function (t) { return t.dedupKey === dedupKey; })) return { ok: false, reason: "送信中止：交通事故の患者さん" };
  if ((item.id && excluded.ids[item.id]) || excluded.keys[item.key]) return { ok: false, reason: "送信中止：送信拒否・除外対象" };
  var today = krDayNum_(todayStr), rule = krStageRule_(item.stage);
  var future = false, lastDay = -Infinity, lastDate = "", days = {}, jiko = false;
  bookings.forEach(function (b) {
    if (b.key !== item.key || b.cancelled || b.cont) return;
    if (b.day > today) { future = true; return; }
    days[b.date] = true;
    if (b.day > lastDay) { lastDay = b.day; lastDate = b.date; }
  });
  var cnt = Object.keys(days).length;
  bookings.forEach(function (b) {
    if (b.key === item.key && !b.cancelled && !b.cont && b.date === lastDate && (b.kubunList.indexOf("交通事故") > -1 || b.kubun === "交通事故")) jiko = true;
  });
  if (future && !rule.ignoreFuture) return { ok: false, reason: "送信中止：次回予約あり" };
  if (jiko) return { ok: false, reason: "送信中止：交通事故の患者さん" };
  if (lastDate !== item.lastVisit) return { ok: false, reason: "送信中止：前回来院日が変わりました（再来院済み）" };
  if (rule.first && cnt !== 1) return { ok: false, reason: "送信中止：初診の方ではなくなりました" };
  if (rule.repeat && cnt < 2) return { ok: false, reason: "送信中止：再診の方ではありません" };
  var w = KR_FOLLOWUP_WINDOWS[item.stage] === undefined ? 2 : KR_FOLLOWUP_WINDOWS[item.stage];
  if (today - lastDay > item.stage + w) return { ok: false, reason: "送信中止：送る期限を過ぎました" };
  return { ok: false, reason: "送信中止：対象条件に合わなくなりました" };
}

// ───────── ⑤ チェック済みの行だけを送信（1時間ごとのトリガー） ─────────
function krFollowupSendApproved() {
  return krWithLock_(function () { return krFollowupSendRun_({}); });
}

function krFollowupSendRun_(opts) {
  opts = opts || {};
  if (krFollowupMode_() === "off") return { mode: "off" };
  var today = opts.today || krTodayStr_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(KR_FQ_SHEET);
  if (!sh) return { sent: 0 };
  var data = sh.getDataRange().getValues();
  var pending = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var ok = r[KR_FQ.ok] === true || String(r[KR_FQ.ok]).toUpperCase() === "TRUE";
    if (ok && String(r[KR_FQ.result] || "").trim() === "") pending.push(i);
  }
  if (!pending.length) return { sent: 0 };
  if (!opts.manual) {
    var hour = krJstHour_();
    if (hour < 9 || hour >= 20) return { skipped: "time" };
  }
  if (!PropertiesService.getScriptProperties().getProperty("LINE_TOKEN")) {
    krNotifyOwner_("【倉治整骨院】再来院フォロー：LINE_TOKENが未設定のため送信できません", "スクリプトプロパティ LINE_TOKEN を確認してください。", null, {});
    return { error: "no token" };
  }
  var patients = krLoadPatients_();
  if (!patients.rows.length) {
    krLog_("krFollowupSendRun_", "ALERT", "患者シートが空のため送信を停止");
    krNotifyOwner_("【倉治整骨院】⚠ 患者シートが空のため、フォロー送信を停止しました",
      "送信拒否の確認ができないため、チェック済みの行も送っていません。患者シートを確認してください。", null,
      { line: "⚠ 患者シートが空のため、再来院フォローの送信を停止しました。" });
    return { error: "no patients" };
  }
  var bookings = krLoadBookings_();
  if (!bookings.length) { krLog_("krFollowupSendRun_", "WARN", "予約表が読めないため送信を停止"); return { error: "no bookings" }; }
  var excluded = krFollowupExcluded_();
  var hist = krFollowupHistory_();
  var sentSet = {};
  Object.keys(hist.sent).forEach(function (k) { sentSet[k] = true; });
  var monthlyCap = parseInt(krProp_("KR_FOLLOWUP_MONTHLY_CAP", "100"), 10) || 100;
  var perRun = parseInt(krProp_("KR_FOLLOWUP_MAX_PER_RUN", "30"), 10) || 30;
  var allow = Math.min(perRun, Math.max(0, monthlyCap - hist.sentThisMonth));

  var sent = [], aborted = [], failed = [], held = [], logRows = [], sendCount = 0;
  pending.forEach(function (i) {
    var r = data[i];
    var name = String(r[KR_FQ.name] || "").trim();
    var id = String(r[KR_FQ.id] || "").trim();
    var stage = parseInt(r[KR_FQ.stage], 10);
    var lastVisit = krCellDateStr_(r[KR_FQ.last]);
    var msg = String(r[KR_FQ.msg] || "").trim();
    var setResult = function (text) { sh.getRange(i + 1, KR_FQ.result + 1, 1, 2).setValues([[text, krFqNow_()]]); };
    var item = { key: name.replace(/[\s　]+/g, ""), id: id, lastVisit: lastVisit, stage: stage };
    var chk = krFollowupRecheck_(today, bookings, excluded, sentSet, item);
    if (!chk.ok) { setResult(chk.reason); aborted.push({ name: name, reason: chk.reason }); return; }
    if (!msg) { setResult("送信中止：文面が空です"); aborted.push({ name: name, reason: "文面が空です" }); return; }
    if (sendCount >= allow) { held.push(name); return; }   // 上限：結果を入れず、次回に持ち越し
    var uid = krFindLineUid_(name, id);
    if (!uid) { setResult("送信中止：LINE未登録"); aborted.push({ name: name, reason: "LINE未登録" }); return; }
    var res = krSendLine_(uid, msg);
    sendCount++;
    if (res && res.ok) {
      setResult("送信済み");
      sentSet[item.key + "|" + lastVisit + "|" + stage] = true;
      logRows.push([today, name, id, lastVisit, r[KR_FQ.diff], stage, "送信済み", "半自動"]);
      sent.push(name);
    } else {
      setResult("送信失敗：" + String((res && res.error) || "").slice(0, 80) + "（再試行は結果欄を空にしてください）");
      failed.push(name);
    }
  });
  krAppendRows_(hist.sheet, logRows);

  if (sent.length || aborted.length || failed.length || held.length) {
    var L = ["【再来院フォロー 送信報告】" + today, ""];
    L.push("■ 送信しました：" + sent.length + "名"); sent.forEach(function (n) { L.push("・" + n); });
    if (aborted.length) { L.push(""); L.push("■ 送信直前の確認で見送り：" + aborted.length + "名"); aborted.forEach(function (a) { L.push("・" + a.name + " … " + a.reason); }); }
    if (failed.length) { L.push(""); L.push("■ 送信に失敗：" + failed.length + "名"); failed.forEach(function (n) { L.push("・" + n); }); }
    if (held.length) { L.push(""); L.push("■ 送信数の上限のため次回に持ち越し：" + held.length + "名"); held.forEach(function (n) { L.push("・" + n); }); }
    krNotifyOwner_("【倉治整骨院】再来院フォロー 送信報告 " + today, L.join("\n"), null,
      { line: "[再来院フォロー] 送信" + sent.length + "名" + (aborted.length ? " / 見送り" + aborted.length + "名" : "") + (failed.length ? " / 失敗" + failed.length + "名" : "") });
  }
  krLog_("krFollowupSendRun_", "INFO", "送信" + sent.length + " 見送り" + aborted.length + " 失敗" + failed.length + " 持越" + held.length);
  return { sent: sent.length, aborted: aborted.length, failed: failed.length, held: held.length };
}

// ───────── ⑥ 手動で使う関数（Apps Scriptの実行ボタンから） ─────────

// 今日（または指定日）の候補を確認する。シートにも書かず、通知もしません。
function krFollowupPreview(dateStr) {
  var r = krFollowupBuildQueue_({ today: dateStr || krTodayStr_(), noWrite: true, noNotify: true });
  var plan = r.plan || { targets: [], jiko: [] };
  var lines = ["対象日: " + (dateStr || krTodayStr_()), "候補: " + plan.targets.length + "名 / 交通事故(対象外): " + plan.jiko.length + "名"];
  plan.targets.forEach(function (t) { lines.push("  " + t.name + "（" + t.id + "号）" + t.diff + "日 → " + krStageLabel_(t.stage)); });
  Logger.log(lines.join("\n"));
  return lines.join("\n");
}

// 今すぐ候補を作る（朝のトリガーを待たずに試すとき）。患者さんには送りません。
function krFollowupBuildNow() { return krWithLock_(function () { return JSON.stringify(krFollowupBuildQueue_({}).queued); }); }

function krFollowupSetMode(mode) {
  if (mode === "live" || mode === "dryrun") throw new Error("完全自動は用意していません。半自動は 'queue'、停止は 'off' を指定してください。");
  if (["off", "queue"].indexOf(mode) < 0) throw new Error("mode は 'queue'(半自動) / 'off'(停止) のどちらかです");
  krSetProp_("KR_FOLLOWUP_MODE", mode);
  krLog_("krFollowupSetMode", "INFO", "モードを " + mode + " に変更");
  return "再来院フォロー: " + mode;
}

function krFollowupInstallTrigger() {
  krDeleteTriggers_("krFollowupDaily");
  krDeleteTriggers_("krFollowupSendApproved");
  ScriptApp.newTrigger("krFollowupDaily").timeBased().everyDays(1).atHour(10).nearMinute(20).create();
  ScriptApp.newTrigger("krFollowupSendApproved").timeBased().everyHours(1).create();
  krSetProp_("KR_FOLLOWUP_MODE", krFollowupMode_());
  return "再来院フォロー(半自動)のトリガーを設定しました（毎朝10:20に候補作成／1時間ごとにチェック済みを送信・現在のモード: " + krFollowupMode_() + "）";
}
function krFollowupRemoveTrigger() { return (krDeleteTriggers_("krFollowupDaily") + krDeleteTriggers_("krFollowupSendApproved")) + "件のトリガーを削除しました"; }

// 文面の確認用：院長本人のLINEにだけ、全パターンの文面を送る（患者さんには送りません）
function krFollowupTestToOwner() {
  var owner = PropertiesService.getScriptProperties().getProperty("LINE_USER_ID");
  if (!owner) return "LINE_USER_IDが未設定です";
  var ok = 0;
  KR_FOLLOWUP_STAGES.forEach(function (s) {
    var r = krSendLine_(owner, "【文面確認・" + krStageLabel_(s) + "】\n\n" + krFollowupMessage_(s, "テスト太郎"));
    if (r && r.ok) ok++;
  });
  return ok + "/" + KR_FOLLOWUP_STAGES.length + "通を院長のLINEへ送信しました";
}
