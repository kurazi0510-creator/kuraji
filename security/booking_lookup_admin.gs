// Include ONLY in the owner-only project; never expose through the public router.
function bookingLookupAdminRequest(request){
  if(!request||['list','verify','revoke'].indexOf(request.action)<0)throw new Error('操作が違います');
  var ss=adminSpreadsheet_(),sheet=ss.getSheetByName('予約確認連携');
  if(request.action==='list'){
    var links={},rows=sheet?sheet.getDataRange().getValues():[];
    rows.slice(1).forEach(function(r){links[String(r[0])]={tel:String(r[0]),uid:String(r[1]),cardId:String(r[2]),name:String(r[3]),active:String(r[4])==='有効'};});
    var patientsSheet=ss.getSheetByName('患者');
    var patientRows=patientsSheet?patientsSheet.getDataRange().getValues():[],phoneCol=patientRows.length?patientPhoneColumn_(patientRows):-1;
    var candidates=patientsSheet?patientRows.slice(1).map(function(r){return {cardId:String(r[0]).trim(),name:String(r[1]||''),tel:fixPhoneLeadingZero_(r[phoneCol])};}).filter(function(p){return p.cardId&&p.name&&p.tel;}):[];
    return {version:'line-registration-20261001',patients:candidates,users:getLineUsers().users||[],links:Object.keys(links).map(function(k){return links[k];})};
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

  }
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    sheet=ss.getSheetByName('予約確認連携');
    if(!sheet){sheet=ss.insertSheet('予約確認連携');sheet.appendRow(['tel','uid','cardId','name','status','verifiedAt']);}
    if(request.action==='verify'){
      name=ensureLinkPatient_(ss,cardId,tel,request.patient);
      var saved=saveLineUserPhoneManual(uid,tel,name,cardId);
      if(!saved||!saved.ok)throw new Error(saved&&saved.error||'LINE電話番号の保存に失敗しました');
      var previous=sheet.getDataRange().getValues(),latest={};
      previous.slice(1).forEach(function(r){latest[String(r[0])]=r;});
      Object.keys(latest).forEach(function(key){var r=latest[key];if(key!==tel&&String(r[1])===uid&&String(r[4])==='有効')sheet.appendRow([key,'','','','無効',Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss')]);});
    }
    var row=[tel,uid,cardId,name,request.action==='verify'?'有効':'無効',Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss')];
    sheet.getRange(sheet.getLastRow()+1,1,1,6).setNumberFormat('@').setValues([row]);
    return {ok:true};
  }finally{lock.releaseLock();}
}

// Called with the script lock held, after explicit staff identity confirmation.
function ensureLinkPatient_(ss,card,tel,local){
  var sheet=ss.getSheetByName('患者');if(!sheet)throw new Error('患者シートが見つかりません');
  var rows=sheet.getDataRange().getValues(),header=rows[0]||[],phoneCol=patientPhoneColumn_(rows);
  var deleted=getPatientTombstones_()[card];
  var restore2088=deleted&&card==='2088'&&local&&String(local.id).trim()==='2088'&&normalizeName_(local.name)===normalizeName_('木元美穂')&&fixPhoneLeadingZero_(local.tel)===tel;
  var matches=[];for(var i=1;i<rows.length;i++)if(String(rows[i][0]).trim()===card)matches.push(i);
  if(!matches.length){
    if(!local||String(local.id).trim()!==card||!String(local.name||'').trim()||fixPhoneLeadingZero_(local.tel)!==tel)throw new Error('診察券'+card+'はサーバーの患者一覧に未保存です。患者情報の保存状態を確認してください');
    if(deleted&&!restore2088)throw new Error('診察券'+card+'は削除済みとして記録されています。復活させず院長に確認してください');
    var values={'診察券No':card,'患者名':local.name,'ふりがな':local.kana||'','性別':local.sex||'','電話番号':tel,'電話':tel,'phone':tel,'LINE':local.line||'','LINEユーザーID':local.lineUid||'','住所':local.city||'','職業':local.job||'','流入元':local.src||'','症状':local.symptom||'','前回通院日':local.last||'','通院回数':local.count||0,'生年月日':local.dob||'','備考':local.note||'','アラート送信':local.alertSend===false?'FALSE':'TRUE','誕生日クーポン送信':local.birthdaySend===false?'FALSE':'TRUE'};
    var record=header.map(function(h){return values[String(h).trim()]===undefined?'':values[String(h).trim()];});record[0]=card;record[1]=local.name;record[phoneCol]=tel;
    sheet.appendRow(record);rows=sheet.getDataRange().getValues();matches=[rows.length-1];
  }
  var first=rows[matches[0]],name=String(first[1]||'').trim();
  if(!name)throw new Error('診察券'+card+'の患者名が未登録です');
  if(fixPhoneLeadingZero_(first[phoneCol])!==tel)throw new Error('診察券'+card+'の患者一覧の電話番号とLINEの電話番号が一致しません');
  if(local&&normalizeName_(local.name)!==normalizeName_(name))throw new Error('画面とサーバーの患者名が異なります。最新データを確認してください');
  if(matches.length>1){
    var merged=first.slice();
    matches.slice(1).forEach(function(index){var row=rows[index];
      if(normalizeName_(row[1])!==normalizeName_(name)||fixPhoneLeadingZero_(row[phoneCol])!==tel)throw new Error('診察券'+card+'が異なる患者情報で重複しています。自動統合せず院長に確認してください');
      for(var col=2;col<header.length;col++){
        if(col===phoneCol)continue;
        if(merged[col]===''||merged[col]==null)merged[col]=row[col];
        else if(row[col]!==''&&row[col]!=null&&String(merged[col])!==String(row[col]))throw new Error('診察券'+card+'の重複データで「'+header[col]+'」が異なります。自動統合していません');
      }
    });
    var backup=ss.getSheetByName('line_patient_repair_backup')||ss.insertSheet('line_patient_repair_backup');
    if(!backup.getLastRow())backup.appendRow(['日時','診察券No','元の行番号','元データ(JSON)']);
    matches.forEach(function(index){backup.appendRow([new Date(),card,index+1,JSON.stringify(rows[index])]);});
    sheet.getRange(matches[0]+1,1,1,merged.length).setValues([merged]);
    matches.slice(1).sort(function(a,b){return b-a;}).forEach(function(index){sheet.deleteRow(index+1);});
  }
  if(restore2088){
    var props=PropertiesService.getScriptProperties();
    var ids=JSON.parse(props.getProperty('DELETED_PATIENT_IDS')||'[]');
    var audit=ss.getSheetByName('line_patient_restore_log')||ss.insertSheet('line_patient_restore_log');
    if(!audit.getLastRow())audit.appendRow(['日時','診察券No','患者名','処理']);
    audit.appendRow([new Date(),card,name,'院長指定：木元美穂様2088を削除済み扱いから復元']);
    props.setProperty('DELETED_PATIENT_IDS',JSON.stringify(ids.filter(function(id){return String(id)!==card;})));
  }
  return name;
}
