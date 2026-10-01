// Include ONLY in the owner-only project; never expose through the public router.
function bookingLookupAdminRequest(request){
  if(!request||['list','verify','revoke'].indexOf(request.action)<0)throw new Error('操作が違います');
  var ss=adminSpreadsheet_(),sheet=ss.getSheetByName('予約確認連携');
  if(request.action==='list'){
    var links={},rows=sheet?sheet.getDataRange().getValues():[];
    rows.slice(1).forEach(function(r){links[String(r[0])]={tel:String(r[0]),uid:String(r[1]),cardId:String(r[2]),name:String(r[3]),active:String(r[4])==='有効'};});
    return {users:getLineUsers().users||[],links:Object.keys(links).map(function(k){return links[k];})};
  }
  var tel=String(request.tel||'').replace(/\D/g,'');
  if(!/^0\d{9,10}$/.test(tel))throw new Error('電話番号を確認してください');
  var uid='',cardId='',name='';
  if(request.action==='verify'){
    if(request.confirmed!==true)throw new Error('患者さんご本人のLINEか確認してください');
    uid=String(request.uid||'');cardId=String(request.cardId||'').trim();
    if(!/^U[0-9a-f]{32}$/i.test(uid)||!cardId)throw new Error('LINEと診察券番号を選んでください');
    var users=getLineUsers().users||[];
    if(!users.some(function(u){return u.userId===uid;}))throw new Error('LINEの登録が見つかりません');
    var patients=ss.getSheetByName('患者'),matches=patients?patients.getDataRange().getValues().slice(1).filter(function(r){return String(r[0]).trim()===cardId;}):[];
    if(matches.length!==1)throw new Error('患者一覧の診察券番号を確認してください');
    name=String(matches[0][1]||'').trim();
    if(!name)throw new Error('患者名がありません');
    if(fixPhoneLeadingZero_(matches[0][4])!==tel)throw new Error('患者一覧の電話番号と一致しません。先に患者情報を確認してください');
  }
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    sheet=ss.getSheetByName('予約確認連携');
    if(!sheet){sheet=ss.insertSheet('予約確認連携');sheet.appendRow(['tel','uid','cardId','name','status','verifiedAt']);}
    var row=[tel,uid,cardId,name,request.action==='verify'?'有効':'無効',Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss')];
    sheet.getRange(sheet.getLastRow()+1,1,1,6).setNumberFormat('@').setValues([row]);
    return {ok:true};
  }finally{lock.releaseLock();}
}
