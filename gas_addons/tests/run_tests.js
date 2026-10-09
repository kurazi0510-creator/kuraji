// 実行: node gas_addons/tests/run_tests.js
// GAS本体の代わりに最小限のモックでkr_*.gsを読み込み、ロジックを検証する
const vm = require("vm"), fs = require("fs"), path = require("path"), assert = require("assert");
const dir = path.join(__dirname, "..");
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log("  OK  " + name); } catch (e) { failed++; console.log("  NG  " + name + "\n      " + e.message); } }

function makeCtx(opts) {
  opts = opts || {};
  const props = Object.assign({}, opts.props || {});
  const sheets = opts.sheets || {}; // name -> 2D array
  const sent = [], mails = [], trashed = [], triggers = [];
  const pad = (n, l) => String(n).padStart(l || 2, "0");
  const ctx = {
    console, Logger: { log() {} }, Date, Math, JSON, parseInt, String, Number, Object, Array, RegExp, isNaN, Error,
    Utilities: { formatDate(d, tz, f) {
      const j = new Date(d.getTime() + 9 * 3600000);
      const m = { yyyy: j.getUTCFullYear(), MM: pad(j.getUTCMonth() + 1), dd: pad(j.getUTCDate()), HH: pad(j.getUTCHours()), mm: pad(j.getUTCMinutes()), ss: pad(j.getUTCSeconds()), H: j.getUTCHours() };
      return f.replace(/yyyy|MM|dd|HH|mm|ss|H/g, k => m[k]);
    } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { sendEmail: m => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
    UrlFetchApp: { fetch: (u, o) => { sent.push(JSON.parse(o.payload)); return { getResponseCode: () => 200 }; } },
    ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: h => { const t = { getHandlerFunction: () => h }; const b = { timeBased: () => b, everyDays: () => b, everyHours: () => b, atHour: () => b, nearMinute: () => b, onWeekDay: () => b, onMonthDay: () => b, create: () => { triggers.push(t); return t; } }; return b; },
      WeekDay: { SUNDAY: 1 } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSpreadsheetTimeZone: () => "Asia/Tokyo", getId: () => "sheetid",
      getSheetByName: n => { if (!sheets[n]) return null; return mkSheet(n); },
      insertSheet: n => { sheets[n] = []; return mkSheet(n); } }) },
    MimeType: { CSV: "text/csv" },
  };
  function mkSheet(n) { return {
    getDataRange: () => ({ getValues: () => sheets[n].map(r => r.slice()), getDisplayValues: () => sheets[n].map(r => r.map(String)) }),
    getLastRow: () => sheets[n].length, setFrozenRows() {}, deleteRows() {},
    getRange: (r, c, nr, nc) => ({ setNumberFormat() {}, setValues: v => { for (let i = 0; i < v.length; i++) { const row = sheets[n][r - 1 + i] || (sheets[n][r - 1 + i] = []); for (let j = 0; j < v[i].length; j++) row[c - 1 + j] = v[i][j]; } } }) }; }
  vm.createContext(ctx);
  ["kr_common.gs", "kr_followup.gs", "kr_backup.gs", "kr_kpi.gs", "kr_setup.gs"].forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f }));
  ctx.__t = { props, sheets, sent, mails, trashed, triggers };
  return ctx;
}
const B = (date, name, o) => Object.assign({ date, name, key: name.replace(/\s/g, ""), id: "", kubun: "保険", kubunList: ["保険"], route: "", pay: 0, bussan: 0, cancelled: false, cont: false }, o || {});
function withDay(arr, c) { return arr.map(b => Object.assign({ day: c.krDayNum_(b.date) }, b)); }

console.log("■ 共通");
const c0 = makeCtx();
test("krDayNum_ 日数差", () => assert.strictEqual(c0.krDayNum_("2026-10-15") - c0.krDayNum_("2026-10-01"), 14));
test("krPrevMonth_ 年またぎ", () => assert.strictEqual(c0.krPrevMonth_("2026-01"), "2025-12"));
test("krCellDateStr_ 文字列/スラッシュ", () => assert.strictEqual(c0.krCellDateStr_("2026/9/3"), "2026-09-03"));
test("krToCsv_ カンマ・引用符・改行", () => assert.strictEqual(c0.krToCsv_([["a,b", 'c"d', "e\nf"]]), '"a,b","c""d","e\nf"'));

