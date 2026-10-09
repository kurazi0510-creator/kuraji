/**
 * 倉治整骨院 追加機能①：再来院フォロー（kr_followup.gs）
 *
 * 最終来院日から 14日 / 30日 / 60日 経った患者さんへ、LINEで気づかいのメッセージを自動送信します。
 *
 * ■ 既存機能との関係（重複・競合しないように設計）
 *   ・sendDormantPatientOutreach（90日以上の休眠促進）…そのまま。こちらは90日未満だけを担当します。
 *   ・dailyLineAlert（18/21日の初診料アラート）…現在停止中。この機能は触りません。
 *   ・既存の除外設定（患者シート「休眠促進送信」がFALSE）も尊重して送りません。
 *
 * ■ 安全設計
 *   ・初期状態は「試験運転(dryrun)」…送信せず、"誰に送る予定か" だけをメールでお知らせします。
 *   ・live にした日から実際に送信。いつでも krStopAll() で緊急停止できます。
 *   ・すでに先の予約が入っている患者さんには送りません。
 *   ・同じ来院日・同じステージには1回しか送りません（ログシートで重複防止）。
 *   ・交通事故の患者さんには自動送信しません（院長への連絡リストに載せます）。
 *   ・1回の実行・1か月あたりの送信数に上限があります（LINEの通数を使い切らないため）。
 *   ・医療広告ガイドラインに配慮し、効果・改善をうたう表現や割引の訴求は入れていません。
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
    base = "{name}様、昨日は倉治整骨院へお越しいただき、ありがとうございました。\n\nその後、お身体の状態はいかがでしょうか？\n施術後に気になることや、普段の動作で「ここが気になる」という点がありましたら、このLINEへお気軽にご連絡ください😊\n\n無理のない範囲でお過ごしください。\n倉治整骨院 郡";
  } else if (stage === 7) {
    base = "{name}様、倉治整骨院の郡です。\n\n初回のご来院から少し日にちがたちましたので、ご連絡しました。\nその後、お身体の状態はいかがでしょうか？\n\nまだ気になる症状や、日常生活で困る動きがございましたら、一度状態を確認させていただけます。\nご希望でしたら、このLINEに「予約希望」と送ってください😊";
  } else if (stage === 14) {
    base = "{name}様、こんにちは。倉治整骨院の郡です。\n\nその後、お身体の状態はいかがでしょうか？\n前回気になっていた症状が続いていたり、日常生活で気になる動きがございましたら、お気軽にご相談ください😊\n\n無理にご来院いただく必要はありません。どうぞお大事にお過ごしください。";
  } else {
    base = "{name}様、こんにちは。倉治整骨院の郡です。\n\nしばらくお身体の状態を確認できていませんが、その後いかがでしょうか？\n肩・腰などで気になることがございましたら、我慢せずお気軽にご相談ください。\n\nご予約をご希望の場合は、このLINEに希望日時を送っていただければ確認いたします😊";
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
  var cnt = {};       // key -> 今日までの来院回数
  var last = {};      // key -> {day, date, name, id, jiko}
  var future = {};    // key -> true（今日より先の有効な予約あり）
  bookings.forEach(function (b) {
    if (!b.key || b.cancelled || b.cont) return;
    if (b.day > today) { future[b.key] = true; return; }
    cnt[b.key] = (cnt[b.key] || 0) + 1;
    var isJiko = b.kubunList.indexOf("交通事故") > -1 || b.kubun === "交通事故";
    var cur = last[b.key];
    if (!cur || b.day > cur.day) {
      last[b.key] = { day: b.day, date: b.date, name: b.name, id: b.id || (cur ? cur.id : ""), jiko: isJiko };
    } else if (cur && !cur.id && b.id) {
      cur.id = b.id;
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

// ───────── ③本体：トリガーから毎日呼ばれる ─────────
// mode: "off" | "dryrun"(初期値) | "live"
function krFollowupDaily() {
  return krWithLock_(function () { return krFollowupRun_({ manual: false }); });
}

// opts: { manual:true/false, forceMode:"dryrun", today:"yyyy-MM-dd", noLog:true }
function krFollowupRun_(opts) {
  opts = opts || {};
  var mode = opts.forceMode || krProp_("KR_FOLLOWUP_MODE", "dryrun");
  if (mode === "off") { Logger.log("再来院フォロー: OFFのため何もしません"); return { mode: mode }; }
  if (mode === "live" && !opts.manual) {
    var hour = krJstHour_();
    if (hour < 9 || hour >= 20) { krLog_("krFollowupRun_", "INFO", "送信時間外(" + hour + "時)のためスキップ"); return { mode: mode, skipped: "time" }; }
  }
  var today = opts.today || krTodayStr_();
  var bookings = krLoadBookings_();
  if (!bookings.length) { krLog_("krFollowupRun_", "WARN", "予約表が読めませんでした"); return { mode: mode, error: "no bookings" }; }

  var hist = krFollowupHistory_();
  var plan = krFollowupPlan_(today, bookings, krFollowupExcluded_(), hist.sent, hist.unreg);

  var monthlyCap = parseInt(krProp_("KR_FOLLOWUP_MONTHLY_CAP", "100"), 10) || 100;
  var perRunCap = parseInt(krProp_("KR_FOLLOWUP_MAX_PER_RUN", "30"), 10) || 30;
  var remain = Math.max(0, monthlyCap - hist.sentThisMonth);
  var allow = Math.min(perRunCap, remain);

  var rows = [], sentList = [], planList = [], unregList = [], failList = [], overList = [];
  var live = (mode === "live");
  var token = PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
  if (live && !token) {
    krNotifyOwner_("【倉治整骨院】再来院フォロー：LINE_TOKENが未設定のため送信できません", "スクリプトプロパティ LINE_TOKEN を確認してください。", null, {});
    return { mode: mode, error: "no token" };
  }

  var sendCount = 0;
  plan.targets.forEach(function (t) {
    var uid = krFindLineUid_(t.name, t.id);
    if (!uid) {
      if (!t.alreadyReportedUnreg) {
        rows.push([today, t.name, t.id, t.lastVisit, t.diff, t.stage, "LINE未登録", "電話・来院時のお声がけ対象"]);
        unregList.push(t);
      }
      return;
    }
    if (sendCount >= allow) { overList.push(t); return; }
    if (!live) {
      rows.push([today, t.name, t.id, t.lastVisit, t.diff, t.stage, "試験(送信予定)", "送信はしていません"]);
      planList.push(t);
      sendCount++;
      return;
    }
    var r = krSendLine_(uid, krFollowupMessage_(t.stage, t.name));
    if (r && r.ok) {
      rows.push([today, t.name, t.id, t.lastVisit, t.diff, t.stage, "送信済み", ""]);
      sentList.push(t);
    } else {
      rows.push([today, t.name, t.id, t.lastVisit, t.diff, t.stage, "送信失敗", String((r && r.error) || "").slice(0, 120)]);
      failList.push(t);
    }
    sendCount++;
  });

  if (!opts.noLog) krAppendRows_(hist.sheet, rows);

  // 院長へのご報告（対象が何もなければ通知しない）
  var anything = sentList.length || planList.length || unregList.length || failList.length || overList.length || plan.jiko.length;
  if (anything && !opts.noNotify) krFollowupNotify_(mode, today, sentList, planList, unregList, failList, overList, plan, remain, monthlyCap);
  return { mode: mode, sent: sentList.length, planned: planList.length, unreg: unregList.length, failed: failList.length, over: overList.length, jiko: plan.jiko.length, plan: plan };
}

function krFollowupNotify_(mode, today, sentList, planList, unregList, failList, overList, plan, remain, monthlyCap) {
  var live = (mode === "live");
  var label = function (t) { return "・" + t.name + (t.id ? "（" + t.id + "号）" : "") + " 前回" + t.lastVisit.slice(5).replace("-", "/") + "（" + t.diff + "日前／" + krStageLabel_(t.stage) + "）"; };
  var L = [];
  L.push(live ? "【再来院フォロー 送信報告】" + today : "【再来院フォロー 試験運転】" + today + "（まだ送信していません）");
  var main = live ? sentList : planList;
  L.push("");
  L.push((live ? "■ 送信した方：" : "■ 送信予定の方：") + main.length + "名");
  main.forEach(function (t) { L.push(label(t)); });
  if (failList.length) { L.push(""); L.push("■ 送信に失敗した方（明日、再試行します）：" + failList.length + "名"); failList.forEach(function (t) { L.push(label(t)); }); }
  if (unregList.length) { L.push(""); L.push("■ LINE未登録の方（電話や次回来院時のお声がけ候補）：" + unregList.length + "名"); unregList.forEach(function (t) { L.push(label(t)); }); }
  if (plan.jiko.length) { L.push(""); L.push("■ 交通事故の患者さん（自動送信していません。必要なら個別にご連絡ください）：" + plan.jiko.length + "名"); plan.jiko.forEach(function (t) { L.push(label(t)); }); }
  if (overList.length) { L.push(""); L.push("■ 送信数の上限により見送り（今月の残り" + remain + "通／上限" + monthlyCap + "通）：" + overList.length + "名"); overList.forEach(function (t) { L.push(label(t)); }); }
  if (!live) { L.push(""); L.push("※ 内容に問題なければ、Apps Scriptで krFollowupSetMode('live') を実行すると明日から実際に送信します。"); }
  var text = L.join("\n");
  var short = (live ? "[再来院フォロー] 送信" + sentList.length + "名" : "[再来院フォロー試験] 送信予定" + planList.length + "名") + (unregList.length ? " / LINE未登録" + unregList.length + "名" : "") + (plan.jiko.length ? " / 事故" + plan.jiko.length + "名" : "");
  krNotifyOwner_((live ? "【倉治整骨院】再来院フォロー送信報告 " : "【倉治整骨院】再来院フォロー試験運転 ") + today, text, null, { line: short });
}

// ───────── ④手動で使う関数（Apps Scriptの実行ボタンから） ─────────

// 今日（または指定日）に誰が対象になるかを確認する。送信もログ保存もしません。
//   krFollowupPreview()            … 今日
//   krFollowupPreview("2026-10-20") … 指定日として確認
function krFollowupPreview(dateStr) {
  var r = krFollowupRun_({ manual: true, forceMode: "dryrun", today: dateStr || krTodayStr_(), noLog: true, noNotify: true });
  var plan = r.plan || { targets: [], jiko: [] };
  var lines = ["対象日: " + (dateStr || krTodayStr_()), "送信予定: " + plan.targets.length + "名 / 交通事故(自動送信なし): " + plan.jiko.length + "名"];
  plan.targets.forEach(function (t) { lines.push("  " + t.name + "（" + t.id + "号）" + t.diff + "日 → " + krStageLabel_(t.stage)); });
  Logger.log(lines.join("\n"));
  return lines.join("\n");
}

function krFollowupSetMode(mode) {
  if (["off", "dryrun", "live"].indexOf(mode) < 0) throw new Error("mode は 'off' / 'dryrun' / 'live' のどれかです");
  krSetProp_("KR_FOLLOWUP_MODE", mode);
  krLog_("krFollowupSetMode", "INFO", "モードを " + mode + " に変更");
  return "再来院フォロー: " + mode;
}

function krFollowupInstallTrigger() {
  krDeleteTriggers_("krFollowupDaily");
  ScriptApp.newTrigger("krFollowupDaily").timeBased().everyDays(1).atHour(10).nearMinute(20).create();
  if (!PropertiesService.getScriptProperties().getProperty("KR_FOLLOWUP_MODE")) krSetProp_("KR_FOLLOWUP_MODE", "dryrun");
  return "再来院フォローのトリガーを設定しました（毎日10:20頃・現在のモード: " + krProp_("KR_FOLLOWUP_MODE", "dryrun") + "）";
}
function krFollowupRemoveTrigger() { return krDeleteTriggers_("krFollowupDaily") + "件のトリガーを削除しました"; }

// 文面の確認用：院長本人のLINEにだけ、3種類の文面を送る（患者さんには送りません）
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
