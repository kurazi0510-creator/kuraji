function doGet(e){
  var action=(e&&e.parameter&&e.parameter.action)||"getAll";
  var callback=(e&&e.parameter&&e.parameter.callback)||"";
  var result;
  try{if(action==="getAll"){result=getAllData();}else if(action==="getMenuMaster"){result=getMenuMaster();}else if(action==="lookupBooking"){result=lookupBooking((e&&e.parameter&&e.parameter.tel)||"");}else if(action==="getBizHours"){result=getBizHours();}else if(action==="getLineUsers"){result=getLineUsers();}else{result={ok:true};}}
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
      // 同時に複数のLINEイベントが届いた際、LINE_IDsシートへの書き込みが競合して
      // 同じ人が重複登録されてしまう不具合を防ぐため、処理をロックする
      var lock=LockService.getScriptLock();
      try{ lock.waitLock(10000); }catch(lockErr){ /* ロック取得失敗時もそのまま続行（最悪重複の可能性は残るが処理は止めない） */ }
      body.events.forEach(function(ev){
        try{
          if(ev.type==="follow"&&ev.source&&ev.source.userId){
            var tok0=PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
            if(tok0){
              sendLineMessagingAPI(tok0,ev.source.userId,"友だち追加ありがとうございます😊"+String.fromCharCode(10)+String.fromCharCode(10)+"ご予約のお知らせ・前日リマインドをこちらのLINEでお受け取りいただくために、お電話番号を数字のみで送信してください。"+String.fromCharCode(10)+"例）09012345678"+String.fromCharCode(10)+String.fromCharCode(10)+"（LINEの表示名を本名以外にされている方が多いため、お電話番号での確認をお願いしております）");
              markPromptSent_(ev.source.userId);
            }
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
            var trimmedMsg=String(msgText).trim().replace(/[-‐－ー―\s()（）]/g,"");
            // メッセージ全体が「0で始まる9〜10桁の数字だけ」の場合のみ電話番号として認識する
            // （文章の中に混ざった数字を誤って電話番号として拾ってしまう不具合の対策）
            var isPhoneOnly=/^0\d{9,10}$/.test(trimmedMsg);
            if(isPhoneOnly){
              saveLinePhone_(uid,trimmedMsg,dname);
              if(tok)sendLineMessagingAPI(tok,uid,"📱 お電話番号を登録しました！"+String.fromCharCode(10)+"今後、ご予約確認・前日リマインドをこちらのLINEにお送りします。"+String.fromCharCode(10)+String.fromCharCode(10)+"倉治整骨院");
            }else{
              saveLineUserId(uid,dname,msgText);
              // 案内メッセージは友だち1人につき1回だけ送信（すでに送信済み・登録済みの方には送らない）
              if(tok && !hasPromptSent_(uid) && !findPhoneByUid_(uid)){
                sendLineMessagingAPI(tok,uid,"いつもありがとうございます😊"+String.fromCharCode(10)+"ご予約のお知らせを受け取るには、お電話番号を数字のみで送ってください。"+String.fromCharCode(10)+"例）09012345678");
                markPromptSent_(uid);
              }
            }
          }
        }catch(err){Logger.log("event error:"+err);}
      });
      try{ lock.releaseLock(); }catch(relErr){}
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
      else if(action==="saveBizHoursWeekly")result=saveBizHoursWeekly(body.rows);
      else if(action==="saveBizHoursOverride")result=saveBizHoursOverride(body.rows);
      else if(action==="getBizHours")result=getBizHours();
      else if(action==="deleteBookingsByName")result=deleteBookingsByName(body.namePrefix);
      else if(action==="saveLineUserPhoneManual")result=saveLineUserPhoneManual(body.userId,body.phone,body.name,body.cardId);
      else if(action==="setTestMode")result=setTestMode(body.name);
      else if(action==="getTestMode")result=getTestMode();
      else if(action==="runDayBeforeRemindersNow"){sendDayBeforeReminders();result={ok:true};}
      else if(action==="runBirthdayMessagesNow"){sendBirthdayMessages();result={ok:true};}
      else if(action==="getBirthdayLog")result=getBirthdayLog();
      else if(action==="sendBirthdayMessageTestTo")result=sendBirthdayMessageTestTo(body.name);
      else if(action==="findDuplicateLineUsers")result=findDuplicateLineUsers();
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
      var rng1=s.getRange(i+1,2,1,4);
      rng1.setNumberFormat("@");
      rng1.setValues([[displayName||data[i][1],"(電話番号登録)",now,phoneDigits]]);
      return;
    }
  }
  var newIdx=s.getLastRow()+1;
  var rng2=s.getRange(newIdx,1,1,5);
  rng2.setNumberFormat("@");
  rng2.setValues([[userId,displayName||"","(電話番号登録)",now,phoneDigits]]);
}
function findPhoneByUid_(userId){
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LINE_IDs");
  if(!s) return "";
  var data=s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){ if(data[i][0]===userId) return fixPhoneLeadingZero_(data[i][4]); }
  return "";
}
// 案内メッセージを送信済みかどうかを確認（1人1回だけ送るための管理）
function hasPromptSent_(userId){
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LINE_IDs");
  if(!s) return false;
  var data=s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){ if(data[i][0]===userId) return String(data[i][5]||"")==="TRUE"; }
  return false;
}
function markPromptSent_(userId){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("LINE_IDs");
  if(!s){s=ss.insertSheet("LINE_IDs");s.getRange(1,1,1,6).setValues([["userId","name","lastMsg","updated","phone","promptSent"]]);}
  var data=s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(data[i][0]===userId){ s.getRange(i+1,6).setValue("TRUE"); return; }
  }
  var newIdx=s.getLastRow()+1;
  var rng=s.getRange(newIdx,1,1,6);
  rng.setNumberFormat("@");
  rng.setValues([[userId,"","","",new Date(),"TRUE"]]);
}
// 電話番号からLINEのuserIdを検索（表示名の一致に頼らない、最優先の照合方法）
// 電話番号の先頭の「0」が数値変換で消えてしまった場合に自動で復元する
// （日本の電話番号は必ず0から始まるため、9〜10桁で0始まりでなければ0を補う）
function fixPhoneLeadingZero_(v){
  var digits=String(v||"").replace(/[^0-9]/g,"");
  if(!digits) return "";
  if(digits.charAt(0)!=="0" && digits.length>=9 && digits.length<=10) return "0"+digits;
  return digits;
}
function findLineUidByPhone_(phone){
  var digits=fixPhoneLeadingZero_(phone);
  if(!digits) return "";
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LINE_IDs");
  if(!s) return "";
  var data=s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    var p=fixPhoneLeadingZero_(data[i][4]);
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
    if(String(data[i][ni]||"").trim()===target) return fixPhoneLeadingZero_(data[i][ti]);
  }
  return "";
}
function getLineUsers(){
  var s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LINE_IDs");
  if(!s)return{ok:true,users:[]};
  return{ok:true,users:s.getDataRange().getValues().slice(1).map(function(r){
    var phoneFixed=fixPhoneLeadingZero_(r[4]);
    return{userId:String(r[0]||''),name:String(r[1]||''),lastMsg:String(r[2]||''),updated:String(r[3]||''),phone:phoneFixed,registered:!!phoneFixed,cardId:String(r[6]||'')};
  })};
}
// 同じuserIdが複数行に分かれてしまった重複を1行にまとめる（電話番号・名前・診察券Noは最も情報が多いものを残す）
// ★書き込みは一切行わない（安全のため自動修正機能は廃止）★
// 重複しているuserIdを見つけて一覧を返すだけ。実際の削除・修正は一覧画面から1件ずつ手動で行う。
function findDuplicateLineUsers(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("LINE_IDs");
  if(!s) return {ok:true, duplicates:[]};
  var data=s.getDataRange().getValues();
  var byUid={};
  for(var i=1;i<data.length;i++){
    var uid=String(data[i][0]||'').trim();
    if(!uid) continue;
    if(!byUid[uid]) byUid[uid]=[];
    byUid[uid].push({
      row:i+1,
      name:String(data[i][1]||''),
      phone:fixPhoneLeadingZero_(data[i][4]),
      cardId:String(data[i][6]||'')
    });
  }
  var duplicates=[];
  Object.keys(byUid).forEach(function(uid){
    if(byUid[uid].length>1){
      duplicates.push({userId:uid, entries:byUid[uid]});
    }
  });
  return {ok:true, duplicates:duplicates};
}
// kanri.html側から手動で電話番号・名前・診察券番号を登録・修正する（LINEを介さず、スタッフが直接編集する場合）
function saveLineUserPhoneManual(userId,phone,name,cardId){
  try{
    if(!userId) return {ok:false,error:'userIdが指定されていません'};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("LINE_IDs");
    if(!s){s=ss.insertSheet("LINE_IDs");s.getRange(1,1,1,7).setValues([["userId","name","lastMsg","updated","phone","promptSent","cardId"]]);}
    var data=s.getDataRange().getValues();
    var phoneDigits=String(phone||'').replace(/[^0-9]/g,'');
    var nameVal=(name!==undefined && name!==null)?String(name).trim():'';
    var cardVal=(cardId!==undefined && cardId!==null)?String(cardId).trim():'';
    for(var i=1;i<data.length;i++){
      if(data[i][0]===userId){
        var rng=s.getRange(i+1,2,1,3); // name, lastMsg, updated
        rng.setNumberFormat("@");
        rng.setValues([[nameVal||data[i][1], data[i][2], new Date()]]);
        var rngPhone=s.getRange(i+1,5);
        rngPhone.setNumberFormat("@");
        rngPhone.setValue(phoneDigits);
        var rngCard=s.getRange(i+1,7);
        rngCard.setNumberFormat("@");
        rngCard.setValue(cardVal||data[i][6]||'');
        return {ok:true};
      }
    }
    var newIdx=s.getLastRow()+1;
    var rng2=s.getRange(newIdx,1,1,7);
    rng2.setNumberFormat("@");
    rng2.setValues([[userId,nameVal,'',new Date(),phoneDigits,'',cardVal]]);
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
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
  // 患者ごとの「初診料アラート送信」設定を取得（FALSEの人は除外する）
  var alertOffIds={}, alertOffNames={};
  var ps=ss.getSheetByName("患者");
  if(ps){
    var pd=ps.getDataRange().getValues(), ph=pd[0].map(function(h){return String(h||"").trim();});
    var pai=ph.indexOf("アラート送信");
    if(pai>-1){
      pd.slice(1).forEach(function(r){
        if(String(r[pai]||"").toUpperCase()==="FALSE"){
          if(r[0])alertOffIds[String(r[0]).trim()]=true;
          if(r[1])alertOffNames[String(r[1]).trim()]=true;
        }
      });
    }
  }
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
        if(alertOffIds[v.id]||alertOffNames[v.name])return; // アラート対象外の患者はスキップ
        var diff=Math.floor((today-v.date)/(1000*60*60*24));
        if(diff>=18&&diff<=19)alerts.push({name:v.name,id:v.id,date:v.date,diff:diff,type:"warning"});
        if(diff>=21&&diff<=22)alerts.push({name:v.name,id:v.id,date:v.date,diff:diff,type:"urgent"});
      });
    }
  }
  if(!alerts.length){Logger.log("No alert today");return;}
  var urgent=alerts.filter(function(v){return v.type==="urgent";});
  var warning=alerts.filter(function(v){return v.type==="warning";});
  var ownerMsg="[倉治整骨院] アラート "+Utilities.formatDate(today,"Asia/Tokyo","M/d")+nl;
  if(urgent.length){ownerMsg+="[21日経過 初診料発生中]"+nl;urgent.forEach(function(v){ownerMsg+="- "+v.name+"("+v.id+"号) 前回:"+Utilities.formatDate(v.date,"Asia/Tokyo","M/d")+nl;});}
  if(warning.length){ownerMsg+="[18日経過 3日後に初診料]"+nl;warning.forEach(function(v){ownerMsg+="- "+v.name+"("+v.id+"号) 前回:"+Utilities.formatDate(v.date,"Asia/Tokyo","M/d")+nl;});}
  ownerMsg+="来院を促してください";
  sendLineMessagingAPI(token,ownerId,ownerMsg);
  // ★患者様への直接送信は日付カウントの不具合により一時停止中★
  // （院長への通知のみ行い、実際に連絡するかどうかは院長の判断で行う）
  var sent=0,skip=alerts.length;
  /* 
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
  */
  Logger.log("Alert done: sent="+sent+" skip="+skip);
}
function sendDayBeforeReminders(){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
  if(!token)return;
  var testModeName=p.getProperty("TEST_MODE_NAME")||""; // 例:"郡" と設定すると、その名前を含む患者にしか送らない
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
    // 日付セルがテキストでも日付型でも正しく比較できるようにする
    var rawDate=r[di];
    var dv=(rawDate instanceof Date)?Utilities.formatDate(rawDate,"Asia/Tokyo","yyyy-MM-dd"):String(rawDate||"").trim();
    var k=String(r[ki]||"");
    if(k.indexOf("継続")>-1||k.indexOf("キャンセル")>-1||dv!==tmrStr)return;
    var n=String(r[ni]||"").trim(),t=String(r[ti]||"").trim();
    if(!n||!t||seen[n+"_"+t])return;
    if(testModeName && n.indexOf(testModeName)<0)return; // テストモード中は対象外の患者をスキップ
    seen[n+"_"+t]=true;
    if(!bp[n])bp[n]=[];
    bp[n].push(t);
  });
  if(!Object.keys(bp).length)return;
  var sent=0,skip=[],sentNames=[];
  Object.keys(bp).forEach(function(name){
    var tid="";
    var tel=getTelByPatientName_(name);
    if(tel) tid=findLineUidByPhone_(tel);
    if(!tid){
      tid=lu[name];
      if(!tid){var ln=name.split(" ")[0];var fk=Object.keys(lu).find(function(k){return k.replace(/ /g,"").indexOf(ln)===0;});if(fk)tid=lu[fk];}
    }
    if(!tid){skip.push(name);return;}
    var msg=(testModeName?"【テスト送信】"+nl:"")+"🔔 ご予約リマインド"+nl+nl+"━━━━━━━━━━"+nl+"📅 "+tmrDisp+nl+"⏰ "+bp[name].join("・")+nl+"━━━━━━━━━━"+nl+nl+"明日のご予約が近づいてまいりました。"+nl+"お気をつけてお越しくださいませ😊"+nl+nl+"倉治整骨院"+nl+"(このメッセージへの返信は不要です)";
    if(sendLineMessagingAPI(token,tid,msg).ok){sent++;sentNames.push(name);}else{skip.push(name);}
  });
  if(ownerId){
    var s=(testModeName?"【テストモード中：「"+testModeName+"」のみ対象】"+nl:"")+"[倉治整骨院] 前日リマインド完了"+nl+tmrDisp+nl+"送信:"+sent+"件";
    if(sentNames.length)s+=nl+"送信した人: "+sentNames.join(", ");
    if(skip.length)s+=nl+"未登録: "+skip.join(", ");
    sendLineMessagingAPI(token,ownerId,s);
  }
}
// テストモードの設定・解除（設定するとその名前を含む患者にしか自動送信されなくなる。空にすると全員に送信される通常運用に戻る）
function setTestMode(name){
  var p=PropertiesService.getScriptProperties();
  if(name){ p.setProperty("TEST_MODE_NAME", String(name).trim()); }
  else{ p.deleteProperty("TEST_MODE_NAME"); }
  return {ok:true, testModeName: p.getProperty("TEST_MODE_NAME")||""};
}
function getTestMode(){
  var p=PropertiesService.getScriptProperties();
  return {ok:true, testModeName: p.getProperty("TEST_MODE_NAME")||""};
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
  ScriptApp.newTrigger("sendDayBeforeReminders").timeBased().everyDays(1).atHour(19).create();
  ScriptApp.newTrigger("sendBirthdayMessages").timeBased().everyDays(1).atHour(9).create();
  Logger.log("Triggers set OK");
}
// 誕生日の患者様にLINEでお祝いメッセージ＋誕生月クーポンを自動送信（毎日9時）
function sendBirthdayMessages(){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
  if(!token)return;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var ps=ss.getSheetByName("患者");
  if(!ps)return;
  var nl=String.fromCharCode(10);
  var today=new Date();
  var mm=today.getMonth()+1, dd=today.getDate();

  var data=ps.getDataRange().getValues();
  var headers=data[0].map(function(h){return String(h||"").trim();});
  var idI=0, nameI=1, telI=headers.indexOf("電話番号"), dobI=headers.indexOf("生年月日");
  var bsI=headers.indexOf("誕生日クーポン送信");
  if(telI<0)telI=4; if(dobI<0)dobI=13;

  var targets=[];
  for(var i=1;i<data.length;i++){
    var dob=String(data[i][dobI]||"").trim();
    var m=dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) continue;
    if(parseInt(m[2])===mm && parseInt(m[3])===dd){
      if(bsI>-1 && String(data[i][bsI]||"").toUpperCase()==="FALSE") continue; // 対象外の患者はスキップ
      targets.push({id:String(data[i][idI]||""), name:String(data[i][nameI]||"").trim(), tel:String(data[i][telI]||"")});
    }
  }
  if(!targets.length) return;

  var expireDate=new Date(today.getFullYear(),today.getMonth(),today.getDate()+30);
  var todayDisp=Utilities.formatDate(today,"Asia/Tokyo","M月d日");
  var expireStr=Utilities.formatDate(expireDate,"Asia/Tokyo","M月d日");
  var todayStr=Utilities.formatDate(today,"Asia/Tokyo","yyyy-MM-dd");

  // 送信履歴シート（無ければ作成）
  var log=ss.getSheetByName("birthday_log");
  if(!log){ log=ss.insertSheet("birthday_log"); log.getRange(1,1,1,5).setValues([["date","id","name","result","expireUntil"]]); }

  var sentNames=[], skip=[];
  targets.forEach(function(t){
    var tid="";
    if(t.tel) tid=findLineUidByPhone_(t.tel);
    if(!tid){
      var ls=ss.getSheetByName("LINE_IDs");
      if(ls){
        var lu={};
        ls.getDataRange().getValues().slice(1).forEach(function(r){if(r[0]&&r[1])lu[String(r[1]).trim()]=String(r[0]);});
        tid=lu[t.name];
        if(!tid){var ln=t.name.split(" ")[0].split("　")[0];var fk=Object.keys(lu).find(function(k){return k.replace(/[ 　]/g,"").indexOf(ln)===0;});if(fk)tid=lu[fk];}
      }
    }
    var result;
    if(!tid){skip.push(t.name);result="未登録";}
    else{
      var msg="🎂 お誕生日おめでとうございます！"+nl+nl+t.name+"様"+nl+nl+"いつも倉治整骨院をご利用いただき、ありがとうございます。"+nl+nl+"日頃の感謝を込めて、次回ご来院時に使える"+nl+"【500円引きクーポン】をプレゼントいたします🎁"+nl+nl+"有効期限："+todayDisp+"〜"+expireStr+"まで"+nl+"(受付でこのメッセージをご提示ください)"+nl+nl+"素敵な1年になりますように😊"+nl+nl+"倉治整骨院";
      if(sendLineMessagingAPI(token,tid,msg).ok){sentNames.push(t.name);result="送信済み";}else{skip.push(t.name);result="送信失敗";}
    }
    var newIdx=log.getLastRow()+1;
    var rng=log.getRange(newIdx,1,1,5);
    rng.setNumberFormat("@");
    rng.setValues([[todayStr, t.id, t.name, result, expireStr]]);
  });

  if(ownerId){
    var s="[倉治整骨院] 本日の誕生日メッセージ"+nl+Utilities.formatDate(today,"Asia/Tokyo","M月d日")+nl+"送信:"+sentNames.length+"件";
    if(sentNames.length)s+=nl+"送信した人: "+sentNames.join(", ");
    if(skip.length)s+=nl+"未登録: "+skip.join(", ");
    sendLineMessagingAPI(token,ownerId,s);
  }
}
// kanri.html側から送信履歴を確認するためのAPI
function getBirthdayLog(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var log=ss.getSheetByName("birthday_log");
  if(!log) return {ok:true, list:[]};
  var data=log.getDataRange().getValues().slice(1);
  var list=data.map(function(r){return{date:String(r[0]||""), id:String(r[1]||""), name:String(r[2]||""), result:String(r[3]||""), expireUntil:String(r[4]||"")};});
  list.sort(function(a,b){return a.date<b.date?1:-1;}); // 新しい順
  return {ok:true, list:list};
}
// 指定した名前の患者に、実際の誕生日に関係なく誕生日メッセージのプレビューを送信する（文面確認用）
function sendBirthdayMessageTestTo(name){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN");
  if(!token) return {ok:false, error:"LINEトークンが未設定です"};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var nl=String.fromCharCode(10);
  var today=new Date();
  var expireDate=new Date(today.getFullYear(),today.getMonth(),today.getDate()+30);
  var todayDisp=Utilities.formatDate(today,"Asia/Tokyo","M月d日");
  var expireStr=Utilities.formatDate(expireDate,"Asia/Tokyo","M月d日");

  var target=String(name||"").trim();
  if(!target) return {ok:false, error:"名前を指定してください"};
  var tel=getTelByPatientName_(target);
  var tid=tel?findLineUidByPhone_(tel):"";
  if(!tid){
    var ls=ss.getSheetByName("LINE_IDs");
    if(ls){
      var lu={};
      ls.getDataRange().getValues().slice(1).forEach(function(r){if(r[0]&&r[1])lu[String(r[1]).trim()]=String(r[0]);});
      tid=lu[target];
      if(!tid){var ln=target.split(" ")[0].split("　")[0];var fk=Object.keys(lu).find(function(k){return k.replace(/[ 　]/g,"").indexOf(ln)===0;});if(fk)tid=lu[fk];}
    }
  }
  if(!tid) return {ok:false, error:target+"さんのLINE連携が見つかりませんでした"};
  var msg="【プレビュー送信】"+nl+"🎂 お誕生日おめでとうございます！"+nl+nl+target+"様"+nl+nl+"いつも倉治整骨院をご利用いただき、ありがとうございます。"+nl+nl+"日頃の感謝を込めて、次回ご来院時に使える"+nl+"【500円引きクーポン】をプレゼントいたします🎁"+nl+nl+"有効期限："+todayDisp+"〜"+expireStr+"まで"+nl+"(受付でこのメッセージをご提示ください)"+nl+nl+"素敵な1年になりますように😊"+nl+nl+"倉治整骨院";
  var r=sendLineMessagingAPI(token,tid,msg);
  return r.ok ? {ok:true} : {ok:false, error:"送信に失敗しました"};
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
    if(rows && rows.length){
      var rng=s.getRange(2,1,rows.length,6);
      rng.setNumberFormats(rows.map(function(){return ["@","@","@","@","@","@"];}));
      rng.setValues(rows);
    }
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
    if(rows && rows.length){
      var rng=s.getRange(2,1,rows.length,7);
      rng.setNumberFormats(rows.map(function(){return ["@","@","@","@","@","@","@"];}));
      rng.setValues(rows);
    }
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}
// 時刻セルがGoogleスプレッドシートによって日付型に自動変換されてしまった場合でも、
// "HH:MM"形式の文字列に安全に復元する
function toHHMM_(v){
  if(v===null||v===undefined||v==="") return "";
  if(Object.prototype.toString.call(v)==="[object Date]"){
    var h=v.getHours(),m=v.getMinutes();
    return (h<10?"0"+h:String(h))+":"+(m<10?"0"+m:String(m));
  }
  var s=String(v);
  var m2=s.match(/(\d{1,2}):(\d{2})/);
  if(m2) return (m2[1].length<2?"0"+m2[1]:m2[1])+":"+m2[2];
  return "";
}
function getBizHours(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var w=ss.getSheetByName("biz_hours_weekly");
  var o=ss.getSheetByName("biz_hours_override");
  var weekly=w?w.getDataRange().getValues().slice(1).map(function(r){
    return [r[0], r[1], toHHMM_(r[2]), toHHMM_(r[3]), toHHMM_(r[4]), toHHMM_(r[5])];
  }):[];
  var overrides=o?o.getDataRange().getValues().slice(1).map(function(r){
    return [r[0], r[1], toHHMM_(r[2]), toHHMM_(r[3]), toHHMM_(r[4]), toHHMM_(r[5]), r[6]];
  }):[];
  return { ok:true, weekly:weekly, overrides:overrides };
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
        return {closed:od[i][1]===true||od[i][1]==="TRUE", am:od[i][1]?null:[toHHMM_(od[i][2]),toHHMM_(od[i][3])], pm:od[i][1]?null:[toHHMM_(od[i][4]),toHHMM_(od[i][5])]};
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
        return {closed:closed, am:closed?null:[toHHMM_(wd[j][2]),toHHMM_(wd[j][3])], pm:closed?null:[toHHMM_(wd[j][4]),toHHMM_(wd[j][5])]};
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

    var todayStr=Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd");
    if(String(data.date)===todayStr) return {ok:false, error:"本日中のご予約はWebフォームでは受け付けておりません。お手数ですがLINEかお電話でご連絡ください。"};

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
      var newRowIdx=s.getLastRow()+1;
      var rng=s.getRange(newRowIdx,1,1,newRow.length);
      rng.setNumberFormat("@"); // テキスト形式を強制し、日付/時刻型への自動変換を防止
      rng.setValues([newRow]);
    });

    // 予約確認ページ(confirm.html)から電話番号で検索できるよう、別シートに控えを保存
    var meta=ss.getSheetByName("web_yoyaku_meta");
    if(!meta){ meta=ss.insertSheet("web_yoyaku_meta"); meta.getRange(1,1,1,7).setValues([["date","time","name","tel","email","menu","createdAt"]]); }
    var metaRow=[data.date, data.time, data.name||"", data.tel||"", data.email||"", data.menu||"", Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd HH:mm:ss")];
    var metaRowIdx=meta.getLastRow()+1;
    var metaRng=meta.getRange(metaRowIdx,1,1,metaRow.length);
    metaRng.setNumberFormat("@"); // テキスト形式を強制（電話番号の先頭0消失・日付自動変換を防止）
    metaRng.setValues([metaRow]);

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

// ★メール送信の権限をGoogleに許可させるためのテスト用関数★
// 上のプルダウンで「testSendMail」を選んで▶実行ボタンを押してください。
// 初回は「承認が必要です」という画面が出るので、ご自身のGoogleアカウントで許可してください。
// 許可が終われば、以後Web予約のメール確認が正常に送信されるようになります。
function testSendMail(){
  MailApp.sendEmail({
    to: Session.getActiveUser().getEmail(),
    subject: "【テスト】倉治整骨院システムからのメール送信テスト",
    body: "このメールが届いていれば、メール送信の設定は正常です。"
  });
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
// 指定した名前(前方一致)の予約を予約表からすべて削除する（テストデータの一括整理用）
function deleteBookingsByName(namePrefix){
  try{
    if(!namePrefix) return {ok:false, error:"名前を指定してください"};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("予約表");
    if(!s) return {ok:false, error:"予約表シートが見つかりません"};
    var data=s.getDataRange().getValues();
    var target=String(namePrefix).trim();
    var deleted=0;
    for(var i=data.length-1;i>=1;i--){
      var name=String(data[i][3]||"").trim();
      if(name && (name===target || name.indexOf(target)===0)){
        s.deleteRow(i+1);
        deleted++;
      }
    }
    return {ok:true, deleted:deleted};
  }catch(err){ return {ok:false, error:err.message}; }
}