console.log("■ 再来院フォロー判定");
const T = "2026-10-15";
const OLD = B("2026-01-01", "A");
const P = (d, arr, ex, sent) => c0.krFollowupPlan_(d, withDay(arr, c0), ex || null, sent || {}, {});
const R = (d, arr) => (P(d, arr).targets[0] || {}).stage;
test("再診(来院2回以上)は14日後に対象。窓は14〜16日", () => {
  const f = d => R(T, [B(d, "A"), OLD]);
  assert.strictEqual(f("2026-10-01"), 14); assert.strictEqual(f("2026-09-29"), 14);
  assert.strictEqual(f("2026-10-02"), undefined); assert.strictEqual(f("2026-09-28"), undefined);
});
test("45日後は全員対象。30日/60日は対象外", () => {
  const f = d => R(T, [B(d, "A"), OLD]);
  assert.strictEqual(f("2026-08-31"), 45); assert.strictEqual(f("2026-09-15"), undefined); assert.strictEqual(f("2026-08-16"), undefined);
});
test("初診(来院1回): 翌日=1, 7〜10日後=7, 14日後は対象外", () => {
  assert.strictEqual(R(T, [B("2026-10-14", "A")]), 1);
  assert.strictEqual(R(T, [B("2026-10-08", "A")]), 7);
  assert.strictEqual(R(T, [B("2026-10-05", "A")]), 7);
  assert.strictEqual(R(T, [B("2026-10-04", "A")]), undefined);
  assert.strictEqual(R(T, [B("2026-10-01", "A")]), undefined);
});
test("再診の人には初診ステージ(翌日・7日)を送らない", () => {
  assert.strictEqual(R(T, [B("2026-10-14", "A"), B("2026-09-01", "A")]), undefined);
  assert.strictEqual(R(T, [B("2026-10-08", "A"), B("2026-09-01", "A")]), undefined);
});
test("翌日フォローは次回予約があっても送る／7日・14日・45日は次回予約があれば送らない", () => {
  assert.strictEqual(R(T, [B("2026-10-14", "A"), B("2026-10-20", "A")]), 1);
  assert.strictEqual(R(T, [B("2026-10-08", "A"), B("2026-10-20", "A")]), undefined);
  assert.strictEqual(R(T, [B("2026-10-01", "A"), OLD, B("2026-10-20", "A")]), undefined);
});
test("キャンセル・継続行は来院扱いしない", () => {
  assert.strictEqual(P(T, [B("2026-09-01", "A"), B("2026-10-01", "A", { cancelled: true }), B("2026-10-01", "A", { cont: true })]).targets.length, 0);
});
test("除外(ID/名前)・送信済み重複は送らない", () => {
  const bk = [B("2026-10-01", "山田 太郎", { id: "5" }), B("2026-01-01", "山田 太郎", { id: "5" })];
  assert.strictEqual(P(T, bk).targets.length, 1);
  assert.strictEqual(P(T, bk, { ids: { "5": true }, keys: {} }).targets.length, 0);
  assert.strictEqual(P(T, bk, { ids: {}, keys: { "山田太郎": true } }).targets.length, 0);
  assert.strictEqual(P(T, bk, null, { "山田太郎|2026-10-01|14": true }).skippedSent, 1);
});
test("交通事故は自動送信せず別枠", () => {
  const p = P(T, [B("2026-10-01", "A", { kubun: "交通事故", kubunList: ["交通事故"] }), OLD]);
  assert.strictEqual(p.targets.length, 0); assert.strictEqual(p.jiko.length, 1);
});
test("名前のスペース違いは同一人物", () => {
  const p = c0.krFollowupPlan_(T, withDay([B("2026-10-01", "山田 太郎"), B("2026-10-20", "山田　太郎")], c0), null, {}, {});
  assert.strictEqual(p.targets.length, 0);
});

