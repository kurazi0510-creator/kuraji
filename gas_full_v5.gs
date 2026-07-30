function doGet(e){
  var action=(e&&e.parameter&&e.parameter.action)||"getAll";
  var callback=(e&&e.parameter&&e.parameter.callback)||"";
  var result;
  try{if(action==="getAll"){result=getAllData();}else if(action==="getMenuMaster"){result=getMenuMaster();}else if(action==="lookupBooking"){result=lookupBooking((e&&e.parameter&&e.parameter.tel)||"");}else if(action==="getBizHours"){result=getBizHours();}else{result={ok:true};}}
  catch(err){result={ok:false,error:err.message};}
  var json=JSON.stringify(result);
  if(callback)return ContentService.createTextOutput(callback+"("+json+")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e){
  var ret=ContentService.createTextOutput('{"ok":true}').setMimeType(ContentService.MimeType.JSON);
  try{
    var raw=e&&e.postData&&e.postData.contents?e.postData.contents:"{}";
    var body=JSON.parse(raw);
    if(body.events){
      body.events.forEach(function(ev){
        try{
          if(ev.type==="follow"&&ev.source&&ev.source.userId){
            var tok0=PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
            if(tok0)sendLineMessagingAPI(tok0,ev.source.userId,"友だち追加ありがとうございます😊"+String.fromCharCode(10)+String.fromCharCode(10)+"ご予約のお知らせ・前日リマインドをこちらのLINEでお受け取りいただくために、お電話番号を数字のみで送信してください。"+String.fromCharCode(10)+"例）09012345678"+String.fromCharCode(10)+String.fromCharCode(10)+"（LINEの表示名を本名以外にされている方が多いため、お電話番号での確認をお願いしております）");
          }
          if(ev.type==="message"&&ev.source&&ev.source.userId){
            var uid=ev.source.userId;
            var dname="";
            var tok=PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
            if(tok){
              var r=UrlFetchApp.fetch("https://api.line.me/v2/bot/profile/"+uid,{headers:{"Authorization":"Bearer "+tok},muteHttpExceptions:true});
              if(r.getResponseCode()===200)dname=JSON.parse(r.getContentText()).displayName||"";
            }
            var msgText=(ev.message&&ev.message.text)||"";
            var digits=String(msgText).replace(/[^0-9]/g,"");
            if(digits.length>=10&&digits.length<=11){
              saveLinePhone_(uid,digits,dname);
              if(tok)sendLineMessagingAPI(tok,uid,"📱 お電話番号を登録しました！"+String.fromCharCode(10)+"今後、ご予約確認・前日リマインドをこちらのLINEにお送りします。"+String.fromCharCode(10)+String.fromCharCode(10)+"倉治整骨院");
            }else{
              var already=findPhoneByUid_(uid);
              saveLineUserId(uid,dname,msgText);
              if(tok&&!already)sendLineMessagingAPI(tok,uid,"いつもありがとうございます😊"+String.fromCharCode(10)+"ご予約のお知らせを受け取るには、お電話番号を数字のみで送ってください。"+String.fromCharCode(10)+"例）09012345678");
            }
          }
        }catch(err){Logger.log("event error:"+err);}
      });
    }else{
      var action=body.action||"";
      var result;
      if(action==="getAll")result=getAllData();
      else if(action==="saveBookings"){saveSheet("予約表",JSON.parse(body.rows));result={ok:true};}
      else if(action==="saveCustomers"){saveSheet("患者",JSON.parse(body.rows));result={ok:true};}
      else if(action==="saveUriage"){saveSheet("売上",JSON.parse(body.rows));result={ok:true};}
      else if(action==="resetBookings"){resetBookings();result={ok:true};}
      else if(action==="lineNotifyV2")result=sendLineMessagingAPI(body.token,body.userId,body.message);
      else if(action==="saveLineSettings"){saveLineSettings();result={ok:true};}
      else if(action==="getLineUsers")result=getLineUsers();
      else if(action==="saveWebBooking")result=saveWebBooking(body.data);
      else if(action==="getMenuMaster")result=getMenuMaster();
      else if(action==="saveMenuMaster")result=saveMenuMaster(body.rows);
      else if(action==="getBizHours")result=getBizHours();
      else if(action==="saveBizHoursWeekly")result=saveBizHoursWeekly(body.rows);
      else if(action==="saveBizHoursOverride")result=saveBizHoursOverride(body.rows);
      else result={ok:false,error:"unknown"};
      if(result)ret=ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
  }catch(err){Logger.log("doPost error:"+err);}
  return ret;
}
function saveLineUserId(userId,displayName,message){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("LINE_IDs");
  if(!s){s=ss.insertSheet("LINE_IDs");s.getRange(1,1,1,5).setValues([["userId","name","lastMsg","updated","phone"]]);}
  var data=s.getDataRange().getValues();
  var now=new Date();
  for(var i=1;i<data.length;i++){
    if(data[i][0]===userId){s.getRange(i+1,2,1,3).setValues([[displayName||data[i][1],message,now]]);return;}
  }
  s.appendRow([userId,displayName,message,now,""]);
}
// 電話番号でLINE友だちを紐付け（表示名があだ名でも確実に照合できる）
function saveLinePhone_(userId,phoneDigits,displayName){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("LINE_IDs");
  if(!s){s=ss.insertSheet("LINE_IDs");s.getRange(1,1,1,5).setValues([["userId","name","lastMsg","updated","phone"]]);}
  var data=s.getDataRange().getValues();
  var now=new Date();
  for(var i=1;i<data.length;i++){
    if(data[i][0]===userId){
      s.getRange(i+1,2,1,4).setValues([[displayName||data[i][1],"(電話番号登録)",now,phoneDigits]]);
      return;
    }
  }
  s.appendRow([userId,displayName||"",("(電話番号登録)"),now,phoneDigits]);
}
function findPhoneByUid_(userId){
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LINE_IDs");
  if(!s) return "";
  var data=s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){ if(data[i][0]===userId) return String(data[i][4]||""); }
  return "";
}
// 電話番号からLINEのuserIdを検索（表示名の一致に頼らない、最優先の照合方法）
function findLineUidByPhone_(phone){
  var digits=String(phone||"").replace(/[^0-9]/g,"");
  if(!digits) return "";
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LINE_IDs");
  if(!s) return "";
  var data=s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    var p=String(data[i][4]||"").replace(/[^0-9]/g,"");
    if(p&&p===digits) return String(data[i][0]);
  }
  return "";
}
// 患者名から電話番号を検索（患者シートから）。dailyLineAlert/sendDayBeforeReminders用
function getTelByPatientName_(name){
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("患者");
  if(!s) return "";
  var data=s.getDataRange().getValues();
  var headers=(data[0]||[]).map(function(h){return String(h||"").trim();});
  var ni=headers.indexOf("患者名"), ti=headers.indexOf("電話番号");
  if(ni<0)ni=1; if(ti<0)ti=3;
  var target=String(name||"").trim();
  for(var i=1;i<data.length;i++){
    if(String(data[i][ni]||"").trim()===target) return String(data[i][ti]||"");
  }
  return "";
}
function getLineUsers(){
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LINE_IDs");
  if(!s)return{ok:true,users:[]};
  return{ok:true,users:s.getDataRange().getValues().slice(1).map(function(r){return{userId:r[0],name:String(r[1]),lastMsg:String(r[2])};})};
}
function getAllData(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var b=ss.getSheetByName("予約表"),c=ss.getSheetByName("患者"),u=ss.getSheetByName("売上");
  return{ok:true,bookings:b?b.getDataRange().getValues():[[]],customers:c?c.getDataRange().getValues():[[]],uriage:u?u.getDataRange().getValues():[[]]};
}
function saveSheet(name,rows){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName(name)||ss.insertSheet(name);
  s.clearContents();
  if(!rows||!rows.length)return;
  var san=rows.map(function(row){return row.map(function(c){
    if(c===null||c===undefined)return"";
    if(c instanceof Date){var y=c.getFullYear(),m=String(c.getMonth()+1).padStart(2,"0"),d=String(c.getDate()).padStart(2,"0");return y+"-"+m+"-"+d;}
    return String(c);
  });});
  var rng=s.getRange(1,1,san.length,san[0].length);
  rng.setNumberFormats(san.map(function(r){return r.map(function(){return"@";});}));
  rng.setValues(san);
}
function resetBookings(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("予約表")||ss.insertSheet("予約表");
  s.clearContents();
  s.getRange(1,1,1,20).setValues([["日付","時間","区分","患者名","診察券No","予約ルート","来院回数","経過日数","症状","オプション","自費メニュー","処置(JSON)","処置メモ","物販(JSON)","支払方法","支払金額","区分リスト","再予約情報","キャンセル理由","施術部位"]]);
}
function saveLineSettings(){
  var p=PropertiesService.getScriptProperties();
  p.setProperty("LINE_TOKEN","RomnT7om/ytYjz1dicHgMbaxHZvnccCeBP6C3FX1s1TtiCW1ME3X3fK098wacBfDttVgnMM4jZPRN6G+RWRmYrkZUW+qkEjlugm5FVNagj5WOfwINV6NqEoNCH9OVbI7qViP6XzF3GEYdjWGHQvIsgdB04t89/1O/w1cDnyilFU=");
  p.setProperty("LINE_USER_ID","U9f7333eed2d51ceba13641059e8bd341");
  Logger.log("LINE settings saved");
}
function dailyLineAlert(){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
  if(!token||!ownerId){Logger.log("token not set");return;}
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var today=new Date();today.setHours(0,0,0,0);
  var nl=String.fromCharCode(10);
  var lu={};
  var ls=ss.getSheetByName("LINE_IDs");
  if(ls)ls.getDataRange().getValues().slice(1).forEach(function(r){if(r[0]&&r[1])lu[String(r[1]).trim()]=String(r[0]);});
  var alerts=[];
  var bs=ss.getSheetByName("予約表");
  if(bs){
    var bd=bs.getDataRange().getValues(),bh=bd[0];
    var di=bh.indexOf("日付"),ni=bh.indexOf("患者名"),ii=bh.indexOf("診察券No"),ki=bh.indexOf("区分");
    if(di>-1){
      var lv={};
      bd.slice(1).forEach(function(r){
        var k=String(r[ki]||"");
        if(k.indexOf("継続")>-1||k.indexOf("キャンセル")>-1)return;
        var dv=r[di];if(!dv)return;
        var d=dv instanceof Date?new Date(dv):new Date(String(dv));
        if(isNaN(d.getTime()))return;
        d.setHours(0,0,0,0);if(d>today)return;
        var key=String(r[ii]||"")||String(r[ni]||"");
        if(!lv[key]||d>lv[key].date)lv[key]={date:d,name:String(r[ni]||""),id:String(r[ii]||"")};
      });
      Object.values(lv).forEach(function(v){
        var diff=Math.floor((today-v.date)/(1000*60*60*24));
        if(diff>=17&&diff<=18)alerts.push({name:v.name,id:v.id,date:v.date,diff:diff,type:"warning"});
        if(diff>=20&&diff<=21)alerts.push({name:v.name,id:v.id,date:v.date,diff:diff,type:"urgent"});
      });
    }
  }
  if(!alerts.length){Logger.log("No alert today");return;}
  var urgent=alerts.filter(function(v){return v.type==="urgent";});
  var warning=alerts.filter(function(v){return v.type==="warning";});
  var ownerMsg="[倉治整骨院] アラート "+Utilities.formatDate(today,"Asia/Tokyo","M/d")+nl;
  if(urgent.length){ownerMsg+="[20日 本日初診料発生]"+nl;urgent.forEach(function(v){ownerMsg+="- "+v.name+"("+v.id+"号) 前回:"+Utilities.formatDate(v.date,"Asia/Tokyo","M/d")+nl;});}
  if(warning.length){ownerMsg+="[17日 3日後に初診料]"+nl;warning.forEach(function(v){ownerMsg+="- "+v.name+"("+v.id+"号) 前回:"+Utilities.formatDate(v.date,"Asia/Tokyo","M/d")+nl;});}
  ownerMsg+="来院を促してください";
  sendLineMessagingAPI(token,ownerId,ownerMsg);
  var sent=0,skip=0;
  alerts.forEach(function(v){
    var tid="";
    var tel=getTelByPatientName_(v.name);
    if(tel) tid=findLineUidByPhone_(tel);
    if(!tid){
      tid=lu[v.name]||null;
      if(!tid){
        var ln=v.name.split(" ")[0];
        var fk=Object.keys(lu).find(function(k){return k.replace(/ /g,"").indexOf(ln)===0;});
        if(fk)tid=lu[fk];
      }
    }
    if(!tid){skip++;return;}
    var deadline=new Date(v.date);deadline.setDate(deadline.getDate()+20);
    var ds=Utilities.formatDate(deadline,"Asia/Tokyo","M月d日");
    var msg=v.type==="urgent"
      ?"[倉治整骨院]"+nl+nl+v.name+"様"+nl+nl+"前回のご来院から"+v.diff+"日が経ちました。"+nl+ds+"以降にご来院いただくと初診料が発生いたします。"+nl+"ご都合よろしければ本日か明日のご来院をお待ちしております。"+nl+nl+"ご予約はこのLINEでどうぞ。"+nl+"(自動送信のため返信不要です)"
      :"[倉治整骨院]"+nl+nl+v.name+"様"+nl+nl+"ご無沙汰しております。その後お体はいかがでしょうか？"+nl+nl+"次回ご来院の際に初診料がかからないのは"+ds+"までとなっております。"+nl+"よろしければ早めのご来院をお待ちしております。"+nl+nl+"ご予約はこのLINEでどうぞ。"+nl+"(自動送信のため返信不要です)";
    if(sendLineMessagingAPI(token,tid,msg).ok){sent++;}else{skip++;}
  });
  Logger.log("Alert done: sent="+sent+" skip="+skip);
}
function sendDayBeforeReminders(){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
  if(!token)return;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var today=new Date();today.setHours(0,0,0,0);
  var tmr=new Date(today);tmr.setDate(tmr.getDate()+1);
  var tmrStr=Utilities.formatDate(tmr,"Asia/Tokyo","yyyy-MM-dd");
  var tmrDisp=Utilities.formatDate(tmr,"Asia/Tokyo","M月d日(E)");
  var nl=String.fromCharCode(10);
  var lu={};
  var ls=ss.getSheetByName("LINE_IDs");
  if(ls)ls.getDataRange().getValues().slice(1).forEach(function(r){if(r[0]&&r[1])lu[String(r[1]).trim()]=String(r[0]);});
  var bs=ss.getSheetByName("予約表");
  if(!bs)return;
  var bd=bs.getDataRange().getValues(),bh=bd[0];
  var di=bh.indexOf("日付"),ti=bh.indexOf("時間"),ni=bh.indexOf("患者名"),ki=bh.indexOf("区分");
  if(di<0)return;
  var bp={},seen={};
  bd.slice(1).forEach(function(r){
    var dv=String(r[di]||"").trim(),k=String(r[ki]||"");
    if(k.indexOf("継続")>-1||k.indexOf("キャンセル")>-1||dv!==tmrStr)return;
    var n=String(r[ni]||"").trim(),t=String(r[ti]||"").trim();
    if(!n||!t||seen[n+"_"+t])return;
    seen[n+"_"+t]=true;
    if(!bp[n])bp[n]=[];
    bp[n].push(t);
  });
  if(!Object.keys(bp).length)return;
  var sent=0,skip=[];
  Object.keys(bp).forEach(function(name){
    var tid="";
    var tel=getTelByPatientName_(name);
    if(tel) tid=findLineUidByPhone_(tel);
    if(!tid){
      tid=lu[name];
      if(!tid){var ln=name.split(" ")[0];var fk=Object.keys(lu).find(function(k){return k.replace(/ /g,"").indexOf(ln)===0;});if(fk)tid=lu[fk];}
    }
    if(!tid){skip.push(name);return;}
    var msg="[倉治整骨院]"+nl+tmrDisp+"のご予約リマインドです"+nl+nl+"時間: "+bp[name].join(" / ")+nl+nl+"お気をつけてお越しください。"+nl+"(自動送信のため返信不要です)";
    if(sendLineMessagingAPI(token,tid,msg).ok){sent++;}else{skip.push(name);}
  });
  if(ownerId){
    var s="[倉治整骨院] 前日リマインド完了"+nl+tmrDisp+nl+"送信:"+sent+"件";
    if(skip.length)s+=nl+"未登録: "+skip.join(", ");
    sendLineMessagingAPI(token,ownerId,s);
  }
}
function getFollowers(){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN");
  if(!token){Logger.log("token not set");return;}
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("LINE_IDs");
  if(!s){s=ss.insertSheet("LINE_IDs");s.getRange(1,1,1,4).setValues([["userId","name","lastMsg","updated"]]);}
  var nl=String.fromCharCode(10);
  var start=null,count=0;
  do{
    var url="https://api.line.me/v2/bot/followers/ids?count=1000";
    if(start)url+="&start="+start;
    var res=UrlFetchApp.fetch(url,{headers:{"Authorization":"Bearer "+token},muteHttpExceptions:true});
    if(res.getResponseCode()!==200){Logger.log("error:"+res.getContentText());break;}
    var data=JSON.parse(res.getContentText());
    var uids=data.userIds||[];
    uids.forEach(function(uid){
      var dname="";
      try{
        var pr=UrlFetchApp.fetch("https://api.line.me/v2/bot/profile/"+uid,{headers:{"Authorization":"Bearer "+token},muteHttpExceptions:true});
        if(pr.getResponseCode()===200)dname=JSON.parse(pr.getContentText()).displayName||"";
      }catch(err){}
      var existing=s.getDataRange().getValues();
      var found=false;
      for(var i=1;i<existing.length;i++){if(existing[i][0]===uid){found=true;break;}}
      if(!found){s.appendRow([uid,dname,"",new Date()]);count++;}
    });
    start=data.next||null;
  }while(start);
  Logger.log("Followers saved: "+count+"件");
  var ownerUserId=p.getProperty("LINE_USER_ID");
  if(ownerUserId)sendLineMessagingAPI(token,ownerUserId,"[倉治整骨院] フォロワー取得完了: "+count+"件のLINE IDを保存しました");
}
function setupAllTriggers(){
  ScriptApp.getProjectTriggers().forEach(function(t){ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger("dailyLineAlert").timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger("sendDayBeforeReminders").timeBased().everyDays(1).atHour(18).create();
  Logger.log("Triggers set OK");
}
function sendLineMessagingAPI(token,userId,message){
  if(!token||!userId||!message)return{ok:false};
  try{
    var res=UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push",{
      method:"post",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
      payload:JSON.stringify({to:userId,messages:[{type:"text",text:message}]})
    });
    return{ok:res.getResponseCode()===200};
  }catch(e){return{ok:false};}
}

