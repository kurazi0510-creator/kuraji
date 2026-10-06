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

function cleanupDeletedCards2500And3000_() {
  var props=PropertiesService.getScriptProperties();
  var cached=props.getProperty('DELETED_CARDS_2500_3000_CLEANUP_V1');
  if(cached)return JSON.parse(cached);
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    var ss=adminSpreadsheet_();
    if(!ss)throw new Error('管理用スプレッドシートが取得できません');
    var targetsById={'2500':true,'3000':true};
    var report={targetIds:['2500','3000'],deleted:{},skipped:[]};
    var norm=function(v){return String(v==null?'':v).normalize('NFKC').replace(/[\s　]/g,'').toLowerCase();};
    var headers=['診察券no','診察券番号','診察券','cardid','患者id','患者番号'];
    var plans=[];
    ss.getSheets().forEach(function(sheet){
      var rows=sheet.getDataRange().getValues();if(rows.length<2)return;
      var columns=[];rows[0].forEach(function(h,c){if(headers.indexOf(norm(h))>=0)columns.push(c);});
      if(!columns.length){report.skipped.push(sheet.getName());return;}
      var targets=[];
      for(var i=1;i<rows.length;i++)if(columns.some(function(c){return targetsById[norm(rows[i][c])]===true;}))targets.push(i+1);
      if(targets.length)plans.push({sheet:sheet,rows:targets});
    });
    // 古い患者データが別端末から再登録されるのを防止。
    addPatientTombstone_('2500');
    addPatientTombstone_('3000');
    plans.forEach(function(p){p.rows.slice().reverse().forEach(function(row){p.sheet.deleteRow(row);});report.deleted[p.sheet.getName()]=p.rows.length;});
    SpreadsheetApp.flush();
    report.deletedTotal=Object.keys(report.deleted).reduce(function(n,key){return n+report.deleted[key];},0);
    props.setProperty('DELETED_CARDS_2500_3000_CLEANUP_V1',JSON.stringify(report));
    console.log('2500・3000番の削除結果: '+JSON.stringify(report));
    return report;
  } finally {lock.releaseLock();}
}