console.log("■ 再来院フォロー 半自動（モック）");
function followCtx(extra, today) {
  const hdr = ["日付", "区分", "患者名", "診察券No", "予約ルート", "支払金額", "物販(JSON)", "区分リスト"];
  const row = (d, nm, id, k) => [d, k || "保険", nm, id, "", 0, "", k || "保険"];
  const sheets = { "予約表": [hdr,
      row("2026-10-01", "山田 太郎", "5"), row("2026-06-01", "山田 太郎", "5"),          // 再診・14日前 → 14日ステージ
      row("2026-10-01", "未登録 花子", "6"), row("2026-06-01", "未登録 花子", "6"),        // LINE未登録
      row("2026-10-14", "初診 一郎", "7", "新規"),                                         // 初診の翌日
    ],
    "患者": [["診察券No", "患者名", "流入元", "LINE"], ["5", "山田 太郎", "", ""], ["6", "未登録 花子", "", ""], ["7", "初診 一郎", "", ""]] };
  const c = makeCtx({ props: Object.assign({ KR_FOLLOWUP_MODE: "queue", LINE_TOKEN: "tok", LINE_USER_ID: "owner" }, extra || {}), sheets });
  c.findLineUidForPatient_ = p => ({ "山田 太郎": "Uyamada", "初診 一郎": "Uichiro" })[p.name] || "";
  return c;
}
const TODAY = "2026-10-15";
const qrows = c => c.__t.sheets["kr_followup_queue"].slice(1);
test("候補作成: 患者さんには一切送らず、キューに積みメールで知らせる", () => {
  const c = followCtx();
  const r = c.krFollowupBuildQueue_({ today: TODAY });
  assert.strictEqual(r.queued, 2); assert.strictEqual(r.unreg, 1);
  assert.strictEqual(c.__t.sent.filter(s => s.to !== "owner").length, 0);
  const q = qrows(c);
  assert.deepStrictEqual(q.map(x => x[6]).sort(), [1, 14]);
  assert.ok(q.every(x => x[9] === false && x[10] === "" && x[8].includes("郡")));
  assert.ok(c.__t.mails.length === 1);
});
test("同じ候補は2回目の作成で二重に出ない", () => {
  const c = followCtx();
  c.krFollowupBuildQueue_({ today: TODAY }); c.krFollowupBuildQueue_({ today: TODAY });
  assert.strictEqual(qrows(c).length, 2);
});
test("チェックなしの行は絶対に送らない", () => {
  const c = followCtx();
  c.krFollowupBuildQueue_({ today: TODAY });
  const r = c.krFollowupSendRun_({ today: TODAY, manual: true });
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(c.__t.sent.filter(s => s.to !== "owner").length, 0);
});
test("チェックした行だけ送信され、結果に記録、二重送信しない", () => {
  const c = followCtx();
  c.krFollowupBuildQueue_({ today: TODAY });
  c.__t.sheets["kr_followup_queue"].forEach(r => { if (r[2] === "山田 太郎") r[9] = true; });
  const r1 = c.krFollowupSendRun_({ today: TODAY, manual: true });
  assert.strictEqual(r1.sent, 1);
  const to = c.__t.sent.filter(s => s.to !== "owner");
  assert.strictEqual(to.length, 1); assert.strictEqual(to[0].to, "Uyamada");
  assert.strictEqual(qrows(c).find(x => x[2] === "山田 太郎")[10], "送信済み");
  assert.strictEqual(qrows(c).find(x => x[2] === "初診 一郎")[10], "");   // チェックなしは未送信のまま
  const r2 = c.krFollowupSendRun_({ today: TODAY, manual: true });
  assert.strictEqual(r2.sent, 0); assert.strictEqual(c.__t.sent.filter(s => s.to !== "owner").length, 1);
});
test("送信直前の再確認: チェック後に次回予約が入ると、送らず理由を記録", () => {
  const c = followCtx();
  c.krFollowupBuildQueue_({ today: TODAY });
  c.__t.sheets["kr_followup_queue"].forEach(r => { if (r[2] === "山田 太郎") r[9] = true; });
  c.__t.sheets["予約表"].push(["2026-10-20", "保険", "山田 太郎", "5", "", 0, "", "保険"]);
  const r = c.krFollowupSendRun_({ today: TODAY, manual: true });
  assert.strictEqual(r.sent, 0); assert.strictEqual(r.aborted, 1);
  assert.strictEqual(qrows(c).find(x => x[2] === "山田 太郎")[10], "送信中止：次回予約あり");
  assert.strictEqual(c.__t.sent.filter(s => s.to !== "owner").length, 0);
});
test("送信直前の再確認: 除外・送信拒否・交通事故も送らない", () => {
  const c = followCtx();
  c.krFollowupBuildQueue_({ today: TODAY });
  c.__t.sheets["kr_followup_queue"].forEach(r => { if (r[2]) r[9] = true; });
  c.__t.sheets["患者"][1][4] = "FALSE"; // ダミー列
  c.__t.sheets["患者"][0].push("再来院フォロー送信"); c.__t.sheets["患者"][1][4] = "FALSE"; // 山田さんは送信拒否に
  c.__t.sheets["予約表"].push(["2026-10-14", "交通事故", "初診 一郎", "7", "", 0, "", "交通事故"]);
  c.krFollowupSendRun_({ today: TODAY, manual: true });
  assert.strictEqual(qrows(c).find(x => x[2] === "山田 太郎")[10], "送信中止：送信拒否・除外対象");
  assert.strictEqual(qrows(c).find(x => x[2] === "初診 一郎")[10], "送信中止：交通事故の患者さん");
  assert.strictEqual(c.__t.sent.filter(s => s.to !== "owner").length, 0);
});
test("送る期限を過ぎた行は送らない・候補作成時に閉じる", () => {
  const c = followCtx();
  c.krFollowupBuildQueue_({ today: TODAY });
  c.__t.sheets["kr_followup_queue"].forEach(r => { if (r[2] === "山田 太郎") r[9] = true; });
  c.krFollowupSendRun_({ today: "2026-10-25", manual: true });
  assert.ok(qrows(c).find(x => x[2] === "山田 太郎")[10].startsWith("送信中止"));
  const c2 = followCtx(); c2.krFollowupBuildQueue_({ today: TODAY });
  c2.krFollowupBuildQueue_({ today: "2026-10-25" });
  assert.ok(qrows(c2).every(x => x[10] !== ""));
});
test("患者シートが空なら、候補作成も送信も停止", () => {
  const c = followCtx();
  c.krFollowupBuildQueue_({ today: TODAY });
  c.__t.sheets["kr_followup_queue"].forEach(r => { if (r[2]) r[9] = true; });
  c.__t.sheets["患者"] = [["診察券No", "患者名"]];
  assert.strictEqual(c.krFollowupSendRun_({ today: TODAY, manual: true }).error, "no patients");
  assert.strictEqual(c.__t.sent.filter(s => s.to !== "owner").length, 0);
  const c2 = followCtx(); c2.__t.sheets["患者"] = [["診察券No", "患者名"]];
  assert.strictEqual(c2.krFollowupBuildQueue_({ today: TODAY }).error, "no patients");
});
test("offなら何もしない／live・dryrunには切り替えられない／上限を超えたら持ち越し", () => {
  const c = followCtx({ KR_FOLLOWUP_MODE: "off" });
  assert.strictEqual(c.krFollowupBuildQueue_({ today: TODAY }).mode, "off");
  assert.throws(() => c.krFollowupSetMode("live"));
  const c3 = followCtx({ KR_FOLLOWUP_MODE: "live" });           // 過去の設定値でも半自動として動く
  assert.strictEqual(c3.krFollowupMode_(), "queue");
  const c4 = followCtx({ KR_FOLLOWUP_MAX_PER_RUN: "1" });
  c4.krFollowupBuildQueue_({ today: TODAY });
  c4.__t.sheets["kr_followup_queue"].forEach(r => { if (r[2]) r[9] = true; });
  const r = c4.krFollowupSendRun_({ today: TODAY, manual: true });
  assert.strictEqual(r.sent, 1); assert.strictEqual(r.held, 1);
});
test("文面に患者名が入り、{name}が残らない", () => {
  [1, 7, 14, 45].forEach(s => { const m = c0.krFollowupMessage_(s, "山田太郎"); assert.ok(m.includes("山田太郎") && m.includes("郡") && !m.includes("{name}") && !m.includes("返信不要")); });
});

