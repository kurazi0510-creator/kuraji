// ====================================================
// 倉治整骨院 管理システム GAS 完全版
// 修正内容: B列（時間）をテキスト形式で強制保存
// ====================================================

function doGet(e) {
  var action=(e&&e.parameter&&e.parameter.action)||'getAll';
  var callback=(e&&e.parameter&&e.parameter.callback)||'';
  var result;
  try{if(action==='getAll'){result=getAllData();}else{result={ok:true,msg:'ok'};}}
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
    else if(action==='saveBookings'){saveSheet('予約表',JSON.parse(body.rows));result={ok:true};}
    else if(action==='saveCustomers'){saveSheet('患者',JSON.parse(body.rows));result={ok:true};}
    else if(action==='saveUriage'){saveSheet('売上',JSON.parse(body.rows));result={ok:true};}
    else if(action==='resetBookings'){resetBookings();result={ok:true};}
    else{result={ok:false,error:'unknown action'};}
  }catch(err){result={ok:false,error:err.message};}
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function getAllData(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var b=ss.getSheetByName('予約表');
  var c=ss.getSheetByName('患者');
  var u=ss.getSheetByName('売上');
  return{
    ok:true,
    bookings:b?b.getDataRange().getValues():[[]],
    customers:c?c.getDataRange().getValues():[[]],
    uriage:u?u.getDataRange().getValues():[[]]
  };
}

// ★修正版: B列（時間）をテキスト形式で強制保存
function saveSheet(name,rows){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName(name);
  if(!s)s=ss.insertSheet(name);
  s.clearContents();
  if(!rows||rows.length===0)return;
  
  // 全セルを文字列に変換
  var san=rows.map(function(row){
    return row.map(function(cell){
      if(cell===null||cell===undefined)return'';
      if(cell instanceof Date){
        var y=cell.getFullYear(),mo=String(cell.getMonth()+1).padStart(2,'0'),d=String(cell.getDate()).padStart(2,'0');
        return y+'-'+mo+'-'+d;
      }
      return String(cell);
    });
  });
  
  var range=s.getRange(1,1,san.length,san[0].length);
  
  // ★全列をテキスト形式に設定してから書き込む（時刻自動変換を防ぐ）
  var formats=[];
  for(var i=0;i<san.length;i++){
    var rowFmt=[];
    for(var j=0;j<san[0].length;j++){rowFmt.push('@');}// '@' = テキスト形式
    formats.push(rowFmt);
  }
  range.setNumberFormats(formats);
  range.setValues(san);
}

// 予約表シートをヘッダーのみにリセット
function resetBookings(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName('予約表');
  if(!s)s=ss.insertSheet('予約表');
  s.clearContents();
  var hdr=[['日付','時間','区分','患者名','診察券No','予約ルート','来院回数','経過日数',
    '症状','オプション','自費メニュー','処置(JSON)','処置メモ','物販(JSON)',
    '支払方法','支払金額','区分リスト','再予約情報','キャンセル理由','施術部位']];
  s.getRange(1,1,1,hdr[0].length).setValues(hdr);
}
