function doGet(e){
  var action=(e&&e.parameter&&e.parameter.action)||"getAll";
  var callback=(e&&e.parameter&&e.parameter.callback)||"";
  var result;
  try{if(action==="getAll"){result=getAllData();}else if(action==="getMenuMaster"){result=getMenuMaster();}else{result={ok:true};}}
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
          if(ev.type==="message"&&ev.source&&ev.source.userId){
            var uid=ev.source.userId;
            var dname="";
            var tok=PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
            if(tok){
              var r=UrlFetchApp.fetch("https://api.line.me/v2/bot/profile/"+uid,{headers:{"Authorization":"Bearer "+tok},muteHttpExceptions:true});
              if(r.getResponseCode()===200)dname=JSON.parse(r.getContentText()).displayName||"";
            }
            saveLineUserId(uid,dname,ev.message.text||"");
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
      else result={ok:false,error:"unknown"};
      if(result)ret=ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
  }catch(err){Logger.log("doPost error:"+err);}
  return ret;
}
function saveLineUserId(userId,displayName,message){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("LINE_IDs");
  if(!s){s=ss.insertSheet("LINE_IDs");s.getRange(1,1,1,4).setValues([["userId","name","lastMsg","updated"]]);}
  var data=s.getDataRange().getValues();
  var now=new Date();
  for(var i=1;i<data.length;i++){
    if(data[i][0]===userId){s.getRange(i+1,2,1,3).setValues([[displayName||data[i][1],message,now]]);return;}
  }
  s.appendRow([userId,displayName,message,now]);
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
    var tid=lu[v.name]||null;
    if(!tid){
      var ln=v.name.split(" ")[0];
      var fk=Object.keys(lu).find(function(k){return k.replace(/ /g,"").indexOf(ln)===0;});
      if(fk)tid=lu[fk];
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
    var tid=lu[name];
    if(!tid){var ln=name.split(" ")[0];var fk=Object.keys(lu).find(function(k){return k.replace(/ /g,"").indexOf(ln)===0;});if(fk)tid=lu[fk];}
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
function saveWebBooking(data){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("予約表");
    if(!s) return {ok:false, error:"予約表シートが見つかりません"};
    var rows=s.getDataRange().getValues();
    for(var i=1;i<rows.length;i++){
      if(String(rows[i][0])===String(data.date) && String(rows[i][1])===String(data.time)){
        if(String(rows[i][3]||"").trim()!==""){
          return {ok:false, error:"この時間は既にご予約が入っています。別の時間をお選びください。"};
        }
      }
    }
    var newRow=[
      data.date, data.time, data.kubun||"自費", data.name||"", data.cardId||"",
      "Web予約", data.visitCount||"", "", data.symptom||"", "",
      data.menu||"", "", "", "", "", "", "", "", "", ""
    ];
    s.appendRow(newRow);

    var p=PropertiesService.getScriptProperties();
    var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
    if(token&&ownerId){
      var nl=String.fromCharCode(10);
      sendLineMessagingAPI(token,ownerId,"[倉治整骨院] Web予約が入りました"+nl+data.date+" "+data.time+nl+(data.name||"")+" 様"+nl+(data.tel||""));
    }
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
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