console.log("■ バックアップ");
test("異常検知: 61→43は異常、60→59は正常", () => {
  assert.ok(c0.krBackupAnomaly_({ 患者: 61 }, { 患者: 43 }).anomaly);
  assert.ok(!c0.krBackupAnomaly_({ 患者: 60 }, { 患者: 59 }).anomaly);
  assert.ok(!c0.krBackupAnomaly_({ 患者: 60 }, { 患者: 70 }).anomaly);
  assert.ok(c0.krBackupAnomaly_({ 患者: 20 }, { 患者: 17 }).anomaly); // 15%減
  assert.ok(c0.krBackupAnomaly_({ 患者: 5 }, {}).anomaly);           // シート消失
});
test("世代整理: 最新8世代を残し、接頭辞が違うファイルは対象外", () => {
  const files = [];
  for (let i = 1; i <= 11; i++) files.push({ id: "f" + i, name: "倉治整骨院_週次バックアップ_2026" + String(i).padStart(2, "0") + "01_0300" });
  files.push({ id: "x", name: "大事な書類.xlsx" }, { id: "y", name: "倉治整骨院_手動コピー" });
  const del = c0.krBackupSelectOld_(files, 8).map(f => f.id).sort();
  assert.deepStrictEqual(del, ["f1", "f2", "f3"]);
});
test("月次CSV整理: 12か月保持、yyyyMM以外は触らない", () => {
  const names = ["202501", "202502", "202503", "202504", "202505", "202506", "202507", "202508", "202509", "202510", "202511", "202512", "202601", "メモ"];
  assert.deepStrictEqual(c0.krBackupSelectOldMonths_(names, 12), ["202501"]);
});
test("異常時は基準値を更新せず・保護フラグON・アラート送信", () => {
  const bk = n => [["h"]].concat(Array.from({ length: n }, (_, i) => [i]));
  const c = makeCtx({ props: { KR_BACKUP_LAST_COUNTS: JSON.stringify({ 患者: 61, 予約表: 10, 売上: 5 }) }, sheets: { 患者: bk(43), 予約表: bk(10), 売上: bk(5) } });
  c.DriveApp = fakeDrive(c);
  const r = c.krBackupWeeklyRun_();
  assert.ok(r.anomaly); assert.strictEqual(c.__t.props.KR_BACKUP_ANOMALY, "1");
  assert.ok(JSON.parse(c.__t.props.KR_BACKUP_LAST_COUNTS).患者 === 61);
  assert.strictEqual(r.pruned, 0); assert.ok(c.__t.mails.length >= 1);
});
function fakeDrive(c) {
  const files = [];
  for (let i = 1; i <= 10; i++) files.push({ id: "old" + i, name: "倉治整骨院_週次バックアップ_2026" + String(i).padStart(2, "0") + "01_0300" });
  const mkFile = f => ({ getId: () => f.id, getName: () => f.name, setTrashed: () => c.__t.trashed.push(f.id) });
  const folder = { getFiles: () => { let i = 0; return { hasNext: () => i < files.length, next: () => mkFile(files[i++]) }; } };
  const orig = c.SpreadsheetApp.openById;
  c.SpreadsheetApp.openById = () => c.SpreadsheetApp.getActiveSpreadsheet();
  return {
    getFoldersByName: () => ({ hasNext: () => true, next: () => folder }),
    createFolder: () => folder,
    getFileById: () => ({ makeCopy: (n) => { const f = { id: "new", name: n }; files.push(f); return mkFile(f); }, getId: () => "x", getName: () => "x", setTrashed() {} })
  };
}
test("正常時は古い世代を整理（最新8世代を残す）", () => {
  const bk = n => [["h"]].concat(Array.from({ length: n }, (_, i) => [i]));
  const c = makeCtx({ props: { KR_BACKUP_LAST_COUNTS: JSON.stringify({ 患者: 61 }) }, sheets: { 患者: bk(62), 予約表: bk(10), 売上: bk(5) } });
  c.DriveApp = fakeDrive(c);
  const r = c.krBackupWeeklyRun_();
  assert.ok(!r.anomaly); assert.strictEqual(r.pruned, 3); // 10 + 新規1 = 11 → 8残して3削除
  assert.strictEqual(JSON.parse(c.__t.props.KR_BACKUP_LAST_COUNTS).患者, 62);
});

