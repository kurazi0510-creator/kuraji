// Only invoked inside the signature-verified, locked LINE webhook.
// Never expose this writer as a public GET/POST action.
function lineRegistrationParsePhone_(text){
  var value=String(text||'').trim().replace(/[０-９]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-65248);});
  value=value.replace(/^(?:電話番号|携帯番号|TEL)\s*[:：]?\s*/i,'').replace(/[-‐－ー―\s()（）]/g,'');
  if(!/^0\d{9,10}$/.test(value))return '';
  // A mobile number missing its final digit must never be used for matching.
  if(/^0[789]0/.test(value)&&value.length!==11)return 'invalid';
  return value;
}
function lineRegistrationAutoLink_(uid,tel,requestedCard){
  if(!/^U[0-9a-f]{32}$/i.test(String(uid))||!/^0\d{9,10}$/.test(String(tel)))return 'review';
  var ss=SpreadsheetApp.getActiveSpreadsheet(),patientSheet=ss.getSheetByName('患者');
  var rows=patientSheet?patientSheet.getDataRange().getValues():[];
  var header=rows[0]||[],cardCol=header.indexOf('診察券No'),nameCol=header.indexOf('患者名'),telCol=header.indexOf('電話番号');
  if(cardCol<0||nameCol<0||telCol<0)return 'review';
  var candidates=rows.slice(1).filter(function(r){return fixPhoneLeadingZero_(r[telCol])===tel;});
  if(requestedCard)candidates=candidates.filter(function(r){return String(r[cardCol]).trim()===requestedCard;});
  if(candidates.length!==1)return candidates.length>1?'family':'unmatched';
  var patient=candidates[0],card=String(patient[cardCol]).trim(),name=String(patient[nameCol]||'').trim();
  if(!card||!name||rows.slice(1).filter(function(r){return String(r[cardCol]).trim()===card;}).length!==1)return 'review';
  var sheet=ss.getSheetByName('予約確認連携'),links=sheet?sheet.getDataRange().getValues():[],latest=Object.create(null);
  links.slice(1).forEach(function(r){latest[String(r[0])]=r;});
  var same=latest[tel];
  // Keep revoked links, conflicting LINE accounts and other existing identities
  // for staff correction. A newly submitted phone must not silently replace them.
  if(same&&(String(same[4])!=='有効'||String(same[1])!==uid||String(same[2]).trim()!==card))return 'review';
  if(Object.keys(latest).some(function(k){var r=latest[k];return k!==tel&&String(r[1])===uid&&String(r[4])==='有効';}))return 'review';
  if(same&&normalizeName_(same[3])!==normalizeName_(name))return 'review';
  var saved=saveLineUserPhoneManual(uid,tel,name,card);
  if(!saved||!saved.ok)throw new Error('LINE登録を保存できませんでした');
  if(!same){
    if(!sheet){sheet=ss.insertSheet('予約確認連携');sheet.appendRow(['tel','uid','cardId','name','status','verifiedAt']);}
    sheet.getRange(sheet.getLastRow()+1,1,1,6).setNumberFormat('@').setValues([[tel,uid,card,name,'有効',Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss')]]);
  }
  SpreadsheetApp.flush();
  return 'linked';
}
function handleLinePhoneRegistrationEvent_(ev){
  if(!ev||ev.type!=='message'||!ev.message||ev.message.type!=='text')return false;
  var tel=lineRegistrationParsePhone_(ev.message.text),cardMatch=String(ev.message.text||'').trim().match(/^診察券(?:番号|No)\s*[:：]?\s*([0-9]+)$/i);
  if(!tel&&!cardMatch)return false;
  if(!ev.source||ev.source.type!=='user')return true;
  var uid=String(ev.source.userId||'');
  if(!/^U[0-9a-f]{32}$/i.test(uid))return true;
  var token=PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  if(!token||!ev.replyToken)throw new Error('電話番号登録の返信設定を確認してください');
  var text;
  if(tel==='invalid')text='携帯電話番号は11桁です。番号をご確認のうえ、もう一度お送りください。';
  else{
    if(cardMatch)tel=findPhoneByUid_(uid);
    if(!tel)text='先にお電話番号をお送りください。';
    else{
      if(!cardMatch){
        var displayName='';
        var profile=UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/'+uid,{headers:{Authorization:'Bearer '+token},muteHttpExceptions:true});
        if(profile.getResponseCode()===200)displayName=JSON.parse(profile.getContentText()).displayName||'';
        saveLinePhone_(uid,tel,displayName);
      }
      var outcome=lineRegistrationAutoLink_(uid,tel,cardMatch?cardMatch[1]:'');
      if(outcome==='linked')text='📱 お電話番号と予約確認の連携が完了しました。\nメニューの「予約確認」から、ご予約日時をご確認いただけます。\n登録内容に誤りがある場合は、このLINEでお知らせください。';
      else if(outcome==='family')text='📱 お電話番号を登録しました。\nご家族などで同じ番号を使用されているため、確認したい方の診察券番号を「診察券番号：123」の形式でお送りください。診察券番号がわからない場合は、お名前をお知らせください。当院で確認します。';
      else text='📱 お電話番号を受け付けました。\n当院で患者情報を確認して、予約確認の連携を行います。すでにお知らせいただいた情報を送り直す必要はありません。';
    }
  }
  var response=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply',{method:'post',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},payload:JSON.stringify({replyToken:ev.replyToken,messages:[{type:'text',text:text}]}),muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('電話番号登録の返信に失敗しました');
  return true;
}
