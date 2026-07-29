// ═══════════════════════════════════════════════════════════
// 倉治整骨院 管理システム v5 追加分
//
// ★やることは1つだけです★
// 既存のコードの中から「var action=body.action」という文字を検索(Ctrl+F)して、
// 見つかった行の一番後ろにカーソルを置いてEnterで改行し、
// 下の【ここから】〜【ここまで】の6行をそのまま貼り付けてください。
//
// 【ここから】
//   if(body.events){ return handleLineWebhook(body); }
//   if(action==='saveWebBooking'){ return ContentService.createTextOutput(JSON.stringify(saveWebBooking(body.data))).setMimeType(ContentService.MimeType.JSON); }
//   if(action==='lineNotifyV2'){ return ContentService.createTextOutput(JSON.stringify(sendLinePush(body.token,body.userId,body.message))).setMimeType(ContentService.MimeType.JSON); }
//   if(action==='getMenuMaster'){ return ContentService.createTextOutput(JSON.stringify(getMenuMaster())).setMimeType(ContentService.MimeType.JSON); }
//   if(action==='saveMenuMaster'){ return ContentService.createTextOutput(JSON.stringify(saveMenuMaster(body.rows))).setMimeType(ContentService.MimeType.JSON); }
// 【ここまで】
//
// これ以外は一切さわらなくて大丈夫です。
// この6行より下（この説明文より下）は、まるごとファイルの一番下に貼り付けるだけでOKです。
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// 【設定】チャネルアクセストークンをスクリプトプロパティに保存
// Apps Scriptエディタ左メニュー「プロジェクトの設定」→
// 「スクリプト プロパティ」→ プロパティ「LINE_TOKEN」に
// LINE Developersで発行したトークンを貼り付けてください。
// （kanri.html側に既に保存済みのトークンがあればそれと同じものでOK）
// ─────────────────────────────────────────────
function getLineToken_(){
  var t = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  if(t) return t;
  // 未設定の場合は空文字（呼び出し元でエラーハンドリング）
  return '';
}

// ═══════════════════════════════════════
// ① LINE Webhook受信（患者が公式アカウントに送ったメッセージを処理）
// ═══════════════════════════════════════
function handleLineWebhook(body){
  try{
    var events = body.events || [];
    events.forEach(function(ev){
      if(ev.type==='message' && ev.message && ev.message.type==='text'){
        var uid = ev.source && ev.source.userId;
        var text = (ev.message.text||'').trim();
        var digits = text.replace(/[^0-9]/g,'');
        // 電話番号らしき文字列（10〜11桁）が送られてきたら friend登録として保存
        if(uid && digits.length>=10 && digits.length<=11){
          linkLineFriend_(digits, uid);
          replyLine_(ev.replyToken, '📱 ご登録ありがとうございます！\nこちらの電話番号で前日リマインドをお送りします。\n\n倉治整骨院');
        } else if(uid && ev.type==='message'){
          replyLine_(ev.replyToken, 'いつもありがとうございます😊\n予約のリマインドを受け取るには、ご予約時にご入力いただいた「電話番号」を数字のみでこのトークに送ってください。\n\n例）09012345678');
        }
      }
      if(ev.type==='follow'){
        var uid2 = ev.source && ev.source.userId;
        replyLine_(ev.replyToken, '友だち追加ありがとうございます！🎉\n\nご予約の前日リマインドを受け取るには、ご予約時の「電話番号」を数字のみでこのトークに送信してください。\n\n倉治整骨院');
      }
    });
  }catch(err){ /* LINE側には200を返す必要があるためエラーは握りつぶす */ }
  return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
}

function linkLineFriend_(phoneDigits, userId){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName('line_link');
  if(!s){ s=ss.insertSheet('line_link'); s.getRange(1,1,1,3).setValues([['phone','lineUid','linkedAt']]); }
  var data=s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0]).replace(/[^0-9]/g,'')===phoneDigits){
      s.getRange(i+1,2).setValue(userId);
      s.getRange(i+1,3).setValue(new Date());
      return;
    }
  }
  s.appendRow([phoneDigits, userId, new Date()]);
}

function findLineUidByPhone_(phone){
  var digits=String(phone||'').replace(/[^0-9]/g,'');
  if(!digits) return '';
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName('line_link');
  if(!s) return '';
  var data=s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0]).replace(/[^0-9]/g,'')===digits) return data[i][1];
  }
  return '';
}

// LINE返信（Webhookのreplyトークンを使う。無料枠消費なし）
function replyLine_(replyToken, message){
  if(!replyToken) return;
  var token=getLineToken_();
  if(!token) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply',{
    method:'post',
    headers:{Authorization:'Bearer '+token, 'Content-Type':'application/json'},
    payload: JSON.stringify({replyToken:replyToken, messages:[{type:'text',text:message}]}),
    muteHttpExceptions:true
  });
}

// LINE Push送信（既存のkanri.html「lineNotifyV2」互換。院長宛にも患者宛にも使える汎用版）
function sendLinePush(token, userId, message){
  var useToken = token || getLineToken_();
  if(!useToken || !userId) return {ok:false, error:'token or userId missing'};
  try{
    var res=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push',{
      method:'post',
      headers:{Authorization:'Bearer '+useToken, 'Content-Type':'application/json'},
      payload: JSON.stringify({to:userId, messages:[{type:'text',text:message}]}),
      muteHttpExceptions:true
    });
    var code=res.getResponseCode();
    return {ok: code>=200 && code<300, code:code, body:res.getContentText()};
  }catch(err){ return {ok:false, error:err.message}; }
}