console.log("■ 月次の数字");
function kpiData(c) {
  const k = (date, name, o) => B(date, name, Object.assign({ id: name }, o || {}));
  return withDay([
    // 9月
    k("2026-09-02", "新患A", { kubun: "保険", kubunList: ["新規", "保険"], pay: 3480 }),
    k("2026-09-09", "新患A", { pay: 600 }),                       // 30日以内に再来院
    k("2026-09-03", "新患B", { kubunList: ["新規", "自費"], kubun: "自費", pay: 5000, bussan: 1000 }),
    k("2026-09-05", "常連C", { pay: 500 }), k("2026-09-12", "常連C", { pay: 500 }),
    k("2026-09-05", "常連C", { cont: true, kubun: "(継続)", kubunList: ["継続"] }),
    k("2026-09-07", "キャンセルD", { cancelled: true, kubun: "(キャンセル)", kubunList: ["キャンセル"] }),
    k("2026-09-10", "事故E", { kubun: "交通事故", kubunList: ["交通事故"], pay: 0 }),
    k("2026-09-20", "事故E", { kubun: "交通事故", kubunList: ["交通事故"], pay: 7000 }),
    // 8月（前月）
    k("2026-08-04", "常連C", { pay: 500 }),
    k("2026-08-10", "新患F", { kubunList: ["新規", "保険"], pay: 3000 }),
    // 10月（次回予約判定用の未来）
    k("2026-10-05", "新患B", { pay: 0 })
  ], c);
}
test("KPI集計: 来院・新患・キャンセル・売上内訳", () => {
  const c = makeCtx(); const bk = kpiData(c);
  const pat = { byKey: { "新患A": { src: "Google" }, "新患B": { src: "紹介", line: "Uxx" } }, byId: {} };
  const m = c.krKpiCompute_("2026-09", bk, pat, () => 10);
  assert.strictEqual(m.visits, 7);        // 継続・キャンセル除く
  assert.strictEqual(m.newPatients, 2);
  assert.strictEqual(m.cancels, 1);
  assert.strictEqual(m.total, 3480 + 600 + 5000 + 500 + 500 + 7000);
  assert.strictEqual(m.bussan, 1000);
  assert.strictEqual(m.hoken, 3480 + 600 + 500 + 500);
  assert.strictEqual(m.jihi, 4000);
  assert.strictEqual(m.jiko, 7000);
  assert.strictEqual(m.bySrc["Google"], 1); assert.strictEqual(m.bySrc["紹介"], 1);
  assert.strictEqual(m.unit, Math.round(m.total / 6)); // 支払ありの来院6回
});
test("KPI: 次回予約率と稼働率", () => {
  const c = makeCtx(); const bk = kpiData(c);
  const m = c.krKpiCompute_("2026-09", bk, { byKey: {}, byId: {} }, () => 10);
  // 来院7回のうち「その後の予約あり」: A(9/2→9/9)、B(9/3→10/5)、C(9/5→9/12)、E(9/10→9/20) = 4
  assert.strictEqual(m.nextRate, 57.1);
  // 予約枠: 非キャンセル行 = 8件(継続含む) / 予約のあった7日×10枠
  assert.strictEqual(m.utilization, Math.round(8 * 1000 / 70) / 10);
});
test("KPI: 30日以内再来院率", () => {
  const c = makeCtx(); const bk = kpiData(c);
  const r = c.krKpiReturn30_("2026-09", bk);
  assert.strictEqual(r.base, 2); assert.strictEqual(r.back, 1); // A=7日後に再来院、B=32日後なので対象外
});
test("データなし月でもエラーにならない", () => {
  const c = makeCtx();
  const m = c.krKpiCompute_("2026-01", [], { byKey: {}, byId: {} }, null);
  assert.strictEqual(m.visits, 0); assert.strictEqual(m.unit, null);
});
test("レポート文面が生成できる", () => {
  const c = makeCtx(); const bk = kpiData(c);
  const pat = { byKey: {}, byId: {} };
  const m = c.krKpiCompute_("2026-09", bk, pat, () => 10), p = c.krKpiCompute_("2026-08", bk, pat, () => 10);
  const t = c.krKpiBuildReport_(m, p, c.krKpiReturn30_("2026-08", bk), c.krKpiReturn30_("2026-09", bk));
  assert.ok(t.includes("2026-09") && t.includes("売上合計") && t.includes("前月比"));
  assert.ok(c.krKpiHtml_(t).includes("<h3"));
});

console.log("■ セットアップ");
test("krSetupAll は何度実行しても二重トリガーにならない", () => {
  const c = makeCtx({ props: { LINE_USER_ID: "o" }, sheets: {} });
  c.krSetupAll(); c.krSetupAll();
  ["krFollowupDaily", "krFollowupSendApproved", "krBackupWeekly", "krBackupMonthly", "krKpiMonthly"].forEach(h => assert.strictEqual(c.__t.triggers.filter(t => t.getHandlerFunction() === h).length, 1, h));
  assert.strictEqual(c.__t.props.KR_FOLLOWUP_MODE, "queue");
});
test("krStopAll は kr のトリガーだけ消し、他は残す", () => {
  const c = makeCtx({ sheets: {} });
  c.krSetupAll();
  c.__t.triggers.push({ getHandlerFunction: () => "dailyLineAlert" });
  c.krStopAll();
  assert.deepStrictEqual(c.__t.triggers.map(t => t.getHandlerFunction()), ["dailyLineAlert"]);
  assert.strictEqual(c.__t.props.KR_FOLLOWUP_MODE, "off");
});

console.log(`\n${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed ? 1 : 0);
