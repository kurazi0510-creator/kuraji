// Owner-only repair requested for this named patient. Preserve all records and backup first.
function repairTomitaCard2085(){
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('TOMITA_2085_REPAIR_DONE')==='v1')return {ok:true,changed:0};
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var ss=adminSpreadsheet_(),ps=ss.getSheetByName('患者');
    if(!ps)return {ok:false,error:'患者シートがありません'};
    var normal=function(v){return String(v||'').replace(/[\s　]/g,'');};
    var target='冨田茉香那',keep='2085',rows=ps.getDataRange().getValues(),matches=[],canonical=-1,oldIds={};
    for(var i=1;i<rows.length;i++){
      if(String(rows[i][0]).trim()===keep&&normal(rows[i][1])!==target)return {ok:false,error:'2085が別の患者様に登録されています。変更していません。'};
      if(normal(rows[i][1])===target){matches.push(i);if(String(rows[i][0]).trim()===keep)canonical=i;else if(String(rows[i][0]).trim())oldIds[String(rows[i][0]).trim()]=true;}
    }
    if(!matches.length)return {ok:true,changed:0};
    if(canonical<0)canonical=matches[0];
    var plans=[];
    ss.getSheets().forEach(function(sheet){
      if(sheet.getName()==='患者'||/backup|バックアップ/i.test(sheet.getName()))return;
      var data=sheet.getDataRange().getValues();if(data.length<2)return;
      var headers=data[0].map(normal),nc=headers.indexOf('患者名');if(nc<0)nc=headers.indexOf('氏名');if(nc<0)nc=headers.indexOf('patientName');
      var ic=headers.indexOf('診察券No');if(ic<0)ic=headers.indexOf('診察券番号');if(ic<0)ic=headers.indexOf('診察券NO');if(ic<0)ic=headers.indexOf('cardId');
      if(nc<0||ic<0)return;
      for(var j=1;j<data.length;j++)if(normal(data[j][nc])===target&&String(data[j][ic]).trim()!==keep)plans.push({sheet:sheet,row:j+1,col:ic+1,before:data[j]});
    });
    var changed=matches.some(function(i){return String(rows[i][0]).trim()!==keep;})||matches.length>1||plans.length;
    if(!changed){props.setProperty('TOMITA_2085_REPAIR_DONE','v1');return {ok:true,changed:0};}
    var backup=ss.getSheetByName('patient_identity_backup')||ss.insertSheet('patient_identity_backup');
    if(!backup.getLastRow())backup.appendRow(['日時','シート','元の行番号','元データ(JSON)']);
    matches.forEach(function(i){backup.appendRow([new Date(),'患者',i+1,JSON.stringify(rows[i])]);});
    plans.forEach(function(p){backup.appendRow([new Date(),p.sheet.getName(),p.row,JSON.stringify(p.before)]);});
    var merged=rows[canonical].slice();merged[0]=keep;
    matches.forEach(function(i){for(var c=1;c<merged.length;c++)if((merged[c]===''||merged[c]==null)&&rows[i][c]!==''&&rows[i][c]!=null)merged[c]=rows[i][c];});
    // Migrate history before removing duplicate patient rows; repeat runs remain safe.
    plans.forEach(function(p){p.sheet.getRange(p.row,p.col).setValue(keep);});
    ps.getRange(canonical+1,1,1,merged.length).setValues([merged]);
    matches.slice().sort(function(a,b){return b-a;}).forEach(function(i){if(i!==canonical)ps.deleteRow(i+1);});
    Object.keys(oldIds).forEach(function(id){if(!rows.some(function(r,i){return i>0&&normal(r[1])!==target&&String(r[0]).trim()===id;}))addPatientTombstone_(id);});
    props.setProperty('TOMITA_2085_REPAIR_DONE','v1');
    return {ok:true,changed:matches.length+plans.length};
  }catch(e){return {ok:false,error:e.message};}finally{lock.releaseLock();}
}