// ═══════════════════════════════════════
// ② Web予約フォームからの予約受付（ダブルブッキング防止つき）
// ═══════════════════════════════════════
function saveWebBooking(data){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName('yoyakuhyo');
    if(!s) return {ok:false, error:'予約表シートが見つかりません'};
    var rows=s.getDataRange().getValues();
    // 同じ日付・同じ時間が既に埋まっていないかチェック（ダブルブッキング防止）
    for(var i=1;i<rows.length;i++){
      if(String(rows[i][0])===String(data.date) && String(rows[i][1])===String(data.time)){
        if(String(rows[i][3]||'').trim()!==''){
          return {ok:false, error:'この時間は既にご予約が入っています。別の時間をお選びください。'};
        }
      }
    }
    // 新規行を追加（既存のシート列構成 [date,time,kubun,name,cardId,route,...] に合わせる）
    var newRow=[
      data.date, data.time, data.kubun||'自費', data.name||'', data.cardId||'',
      'Web予約', data.visitCount||'', '', data.symptom||'', '',
      data.menu||'', '', '', '', '', '', '', '', '', ''
    ];
    s.appendRow(newRow);

    // 電話番号でLINE連携済みなら来店確認メッセージを自動送信
    if(data.tel){
      var uid=findLineUidByPhone_(data.tel);
      if(uid){
        sendLinePush('', uid,
          '✅ ご予約を承りました\n\n📅 '+data.date+' '+data.time+'\nメニュー：'+(data.menu||'ー')+'\n\n前日にリマインドをお送りします。\n倉治整骨院');
      }
    }
    // 院長へも新規Web予約の通知（既存のkj_line_token/kj_line_useridの値を
    // スクリプトプロパティ 'OWNER_LINE_UID' に設定しておくと自動通知されます）
    var ownerUid=PropertiesService.getScriptProperties().getProperty('OWNER_LINE_UID');
    if(ownerUid){
      sendLinePush('', ownerUid, '🆕 Web予約が入りました\n'+data.date+' '+data.time+'\n'+(data.name||'')+' 様\n'+(data.tel||''));
    }
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}

// ═══════════════════════════════════════
// ③ 前日リマインド／お礼メッセージ（時間主導トリガーで自動実行）
// Apps Scriptエディタ左メニュー「トリガー」→「トリガーを追加」で
// 実行する関数：sendTomorrowReminders　毎日18:00頃に設定してください。
// お礼メッセージは sendYesterdayThanks を毎日21:00頃に設定してください。
// ═══════════════════════════════════════
function sendTomorrowReminders(){
  var tz=Session.getScriptTimeZone();
  var tomorrow=Utilities.formatDate(new Date(Date.now()+86400000), tz, 'yyyy-MM-dd');
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName('yoyakuhyo');
  if(!s) return;
  var rows=s.getDataRange().getValues();
  for(var i=1;i<rows.length;i++){
    if(String(rows[i][0])!==tomorrow) continue;
    var name=rows[i][3], time=rows[i][1];
    if(!name) continue;
    // 患者マスタから電話番号を引く必要があるため、kanjaシートも参照
    var tel=findTelByName_(name);
    var uid=tel?findLineUidByPhone_(tel):'';
    if(uid){
      sendLinePush('', uid, '🔔 明日のご予約のリマインドです\n\n📅 明日 '+time+'〜\n倉治整骨院でお待ちしております。\n\nご都合が悪くなった場合はお早めにご連絡ください。');
    }
  }
}
function sendYesterdayThanks(){
  var tz=Session.getScriptTimeZone();
  var yesterday=Utilities.formatDate(new Date(Date.now()-86400000), tz, 'yyyy-MM-dd');
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName('yoyakuhyo');
  if(!s) return;
  var rows=s.getDataRange().getValues();
  for(var i=1;i<rows.length;i++){
    if(String(rows[i][0])!==yesterday) continue;
    var name=rows[i][3];
    if(!name) continue;
    var tel=findTelByName_(name);
    var uid=tel?findLineUidByPhone_(tel):'';
    if(uid){
      sendLinePush('', uid, '昨日はご来院いただきありがとうございました😊\n\nお身体の調子はいかがですか？\n何かございましたらいつでもご連絡ください。\n\n倉治整骨院');
    }
  }
}
function findTelByName_(name){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName('kanja');
  if(!s) return '';
  var rows=s.getDataRange().getValues();
  for(var i=1;i<rows.length;i++){
    if(String(rows[i][1])===String(name)) return rows[i][4]; // [1]=name,[4]=tel想定（既存CSV列順に合わせて要確認）
  }
  return '';
}

// ═══════════════════════════════════════
// ④ 自費メニュー（処置マスター）のGAS同期
// kanri.htmlはブラウザのlocalStorageにしか保存されないため、
// Web予約フォーム（別端末）から見えるようGASにも保存する
// ═══════════════════════════════════════
function saveMenuMaster(rows){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName('menu_master');
    if(!s) s=ss.insertSheet('menu_master');
    s.clearContents();
    s.getRange(1,1,1,3).setValues([['name','price','unit']]);
    if(rows && rows.length){
      s.getRange(2,1,rows.length,3).setValues(rows);
    }
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}
function getMenuMaster(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName('menu_master');
  if(!s) return {ok:true, rows:[]};
  var data=s.getDataRange().getValues();
  return {ok:true, rows:data.slice(1)};
}
