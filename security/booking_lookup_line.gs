// Called only from the signature-verified public relay webhook. No public action
// accepts a userId, and booking details are never sent into group/room chats.
function bookingLookupTelForUid_(uid){
  if(!/^U[0-9a-f]{32}$/i.test(String(uid)))return '';
  var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('予約確認連携');
  if(!sheet)return '';
  var rows=sheet.getDataRange().getValues(),seen=Object.create(null),found=[];
  for(var i=rows.length-1;i>=1;i--){
    var tel=String(rows[i][0]);
    if(seen[tel])continue;
    seen[tel]=true;
    if(String(rows[i][1])===uid&&String(rows[i][4])==='有効'&&/^0\d{9,10}$/.test(tel)&&String(rows[i][2]).trim())found.push(tel);
  }
  // Ambiguous registrations require owner correction rather than guessing.
  return found.length===1?found[0]:'';
}
function bookingLookupLineText_(result){
  if(!result||!result.ok||result.needsLink)return '予約確認の本人確認登録が必要です。このLINEで「予約確認の登録を希望」とご連絡ください。';
  var lines=['【倉治整骨院】ご予約内容'];
  if(result.list.length){
    lines.push('','■ 確定したご予約');
    result.list.slice(0,12).forEach(function(b){lines.push(b.date+' '+b.time+'〜'+(b.menu?' '+b.menu:''));});
    if(result.list.length>12)lines.push('ほかにもご予約があります。院へお問い合わせください。');
  }
  if(result.requests.length){
    lines.push('','■ 受付済み・未確定のリクエスト','以下は希望日時です。まだ予約は確定していません。');
    result.requests.slice(0,5).forEach(function(b){
      if(b.menu)lines.push(b.menu);
      b.candidates.forEach(function(c){lines.push('第'+c.order+'希望：'+c.date+' '+c.time+'〜');});
    });
    if(result.requests.length>5)lines.push('ほかにもリクエストがあります。院へお問い合わせください。');
  }
  if(!result.list.length&&!result.requests.length)lines.push('','現在、今後のご予約・確認待ちのリクエストは見つかりませんでした。');
  lines.push('','変更・キャンセルやご不明な点は、このLINEでご連絡ください。');
  return lines.join('\n').slice(0,4900);
}
function handleBookingLookupLineEvent_(ev){
  if(!ev||ev.type!=='message'||!ev.message||ev.message.type!=='text'||!(/^(予約確認|予約を確認)$/).test(String(ev.message.text||'').replace(/\s/g,'')))return false;
  if(!ev.source||ev.source.type!=='user')return true;
  var uid=ev.source.userId,tel=bookingLookupTelForUid_(uid);
  var result=tel?lookupVerifiedBookings_(tel):null;
  var token=PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  if(!token||!ev.replyToken)throw new Error('予約確認の返信設定を確認してください');
  var res=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply',{
    method:'post',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    payload:JSON.stringify({replyToken:ev.replyToken,messages:[{type:'text',text:bookingLookupLineText_(result)}]}),muteHttpExceptions:true
  });
  if(res.getResponseCode()!==200)throw new Error('予約確認のLINE返信に失敗しました');
  return true;
}
function sendBookingLookupCode_(token,uid,code){
  try{
    var res=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push',{
      method:'post',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      payload:JSON.stringify({to:uid,messages:[{type:'template',altText:'予約確認コード：'+code+'（5分間有効）',template:{
        type:'buttons',text:'予約確認コード：'+code+'\n5分間有効です。心当たりがなければ無視してください。',
        actions:[{type:'clipboard',label:'コードをコピー',clipboardText:code},{type:'message',label:'LINEで予約を確認',text:'予約確認'}]
      }}]}),muteHttpExceptions:true
    });
    return {ok:res.getResponseCode()===200};
  }catch(err){return {ok:false};}
}
