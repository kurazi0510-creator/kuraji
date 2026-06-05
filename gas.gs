function doGet(e){
  var action=(e&&e.parameter&&e.parameter.action)||'getAll';
  var callback=(e&&e.parameter&&e.parameter.callback)||'';
  var result;
  try{
    if(action==='getAll'){result=getAllData();}
    else if(action==='loadMurao'){result=handleMuraoGet(e);}
    else if(action==='saveMurao'){
      var rawData=e&&e.parameter&&e.parameter.data?e.parameter.data:'';
      result=handleMuraoPost(rawData?JSON.parse(decodeURIComponent(rawData)):{});
    }
    else{result={ok:true,msg:'ok'};}
  }
  catch(err){result={ok:false,error:err.message};}
  var json=JSON.stringify(result);
  if(callback)return ContentService.createTextOutput(callback+'('+json+')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e){
  var body={};try{body=JSON.parse(e.postData.contents);}catch(err){}
  var action=body.action||'',result;
  try{
    if(action==='getAll'){result=getAllData();}
    else if(action==='saveBookings'){saveSheet('yoyakuhyo',JSON.parse(body.rows));result={ok:true};}
    else if(action==='saveCustomers'){saveSheet('kanja',JSON.parse(body.rows));result={ok:true};}
    else if(action==='saveUriage'){saveSheet('uriage',JSON.parse(body.rows));result={ok:true};}
    else if(action==='resetBookings'){resetBookings();result={ok:true};}
    else if(action==='saveMurao'){result=handleMuraoPost(body.data);}
    else{result={ok:false,error:'unknown action'};}
  }catch(err){result={ok:false,error:err.message};}
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function getAllData(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var b=ss.getSheetByName('yoyakuhyo');
  var c=ss.getSheetByName('kanja');
  var u=ss.getSheetByName('uriage');
  return{ok:true,bookings:b?b.getDataRange().getValues():[[]],customers:c?c.getDataRange().getValues():[[]],uriage:u?u.getDataRange().getValues():[[]]};
}
function saveSheet(name,rows){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName(name);
  if(!s)s=ss.insertSheet(name);
  s.clearContents();
  if(!rows||rows.length===0)return;
  var san=rows.map(function(row){return row.map(function(cell){
    if(cell===null||cell===undefined)return'';
    if(cell instanceof Date){var y=cell.getFullYear(),mo=String(cell.getMonth()+1).padStart(2,'0'),d=String(cell.getDate()).padStart(2,'0');return y+'-'+mo+'-'+d;}
    return String(cell);
  });});
  var range=s.getRange(1,1,san.length,san[0].length);
  var fmt=san.map(function(r){return r.map(function(){return'@';});});
  range.setNumberFormats(fmt);
  range.setValues(san);
}
function resetBookings(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName('yoyakuhyo');
  if(!s)s=ss.insertSheet('yoyakuhyo');
  s.clearContents();
  s.getRange(1,1,1,20).setValues([['date','time','kubun','name','cardId','route','visitCount','elapsed','symptom','option','menu','shochi','shochiMemo','bussan','pay','payAmount','kubunList','reBook','cancelReason','bui']]);
}

// ═══════════════════════════════════════
// 村尾さん給与データ 保存・読み込み
// PropertiesService を使ってスクリプトプロパティに保存
// ═══════════════════════════════════════

function handleMuraoGet(e){
  var props = PropertiesService.getScriptProperties();
  var parts = parseInt(props.getProperty('murao_parts')||'0');
  if(parts === 0){
    // 旧形式対応
    var raw = props.getProperty('murao_all');
    if(!raw) return {status:'ok', data:{}};
    return {status:'ok', data: JSON.parse(raw)};
  }
  var combined = '';
  for(var i=0;i<parts;i++) combined += (props.getProperty('murao_all_'+i)||'');
  if(!combined) return {status:'ok', data:{}};
  return {status:'ok', data: JSON.parse(combined)};
}

function handleMuraoPost(payload){
  var props = PropertiesService.getScriptProperties();
  // payloadが文字列の場合そのまま、オブジェクトの場合はJSON化
  var val = (typeof payload === 'string') ? payload : JSON.stringify(payload);
  // PropertiesServiceの値は9KB制限があるため分割保存
  var MAX = 8000;
  if(val.length <= MAX){
    props.setProperty('murao_all_0', val);
    props.setProperty('murao_parts', '1');
  } else {
    var parts = Math.ceil(val.length / MAX);
    for(var i=0;i<parts;i++){
      props.setProperty('murao_all_'+i, val.slice(i*MAX, (i+1)*MAX));
    }
    props.setProperty('murao_parts', String(parts));
  }
  return {status:'ok'};
}