// ═══════════════════════════════════════
// ★ここから下が今回の追加分（Web予約フォーム対応）★
// ═══════════════════════════════════════

// Web予約フォーム(book.html)からの予約受付。ダブルブッキング防止つき。
// 60分メニュー=3枠、40分メニュー=2枠など、複数枠をまとめて予約できる。
// 2枠目以降は区分に「(継続)」を付けて登録する（＝既存の来院アラート等の集計対象から自動的に除外される仕組みを利用）
// ═══════════════════════════════════════
// ⑤ 営業時間設定（曜日ごとの診療時間＋祝日などの個別上書き）
// ═══════════════════════════════════════
function saveBizHoursWeekly(rows){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("biz_hours_weekly");
    if(!s) s=ss.insertSheet("biz_hours_weekly");
    s.clearContents();
    s.getRange(1,1,1,6).setValues([["dow","closed","amStart","amEnd","pmStart","pmEnd"]]);
    if(rows && rows.length) s.getRange(2,1,rows.length,6).setValues(rows);
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}
function saveBizHoursOverride(rows){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("biz_hours_override");
    if(!s) s=ss.insertSheet("biz_hours_override");
    s.clearContents();
    s.getRange(1,1,1,7).setValues([["date","closed","amStart","amEnd","pmStart","pmEnd","note"]]);
    if(rows && rows.length) s.getRange(2,1,rows.length,7).setValues(rows);
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}
function getBizHours(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var w=ss.getSheetByName("biz_hours_weekly");
  var o=ss.getSheetByName("biz_hours_override");
  return {
    ok:true,
    weekly: w?w.getDataRange().getValues().slice(1):[],
    overrides: o?o.getDataRange().getValues().slice(1):[]
  };
}

