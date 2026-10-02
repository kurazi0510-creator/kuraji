// Shared reader. Links are written by the owner or the signed LINE registration webhook.
function verifiedBookingLookupLink_(tel){
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getSheetByName('予約確認連携');
  if(sheet){
    var rows=sheet.getDataRange().getValues();
    for(var i=rows.length-1;i>=1;i--){
      if(String(rows[i][0])!==tel)continue;
      if(String(rows[i][4])!=='有効'||!/^U[0-9a-f]{32}$/i.test(String(rows[i][1])))return null;
      return {uid:String(rows[i][1]),cardId:String(rows[i][2]),name:String(rows[i][3])};
    }
  }
  // Legacy explicitly verified links remain compatible; never use self-declared LINE_IDs.
  var raw=PropertiesService.getScriptProperties().getProperty('BOOKING_LOOKUP_VERIFIED_LINKS');
  try{
    var links=JSON.parse(raw||'{}'),uid=links&&Object.prototype.hasOwnProperty.call(links,tel)?links[tel]:'';
    return typeof uid==='string'&&/^U[0-9a-f]{32}$/i.test(uid)?{uid:uid,cardId:'',name:''}:null;
  }catch(err){return null;}
}
function lookupDate_(value){
  if(value instanceof Date)return Utilities.formatDate(value,'Asia/Tokyo','yyyy-MM-dd');
  var match=String(value||'').match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  return match?match[1]+'-'+('0'+match[2]).slice(-2)+'-'+('0'+match[3]).slice(-2):'';
}
function lookupTime_(value){
  if(value instanceof Date)return Utilities.formatDate(value,'Asia/Tokyo','HH:mm');
  var match=String(value||'').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return match&&Number(match[1])<24&&Number(match[2])<60?('0'+match[1]).slice(-2)+':'+match[2]:'';
}
function lookupVerifiedBookings_(tel){
  var link=verifiedBookingLookupLink_(tel);
  if(!link)return {ok:false,error:'院へお問い合わせください'};
  var ss=SpreadsheetApp.getActiveSpreadsheet(),today=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd');
  var list=[],requests=[];
  // Phone ownership alone cannot distinguish family members: require an owner-verified card.
  if(!link.cardId)return {ok:true,list:[],requests:[],needsLink:true};
  var patientSheet=ss.getSheetByName('患者'),patients=patientSheet?patientSheet.getDataRange().getValues():[];
  var matches=patients.slice(1).filter(function(r){return String(r[0]).trim()===link.cardId;});
  if(matches.length!==1||normalizeName_(matches[0][1])!==normalizeName_(link.name)||fixPhoneLeadingZero_(matches[0][4])!==tel)return {ok:false,error:'院へお問い合わせください'};
  var bookings=ss.getSheetByName('予約表');
  if(bookings)bookings.getDataRange().getValues().slice(1).forEach(function(r){
    if(String(r[4]).trim()!==link.cardId||/キャンセル|継続/.test(String(r[2])))return;
    var date=lookupDate_(r[0]),time=lookupTime_(r[1]);
    if(!date||date<today||!time||!String(r[3]).trim())return;
    list.push({date:date,time:time,name:link.name,menu:String(r[10]||''),status:'確定'});
  });
  var requestSheet=ss.getSheetByName('web_yoyaku_requests');
  if(requestSheet)requestSheet.getDataRange().getValues().slice(1).forEach(function(r){
    if(String(r[7]).replace(/\D/g,'')!==tel||normalizeName_(r[6])!==normalizeName_(link.name))return;
    if(r[14]&&String(r[14]).trim()!==link.cardId)return;
    if(String(r[11]||'未対応')!=='未対応')return;
    var candidates=[];
    for(var i=0;i<3;i++){
      var date=lookupDate_(r[i*2]),time=lookupTime_(r[i*2+1]);
      if(date&&date>=today&&time)candidates.push({date:date,time:time,order:i+1});
    }
    if(candidates.length)requests.push({name:link.name,menu:String(r[9]||''),status:'受付済み・未確定',candidates:candidates});
  });
  list.sort(function(a,b){return (a.date+a.time).localeCompare(b.date+b.time);});
  return {ok:true,list:list,requests:requests};
}
