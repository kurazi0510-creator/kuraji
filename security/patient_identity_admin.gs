// Owner-only repair requested for this named patient. Preserve all records and backup first.
function repairTomitaCard2085(){
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
    if(!changed)return {ok:true,changed:0};
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
    return {ok:true,changed:matches.length+plans.length};
  }catch(e){return {ok:false,error:e.message};}finally{lock.releaseLock();}
}