var SLOTS_LIST_=["08:30","08:50","09:10","09:30","09:50","10:10","10:30","10:50",
  "11:10","11:30","11:50","12:10","15:00","15:20","15:40","16:00",
  "16:20","16:40","17:00","17:20","17:40","18:00","18:20","18:40",
  "19:00","19:20","19:40"];
// 20分刻みのスロット配列を生成（開始〜終了時刻から）
function genSlots_(startStr,endStr){
  if(!startStr||!endStr) return [];
  var sp=startStr.split(":"),ep=endStr.split(":");
  var h=parseInt(sp[0]),m=parseInt(sp[1]);
  var eh=parseInt(ep[0]),em=parseInt(ep[1]);
  var out=[];
  var guard=0;
  while(!(h===eh&&m===em)&&guard<100){
    out.push((h<10?"0"+h:h)+":"+(m<10?"0"+m:m));
    m+=20; if(m>=60){m-=60;h++;}
    guard++;
  }
  return out.filter(function(s){return SLOTS_LIST_.indexOf(s)>-1;});
}
// 指定日の診療設定を取得（特定日の上書き優先、無ければ曜日の設定、それも無ければ従来のデフォルト）
function getDayConfig_(dateStr){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var o=ss.getSheetByName("biz_hours_override");
  if(o){
    var od=o.getDataRange().getValues();
    for(var i=1;i<od.length;i++){
      if(String(od[i][0])===dateStr){
        return {closed:od[i][1]===true||od[i][1]==="TRUE", am:od[i][1]?null:[String(od[i][2]),String(od[i][3])], pm:od[i][1]?null:[String(od[i][4]),String(od[i][5])]};
      }
    }
  }
  var w=ss.getSheetByName("biz_hours_weekly");
  var dow=new Date(dateStr+"T00:00:00").getDay();
  if(w){
    var wd=w.getDataRange().getValues();
    for(var j=1;j<wd.length;j++){
      if(Number(wd[j][0])===dow){
        var closed=wd[j][1]===true||wd[j][1]==="TRUE";
        return {closed:closed, am:closed?null:[String(wd[j][2]),String(wd[j][3])], pm:closed?null:[String(wd[j][4]),String(wd[j][5])]};
      }
    }
  }
  // 設定が無い場合の従来デフォルト（日曜休診・木土は午前のみ）
  if(dow===0) return {closed:true, am:null, pm:null};
  if(dow===4||dow===6) return {closed:false, am:["08:30","12:30"], pm:null};
  return {closed:false, am:["08:30","12:30"], pm:["15:00","20:00"]};
}
function getSlotsForDate_(dateStr){
  var cfg=getDayConfig_(dateStr);
  if(cfg.closed) return [];
  var mo=genSlots_(cfg.am&&cfg.am[0],cfg.am&&cfg.am[1]);
  var af=genSlots_(cfg.pm&&cfg.pm[0],cfg.pm&&cfg.pm[1]);
  return mo.concat(af);
}