// 院長が2088番まで登録済みと確認。過去の誤登録2089・2090を初回だけ整理。
function reconcilePatientNumber2088_(){
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('PATIENT_NUMBER_RECONCILE_2088_V1')==='done')return;
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    if(props.getProperty('PATIENT_NUMBER_RECONCILE_2088_V1')==='done')return;
    addPatientTombstone_('2089');addPatientTombstone_('2090');
    props.setProperty('PATIENT_NUMBER_RECONCILE_2088_V1','done');
  }finally{lock.releaseLock();}
}
function cleanupDeletedCards2500And3000_(){
  reconcilePatientNumber2088_();
  var props=PropertiesService.getScriptProperties();
  var targets=getPatientTombstones_();targets['2500']=true;targets['3000']=true;
  var signature=Object.keys(targets).sort().join(',');
  var cached=props.getProperty('DELETED_CARD_CLEANUP_V2');
  if(cached){var previous=JSON.parse(cached);if(previous.signature===signature)return previous.report;}
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    addPatientTombstone_('2500');addPatientTombstone_('3000');
    var report=purgeDeletedCardRows_(adminSpreadsheet_(),targets);
    SpreadsheetApp.flush();props.setProperty('DELETED_CARD_CLEANUP_V2',JSON.stringify({signature:signature,report:report}));
    return report;
  }finally{lock.releaseLock();}
}
function registerNewPatient_(patient){
  if(!patient||!/^\d+$/.test(String(patient.id||''))||!String(patient.name||'').trim())return {ok:false,error:'診察券番号と患者名が必要です'};
  var id=String(patient.id).trim();if(['2500','3000','10000'].indexOf(id)>=0)return {ok:false,error:'この番号は新規採番に使用できません'};
  reconcilePatientNumber2088_();
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var ss=adminSpreadsheet_(),sheet=ss.getSheetByName('患者');if(!sheet)throw new Error('患者シートがありません');
    var rows=sheet.getDataRange().getValues(),deleted=getPatientTombstones_();
    if(rows.slice(1).some(function(r){return String(r[0]).trim()===id&&!deleted[id];}))throw new Error('この診察券番号はすでに登録されています。最新データを取得してください');
    if(deleted[id]){var targets={};targets[id]=true;purgeDeletedCardRows_(ss,targets);rows=sheet.getDataRange().getValues();}
    var header=rows[0].slice(),generation=Utilities.getUuid();
    if(header.indexOf('患者世代ID')<0){header.push('患者世代ID');sheet.getRange(1,1,1,header.length).setValues([header]);}
    var values={'診察券No':id,'診察券番号':id,'患者名':patient.name,'ふりがな':patient.kana||'','性別':patient.sex||'','電話番号':patient.tel||'','電話':patient.tel||'','LINE':patient.line||'','LINEユーザーID':patient.lineUid||'','住所':patient.city||'','職業':patient.job||'','流入元':patient.src||'','症状':patient.symptom||'','前回通院日':'','通院回数':0,'生年月日':patient.dob||'','備考':patient.note||'','アラート送信':'TRUE','誕生日クーポン送信':'TRUE','患者世代ID':generation};
    var newRow=header.map(function(h){return Object.prototype.hasOwnProperty.call(values,String(h).trim())?values[String(h).trim()]:'';});newRow[0]=id;newRow[1]=patient.name;
    sheet.getRange(sheet.getLastRow()+1,1,1,newRow.length).setNumberFormat('@').setValues([newRow]);
    PropertiesService.getScriptProperties().setProperty('PATIENT_GENERATION_'+id,generation);
    var deletedIds=Object.keys(deleted).filter(function(v){return v!==id;});PropertiesService.getScriptProperties().setProperty('DELETED_PATIENT_IDS',JSON.stringify(deletedIds));
    return {ok:true,generation:generation,deletedPatientIds:deletedIds};
  }catch(e){return {ok:false,error:e.message};}finally{lock.releaseLock();}
}