function saveWebBooking(data){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("予約表");
    if(!s) return {ok:false, error:"予約表シートが見つかりません"};

    var dayCfg=getDayConfig_(data.date);
    if(dayCfg.closed) return {ok:false, error:"本日は休診日です。別の日をお選びください。"};

    var validSlots=getSlotsForDate_(data.date);
    var need=Number(data.slotsNeeded)||1;
    var startIdx=SLOTS_LIST_.indexOf(data.time);
    if(startIdx<0) return {ok:false, error:"時間の指定が不正です"};
    var slotsToUse=[];
    for(var k=0;k<need;k++){
      var idx=startIdx+k;
      if(idx>=SLOTS_LIST_.length) return {ok:false, error:"その時間からでは施術時間が足りません。別の時間をお選びください。"};
      var slot=SLOTS_LIST_[idx];
      if(validSlots.indexOf(slot)<0) return {ok:false, error:"その時間は診療時間外です。別の時間をお選びください。"};
      // 午前と午後をまたぐ予約は不可（12:10の次が15:00に飛ぶため）
      if(k>0 && slot<SLOTS_LIST_[startIdx] && SLOTS_LIST_[startIdx]<"13:00" && slot>="13:00"){
        return {ok:false, error:"施術時間が午前・午後をまたいでしまいます。別の時間をお選びください。"};
      }
      slotsToUse.push(slot);
    }

    var rows=s.getDataRange().getValues();
    for(var i=1;i<rows.length;i++){
      if(String(rows[i][0])===String(data.date) && slotsToUse.indexOf(String(rows[i][1]))>-1){
        if(String(rows[i][3]||"").trim()!==""){
          return {ok:false, error:"ご指定の時間帯は既にご予約が入っています。別の時間をお選びください。"};
        }
      }
    }

    slotsToUse.forEach(function(slot,k){
      var kubun=(data.kubun||"自費")+(k>0?"(継続)":"");
      var newRow=[
        data.date, slot, kubun, data.name||"", data.cardId||"",
        "Web予約", data.visitCount||"", "", k===0?(data.symptom||""):"", "",
        k===0?(data.menu||""):"", "", "", "", "", "", "", "", "", ""
      ];
      s.appendRow(newRow);
    });

    // 予約確認ページ(confirm.html)から電話番号で検索できるよう、別シートに控えを保存
    var meta=ss.getSheetByName("web_yoyaku_meta");
    if(!meta){ meta=ss.insertSheet("web_yoyaku_meta"); meta.getRange(1,1,1,7).setValues([["date","time","name","tel","email","menu","createdAt"]]); }
    meta.appendRow([data.date, data.time, data.name||"", data.tel||"", data.email||"", data.menu||"", new Date()]);

    var p=PropertiesService.getScriptProperties();
    var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
    var nl=String.fromCharCode(10);
    if(token&&ownerId){
      sendLineMessagingAPI(token,ownerId,"[倉治整骨院] Web予約が入りました"+nl+data.date+" "+data.time+"〜"+nl+(data.menu||"")+nl+(data.name||"")+" 様"+nl+(data.tel||""));
    }
    // 患者様ご本人のLINEにも即座に予約確認メッセージを送信（電話番号での照合を最優先）
    if(token){
      var tid="";
      if(data.tel) tid=findLineUidByPhone_(data.tel);
      if(!tid && data.name){
        var ls=ss.getSheetByName("LINE_IDs");
        if(ls){
          var lu={};
          ls.getDataRange().getValues().slice(1).forEach(function(r){if(r[0]&&r[1])lu[String(r[1]).trim()]=String(r[0]);});
          var nameTrim=String(data.name).trim();
          tid=lu[nameTrim];
          if(!tid){
            var ln=nameTrim.split(" ")[0].split("　")[0];
            var fk=Object.keys(lu).find(function(k){return k.replace(/[ 　]/g,"").indexOf(ln.replace(/[ 　]/g,""))===0;});
            if(fk)tid=lu[fk];
          }
        }
      }
      if(tid){
        var dispDate=Utilities.formatDate(new Date(data.date),"Asia/Tokyo","M月d日(E)");
        sendLineMessagingAPI(token,tid,"[倉治整骨院]"+nl+nl+(data.name||"")+"様"+nl+nl+"ご予約を承りました。"+nl+dispDate+" "+data.time+"〜"+nl+"メニュー："+(data.menu||"")+nl+nl+"前日にもリマインドをお送りします。"+nl+"お気をつけてお越しください。"+nl+"(自動送信のため返信不要です)");
      }
    }
    // メールアドレスが入力されていれば、LINEの有無に関わらずメールでも確認を送る
    if(data.email){
      try{
        var dispDate2=Utilities.formatDate(new Date(data.date),"Asia/Tokyo","M月d日(E)");
        MailApp.sendEmail({
          to: data.email,
          subject: "【倉治整骨院】ご予約確認",
          body: (data.name||"")+" 様"+nl+nl+"この度はご予約ありがとうございます。以下の内容で承りました。"+nl+nl+
                "日時："+dispDate2+" "+data.time+"〜"+nl+
                "メニュー："+(data.menu||"")+nl+nl+
                "ご都合が悪くなった場合はお電話にてご連絡ください。"+nl+nl+
                "倉治整骨院"
        });
      }catch(err){ Logger.log("mail error:"+err); }
    }
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}

// 予約確認ページ(confirm.html)用：電話番号から今後の予約を検索
function lookupBooking(tel){
  var digits=String(tel||"").replace(/[^0-9]/g,"");
  if(!digits) return {ok:false, error:"電話番号を入力してください"};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var meta=ss.getSheetByName("web_yoyaku_meta");
  if(!meta) return {ok:true, list:[]};
  var rows=meta.getDataRange().getValues();
  var today=new Date();today.setHours(0,0,0,0);
  var list=[];
  for(var i=1;i<rows.length;i++){
    var rTel=String(rows[i][3]||"").replace(/[^0-9]/g,"");
    if(rTel!==digits) continue;
    var d=new Date(String(rows[i][0]));
    if(isNaN(d.getTime())||d<today) continue;
    list.push({date:String(rows[i][0]), time:String(rows[i][1]), name:String(rows[i][2]), menu:String(rows[i][5])});
  }
  list.sort(function(a,b){return (a.date+a.time)<(b.date+b.time)?-1:1;});
  return {ok:true, list:list};
}

// 自費メニュー(処置マスター)をGASにも保存し、Web予約フォームから見えるようにする
function saveMenuMaster(rows){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("menu_master");
    if(!s) s=ss.insertSheet("menu_master");
    s.clearContents();
    s.getRange(1,1,1,3).setValues([["name","price","unit"]]);
    if(rows && rows.length){
      s.getRange(2,1,rows.length,3).setValues(rows);
    }
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}
function getMenuMaster(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("menu_master");
  if(!s) return {ok:true, rows:[]};
  var data=s.getDataRange().getValues();
  return {ok:true, rows:data.slice(1)};
}
