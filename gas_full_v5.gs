function doGet(e){
  var action=(e&&e.parameter&&e.parameter.action)||"getAll";
  var callback=(e&&e.parameter&&e.parameter.callback)||"";
  var result;
  try{if(action==="getAll"){result=getAllData();}else if(action==="getMenuMaster"){result=getMenuMaster();}else if(action==="lookupBooking"){result=lookupBooking((e&&e.parameter&&e.parameter.tel)||"");}else if(action==="getBizHours"){result=getBizHours();}else if(action==="getLineUsers"){result=getLineUsers();}else if(action==="getBirthdayLog"){result=getBirthdayLog();}else if(action==="getTriggerInfo"){result=getTriggerInfo();}else if(action==="getAvailableSlots"){result=getAvailableSlots((e&&e.parameter&&e.parameter.date)||"");}else if(action==="getDailyAlertLog"){result=getDailyAlertLog();}else if(action==="getReminderLog"){result=getReminderLog();}else if(action==="getWebBookingRequests"){result=getWebBookingRequests();}else if(action==="getAvailableSlotsRange"){result=getAvailableSlotsRange((e&&e.parameter&&e.parameter.startDate)||"",(e&&e.parameter&&e.parameter.numDays)||7);}else if(action==="getBlockedSlotsForDate"){result=getBlockedSlotsForDate((e&&e.parameter&&e.parameter.date)||"");}else if(action==="getMondoshinList"){result=getMondoshinList();}else if(action==="getMondoshinById"){result=getMondoshinById((e&&e.parameter&&e.parameter.rowIdx)||"");}else if(action==="getMondoshinKotsuList"){result=getMondoshinKotsuList();}else if(action==="getMondoshinKotsuById"){result=getMondoshinKotsuById((e&&e.parameter&&e.parameter.rowIdx)||"");}else if(action==="getAllBlockedSlotsDebug"){result=getAllBlockedSlotsDebug();}else if(action==="getKarteListByCardId"){result=getKarteListByCardId((e&&e.parameter&&e.parameter.cardId)||"");}else if(action==="getKarteById"){result=getKarteById((e&&e.parameter&&e.parameter.rowIdx)||"");}else if(action==="getDormantLog"){result=getDormantLog();}else if(action==="getPatientVisitStats"){result=getPatientVisitStats((e&&e.parameter&&e.parameter.cardId)||"",(e&&e.parameter&&e.parameter.name)||"");}else{result={ok:true};}}
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
            // ★LINE公式アカウントマネージャー側の「あいさつメッセージ」を使用しているため、
            //   ここでの自動送信はしない（重複して2通届いてしまうのを防ぐ）。
            //   Web予約経由の方への専用メッセージは、下の「message」イベント（お名前送信時）で対応する。
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
              // ★送られてきた文章が、Web予約リクエスト(未対応)の名前と一致するか確認する
              //   （Webフォームから送った方が、そのままフルネームだけ送ってきた場合の専用案内）
              var matchedReq=findPendingWebRequestByName_(msgText);
              if(matchedReq){
                // ★見つかったリクエストの電話番号を、このLINEアカウントに自動で紐付ける
                //   （これにより、前日リマインド等が電話番号経由で正しく届くようになる）
                if(matchedReq.tel) saveLinePhone_(uid,matchedReq.tel,dname||matchedReq.name);
                if(tok){
                  var nl2=String.fromCharCode(10);
                  var webMsg=matchedReq.name+"様、お名前を確認いたしました😊"+nl2+nl2+
                    "Web予約フォームからいただいたご希望内容をもとに、確定のご連絡を改めてこちらのLINEにお送りいたします。今しばらくお待ちください。"+nl2+nl2+
                    "🔶ご予約の変更・キャンセルについて"+nl2+
                    "ご予約の変更・キャンセルは、前日の診療時間内（20時）までにご連絡をお願いいたします。"+nl2+
                    "当日キャンセルやご連絡のないキャンセルが続いてしまった場合、次回以降のご予約を控えさせていただくことがございます。多くの方に気持ちよくご利用いただくため、ご理解・ご協力をお願いいたします🌿"+nl2+nl2+
                    "◆ご連絡方法"+nl2+
                    "📞 お電話：072-892-3223"+nl2+
                    "💬 このLINE公式アカウント"+nl2+nl2+
                    "ご不明な点がございましたら、お気軽にスタッフまでお声がけください🌿"+nl2+nl2+
                    "倉治整骨院";
                  sendLineMessagingAPI(tok,uid,webMsg);
                  var ownerId2=PropertiesService.getScriptProperties().getProperty("LINE_USER_ID");
                  if(ownerId2)sendLineMessagingAPI(tok,ownerId2,"[倉治整骨院] 📩 Web予約リクエスト済みの"+matchedReq.name+"様が、LINEでお名前を送ってこられました。予約確定のご連絡をお願いします。");
                }
                markPromptSent_(uid);
              }else if(tok && !hasPromptSent_(uid) && !findPhoneByUid_(uid)){
                // 案内メッセージは友だち1人につき1回だけ送信（すでに送信済み・登録済みの方には送らない）
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
      else if(action==="saveCustomers"){saveCustomersSafe(JSON.parse(body.rows));result={ok:true};}
      else if(action==="saveUriage"){saveSheet("売上",JSON.parse(body.rows));result={ok:true};}
      else if(action==="resetBookings"){resetBookings();result={ok:true};}
      else if(action==="lineNotifyV2")result=sendLineMessagingAPI(body.token,body.userId,body.message);
      else if(action==="saveLineSettings"){saveLineSettings();result={ok:true};}
      else if(action==="getLineUsers")result=getLineUsers();
      else if(action==="saveWebBooking")result=saveWebBooking(body.data);
      else if(action==="saveWebBookingRequest")result=saveWebBookingRequest(body.data);
      else if(action==="getWebBookingRequests")result=getWebBookingRequests();
      else if(action==="updateWebBookingRequestStatus")result=updateWebBookingRequestStatus(body.rowIdx,body.status);
      else if(action==="deleteWebBookingRequest")result=deleteWebBookingRequest(body.rowIdx);
      else if(action==="deleteMondoshin")result=deleteMondoshin(body.rowIdx);
      else if(action==="deleteMondoshinKotsu")result=deleteMondoshinKotsu(body.rowIdx);
      else if(action==="toggleBlockedSlot")result=toggleBlockedSlot(body.date,body.time,body.block);
      else if(action==="sendTestEmailTo")result=sendTestEmailTo(body.email);
      else if(action==="saveKarte")result=saveKarte(body.data);
      else if(action==="deleteKarte")result=deleteKarte(body.rowIdx);
      else if(action==="runDormantOutreachNow"){sendDormantPatientOutreach();result={ok:true};}
      else if(action==="runPointsMilestoneNow"){sendPointsMilestone();result={ok:true};}
      else if(action==="sendDormantOutreachTestTo")result=sendDormantOutreachTestTo(body.name);
      else if(action==="sendPointsMilestoneTestTo")result=sendPointsMilestoneTestTo(body.name);
      else if(action==="sendWebLineGreetingPreviewTo")result=sendWebLineGreetingPreviewTo(body.name);
      else if(action==="saveMondoshin")result=saveMondoshin(body.data);
      else if(action==="saveMondoshinKotsu")result=saveMondoshinKotsu(body.data);
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
      else if(action==="sendReminderToOne")result=sendReminderToOne(body.name,body.dateStr);
      else if(action==="runBirthdayMessagesNow"){sendBirthdayMessages();result={ok:true};}
      else if(action==="getBirthdayLog")result=getBirthdayLog();
      else if(action==="sendBirthdayMessageTestTo")result=sendBirthdayMessageTestTo(body.name);
      else if(action==="getTriggerInfo")result=getTriggerInfo();
      else if(action==="deleteTriggerByName")result=deleteTriggerByName(body.funcName);
      else if(action==="runReviewRequestsNow"){sendReviewRequests();result={ok:true};}
      else if(action==="setGoogleReviewUrl")result=setGoogleReviewUrlFromApp(body.url);
      else if(action==="getGoogleReviewUrl")result=getGoogleReviewUrl();
      else if(action==="sendReviewRequestTestTo")result=sendReviewRequestTestTo(body.name);
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
    if(data[i][0]===userId){
      // ★名前は「まだ未登録の場合」だけLINEの表示名で入れる。既に名前がある場合は絶対に上書きしない
      //   （院内で漢字フルネームなどに手動修正した名前が、LINE側のあだ名で毎回上書きされてしまう不具合の対策）
      var nameToSave = String(data[i][1]||"").trim() ? data[i][1] : (displayName||data[i][1]);
      s.getRange(i+1,2,1,3).setValues([[nameToSave,message,now]]);return;
    }
  }
  s.appendRow([userId,displayName,message,now,""]);
}
// 電話番号でLINE友だちを紐付け（表示名があだ名でも確実に照合できる）
// ★LINE登録時、送られてきたメッセージがWeb予約リクエスト(未対応)のお名前と一致するか探す★
// 一致した場合、そのリクエストに書かれていた電話番号をこのLINEアカウントに自動で紐付ける
// （フルネームを送るだけで、電話番号を別途送らなくても前日リマインド等が届くようにするため）
// 名前の表記ゆれ（スペースの有無・全角半角・大文字小文字）を吸収して比較できるようにする
function normalizeName_(s){
  return String(s||"").trim()
    .normalize("NFKC") // 全角英数字→半角、半角カナ→全角カナ 等に統一
    .replace(/[\s　]+/g,"") // 半角・全角スペースを全て除去
    .toLowerCase(); // 大文字小文字を統一
}
function findPendingWebRequestByName_(msgText){
  try{
    var target=normalizeName_(msgText);
    if(!target) return null;
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("web_yoyaku_requests");
    if(!s) return null;
    var data=s.getDataRange().getValues();
    // 直近7日以内・未対応のリクエストの中から、名前が完全一致するものを探す
    var cutoff=new Date(); cutoff.setDate(cutoff.getDate()-7);
    for(var i=data.length-1;i>=1;i--){
      var status=String(data[i][11]||"未対応");
      if(status!=="未対応") continue;
      var createdAt=new Date(String(data[i][12]||""));
      if(!isNaN(createdAt.getTime()) && createdAt<cutoff) continue;
      var name=normalizeName_(data[i][6]);
      if(name && name===target){
        return {rowIdx:i+1, name:String(data[i][6]||"").trim(), tel:String(data[i][7]||"")};
      }
    }
    return null;
  }catch(err){ return null; }
}
function saveLinePhone_(userId,phoneDigits,displayName){
  // ★念のための多層防御：9〜11桁以外の明らかにおかしいデータは保存しない
  var pd=String(phoneDigits||"").replace(/[^0-9]/g,"");
  if(pd.length<9||pd.length>11) return;
  phoneDigits=pd;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("LINE_IDs");
  if(!s){s=ss.insertSheet("LINE_IDs");s.getRange(1,1,1,5).setValues([["userId","name","lastMsg","updated","phone"]]);}
  var data=s.getDataRange().getValues();
  var now=new Date();
  for(var i=1;i<data.length;i++){
    if(data[i][0]===userId){
      // ★同上：既に名前が登録されている場合はLINEの表示名で上書きしない
      var nameToSave = String(data[i][1]||"").trim() ? data[i][1] : (displayName||data[i][1]);
      var rng1=s.getRange(i+1,2,1,4);
      rng1.setNumberFormat("@");
      rng1.setValues([[nameToSave,"(電話番号登録)",now,phoneDigits]]);
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
    var phoneDigitsRaw=String(phone||'').replace(/[^0-9]/g,'');
    // ★電話番号として明らかにおかしい桁数（日時などが紛れ込んだデータ）は保存しない安全装置
    var phoneDigits = (phoneDigitsRaw.length>=9 && phoneDigitsRaw.length<=11) ? phoneDigitsRaw : (phoneDigitsRaw==='' ? '' : null);
    if(phoneDigits===null) return {ok:false, error:'電話番号の桁数が不正です（9〜11桁で入力してください）: '+phoneDigitsRaw};
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
// ★患者データ専用：安全な差分マージ保存★
// 「空欄で送られてきた項目で、既存データを上書きして消してしまう」事故を防ぐため、
// 診察券No(1列目)をキーに、送られてきた値が空の項目は既存のサーバー側の値を残す方式にする。
// また、今回の同期に含まれていなかった患者（別端末でまだ読み込み中など）も削除せず残す。
function saveCustomersSafe(rows){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("患者");
  var existing=s?s.getDataRange().getValues():[];
  var header=(existing.length?existing[0]:(rows.length?rows[0]:[]));
  var existingById={};
  for(var i=1;i<existing.length;i++){
    var id=String(existing[i][0]||"").trim();
    if(id) existingById[id]=existing[i];
  }
  var merged=[header];
  var seenIds={};
  for(var j=1;j<rows.length;j++){
    var incoming=rows[j];
    var id=String(incoming[0]||"").trim();
    if(!id) continue;
    seenIds[id]=true;
    var base=existingById[id];
    var mergedRow=incoming.map(function(val,colIdx){
      var v=(val===null||val===undefined)?"":String(val).trim();
      if(v!=="") return val; // 新しい値が入っていればそちらを優先
      if(base && base[colIdx]!==undefined && String(base[colIdx]).trim()!=="") return base[colIdx]; // 空なら既存データを残す（消さない）
      return val;
    });
    merged.push(mergedRow);
  }
  // 今回の同期に含まれなかった既存患者はそのまま保持する（削除しない）
  Object.keys(existingById).forEach(function(id){
    if(!seenIds[id]) merged.push(existingById[id]);
  });
  saveSheet("患者", merged);
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
          if(r[1])alertOffNames[String(r[1]).trim().replace(/[\s　]+/g,"")]=true;
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
        var nm=String(r[ni]||"").trim();
        if(!nm)return;
        // ★キーは必ず「患者名」に統一する（診察券Noが空の行があると来院履歴が分断されてしまう不具合の対策）
        // ★さらに、全角/半角スペース・スペースの数など表記ゆれがあっても同一人物として扱う（キーのみ正規化。表示名は元の表記を保持）
        var key=nm.replace(/[\s　]+/g,"");
        var idVal=String(r[ii]||"").trim();
        if(!lv[key] || d>lv[key].date){
          lv[key]={date:d, name:nm, id:idVal||(lv[key]?lv[key].id:"")};
        }else if(!lv[key].id && idVal){
          lv[key].id=idVal; // 診察券Noが後から分かった場合は補完する
        }
      });
      Object.values(lv).forEach(function(v){
        if(alertOffIds[v.id]||alertOffNames[String(v.name).replace(/[\s　]+/g,"")])return; // アラート対象外の患者はスキップ
        var diff=Math.floor((today-v.date)/(1000*60*60*24));
        if(diff>=18&&diff<=19)alerts.push({name:v.name,id:v.id,date:v.date,diff:diff,type:"warning"});
        if(diff>=21&&diff<=22)alerts.push({name:v.name,id:v.id,date:v.date,diff:diff,type:"urgent"});
      });
    }
  }
  if(!alerts.length){Logger.log("No alert today");return;}
  var urgent=alerts.filter(function(v){return v.type==="urgent";});
  var warning=alerts.filter(function(v){return v.type==="warning";});

  // 履歴シート（無ければ作成）：誰が・いつ・どの区分で対象になったかを必ず記録として残す
  var log=ss.getSheetByName("alert_log");
  if(!log){ log=ss.insertSheet("alert_log"); log.getRange(1,1,1,6).setValues([["date","time","name","id","type","note"]]); }
  var nowStr=Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd HH:mm:ss");
  var todayStr2=Utilities.formatDate(today,"Asia/Tokyo","yyyy-MM-dd");
  var logRows=alerts.map(function(v){return [todayStr2, nowStr, v.name, v.id, v.type==="urgent"?"21日経過":"18日経過", "LINE送信は現在停止中"];});
  var logIdx=log.getLastRow()+1;
  var logRng=log.getRange(logIdx,1,logRows.length,6);
  logRng.setNumberFormat("@");
  logRng.setValues(logRows);

  // ★現在、除外設定の不具合調査のためLINE送信を一時停止中★
  // （対象者は上記の通りalert_logシートに記録される。院長への送信も含め、一切送信しない）
  Logger.log("Alert計算のみ実施・送信は停止中: "+alerts.length+"件をalert_logに記録");
  return;
  /*
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
        var ln=v.name.split(" ")[0].split("　")[0];
        var fk=Object.keys(lu).find(function(k){return k.replace(/[ 　]/g,"").indexOf(ln)===0;});
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
  Logger.log("Alert done");
}
// 指定した名前・日付の患者様に、個別に前日リマインドを手動で送る
// （自動送信が何らかの理由で漏れてしまった時、その場で個別にフォローするための機能）
function sendReminderToOne(name, dateStr){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN");
  if(!token) return {ok:false, error:"LINEトークンが未設定です"};
  var target=String(name||"").trim();
  if(!target || !dateStr) return {ok:false, error:"名前・日付を指定してください"};

  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var bs=ss.getSheetByName("予約表");
  if(!bs) return {ok:false, error:"予約表シートが見つかりません"};
  var bd=bs.getDataRange().getValues(),bh=bd[0];
  var di=bh.indexOf("日付"),ti=bh.indexOf("時間"),ni=bh.indexOf("患者名"),ki=bh.indexOf("区分");
  var times=[];
  bd.slice(1).forEach(function(r){
    var rawDate=r[di];
    var dv=(rawDate instanceof Date)?Utilities.formatDate(rawDate,"Asia/Tokyo","yyyy-MM-dd"):String(rawDate||"").trim();
    var k=String(r[ki]||"");
    if(k.indexOf("継続")>-1||k.indexOf("キャンセル")>-1||dv!==dateStr)return;
    var n=String(r[ni]||"").trim();
    if(n.replace(/[\s　]+/g,"")!==target.replace(/[\s　]+/g,""))return;
    var t=String(r[ti]||"").trim();
    if(t)times.push(t);
  });
  if(!times.length) return {ok:false, error:target+"様の"+dateStr+"のご予約が見つかりませんでした"};

  var tid="";
  var tel=getTelByPatientName_(target);
  if(tel) tid=findLineUidByPhone_(tel);
  if(!tid){
    var ls=ss.getSheetByName("LINE_IDs");
    if(ls){
      var lu={};
      ls.getDataRange().getValues().slice(1).forEach(function(r){if(r[0]&&r[1])lu[String(r[1]).trim()]=String(r[0]);});
      tid=lu[target];
      if(!tid){var ln=target.split(" ")[0].split("　")[0];var fk=Object.keys(lu).find(function(k){return k.replace(/[ 　]/g,"").indexOf(ln)===0;});if(fk)tid=lu[fk];}
    }
  }
  if(!tid) return {ok:false, error:target+"様のLINE連携が見つかりませんでした（電話番号登録がお済みでない可能性があります）"};

  var nl=String.fromCharCode(10);
  var dispDate=Utilities.formatDate(new Date(dateStr+"T00:00:00"),"Asia/Tokyo","M月d日(E)");
  var msg="🔔 ご予約リマインド"+nl+nl+"━━━━━━━━━━"+nl+"📅 "+dispDate+nl+"⏰ "+times.join("・")+nl+"━━━━━━━━━━"+nl+nl+"ご予約が近づいてまいりました。"+nl+"お気をつけてお越しくださいませ😊"+nl+nl+"倉治整骨院"+nl+"(このメッセージへの返信は不要です)";
  var r=sendLineMessagingAPI(token,tid,msg);
  if(!r.ok) return {ok:false, error:"送信に失敗しました"};

  var log=ss.getSheetByName("reminder_log");
  if(!log){ log=ss.insertSheet("reminder_log"); log.getRange(1,1,1,6).setValues([["date","time","name","targetDate","result","note"]]); }
  var nowStr=Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd HH:mm:ss");
  var todayStr4=Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd");
  var newIdx=log.getLastRow()+1;
  var rng=log.getRange(newIdx,1,1,6);
  rng.setNumberFormat("@");
  rng.setValues([[todayStr4, nowStr, target, dateStr, "送信済み(個別手動送信)", times.join("・")]]);
  return {ok:true};
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
      if(!tid){var ln=name.split(" ")[0].split("　")[0];var fk=Object.keys(lu).find(function(k){return k.replace(/[ 　]/g,"").indexOf(ln)===0;});if(fk)tid=lu[fk];}
    }
    if(!tid){skip.push(name);return;}
    var msg=(testModeName?"【テスト送信】"+nl:"")+"🔔 ご予約リマインド"+nl+nl+"━━━━━━━━━━"+nl+"📅 "+tmrDisp+nl+"⏰ "+bp[name].join("・")+nl+"━━━━━━━━━━"+nl+nl+"明日のご予約が近づいてまいりました。"+nl+"お気をつけてお越しくださいませ😊"+nl+nl+"倉治整骨院"+nl+"(このメッセージへの返信は不要です)";
    if(sendLineMessagingAPI(token,tid,msg).ok){sent++;sentNames.push(name);}else{skip.push(name);}
  });

  // 履歴シート（無ければ作成）：誰に・いつ・送れたかどうかを必ず記録として残す
  var log=ss.getSheetByName("reminder_log");
  if(!log){ log=ss.insertSheet("reminder_log"); log.getRange(1,1,1,6).setValues([["date","time","name","targetDate","result","note"]]); }
  var nowStr=Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd HH:mm:ss");
  var todayStr3=Utilities.formatDate(today,"Asia/Tokyo","yyyy-MM-dd");
  var logRows=Object.keys(bp).map(function(name){
    var isSent=sentNames.indexOf(name)>-1;
    return [todayStr3, nowStr, name, tmrStr, isSent?"送信済み":"未登録(LINE連携なし)", bp[name].join("・")];
  });
  if(logRows.length){
    var logIdx=log.getLastRow()+1;
    var logRng=log.getRange(logIdx,1,logRows.length,6);
    logRng.setNumberFormat("@");
    logRng.setValues(logRows);
  }

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
  ScriptApp.newTrigger("dailyLineAlert").timeBased().everyDays(1).atHour(9).nearMinute(0).create();
  ScriptApp.newTrigger("sendDayBeforeReminders").timeBased().everyDays(1).atHour(19).nearMinute(0).create();
  ScriptApp.newTrigger("sendBirthdayMessages").timeBased().everyDays(1).atHour(9).nearMinute(0).create();
  Logger.log("Triggers set OK");
}
// 今設定されているトリガーを一覧で確認する（kanri.htmlから呼び出し、重複や設定漏れがないか診断する）
function getTriggerInfo(){
  var triggers=ScriptApp.getProjectTriggers();
  var list=triggers.map(function(t){
    return { handler: t.getHandlerFunction(), type: String(t.getEventType()) };
  });
  return { ok:true, count: list.length, list: list };
}
// ボタン1つで指定した関数のトリガーを自動で見つけて削除する（Apps Script画面を探し回らなくて済むようにするため）
function deleteTriggerByName(funcName){
  if(!funcName) return {ok:false, error:"関数名が指定されていません"};
  var triggers=ScriptApp.getProjectTriggers();
  var deleted=0;
  triggers.forEach(function(t){
    if(t.getHandlerFunction()===funcName){
      ScriptApp.deleteTrigger(t);
      deleted++;
    }
  });
  return {ok:true, deleted:deleted};
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
  if(telI<0)telI=4;

  // ★安全装置：「生年月日」「誕生日クーポン送信」の列が見つからない場合は、
  //   誤った列を見てしまう危険を避けるため、誰にも送らず院長に不具合を通知して終了する
  if(dobI<0){
    if(ownerId)sendLineMessagingAPI(token,ownerId,"[倉治整骨院] 誕生日メッセージを送ろうとしましたが、「生年月日」の列が見つからないため、安全のため送信を中止しました。管理システムの同期状態を確認してください。");
    return;
  }
  if(bsI<0){
    if(ownerId)sendLineMessagingAPI(token,ownerId,"[倉治整骨院] 誕生日メッセージを送ろうとしましたが、「誕生日クーポン送信」の列が見つからないため、安全のため送信を中止しました。管理システムの同期状態を確認してください。");
    return;
  }

  // ★除外された「非対象者」も分かるよう、対象と非対象の両方を記録する
  var targets=[], excludedList=[];
  for(var i=1;i<data.length;i++){
    var dob=String(data[i][dobI]||"").trim();
    var m=dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) continue; // 生年月日が正しい形式で入っていない行は対象外（誤爆防止）
    if(parseInt(m[2])===mm && parseInt(m[3])===dd){
      var nm=String(data[i][nameI]||"").trim();
      if(String(data[i][bsI]||"").toUpperCase()==="FALSE"){ excludedList.push(nm); continue; } // 対象外の患者は非対象リストへ
      targets.push({id:String(data[i][idI]||""), name:nm, tel:String(data[i][telI]||"")});
    }
  }
  if(!targets.length && !excludedList.length) return;

  var expireDate=new Date(today.getFullYear(),today.getMonth(),today.getDate()+30);
  var todayDisp=Utilities.formatDate(today,"Asia/Tokyo","M月d日");
  var expireStr=Utilities.formatDate(expireDate,"Asia/Tokyo","M月d日");
  var todayStr=Utilities.formatDate(today,"Asia/Tokyo","yyyy-MM-dd");

  // 送信履歴シート（無ければ作成）
  var log=ss.getSheetByName("birthday_log");
  if(!log){ log=ss.insertSheet("birthday_log"); log.getRange(1,1,1,5).setValues([["date","id","name","result","expireUntil"]]); }

  // ★現在は検証期間中：患者様には一切送らず、「本来送るはずだったメッセージ」を
  //   丸ごと院長のLINEにだけ転送する。除外された非対象者もあわせて報告する。
  //   問題なければ院長の判断でこの検証モードを解除し、実際の送信に戻す。
  if(ownerId){
    var report="[倉治整骨院] 🎂 誕生日メッセージ 検証結果 "+todayDisp+nl+"（現在は検証中のため、患者様には送信されていません）"+nl;
    if(targets.length){
      report+=nl+"■ 本来メッセージが届くはずだった方（"+targets.length+"名）"+nl;
      targets.forEach(function(t){
        report+="・"+t.name+nl;
      });
      report+=nl+"【送るはずだった文面】"+nl+"🎂 お誕生日おめでとうございます！"+nl+nl+"（お名前）様"+nl+nl+"いつも倉治整骨院をご利用いただき、ありがとうございます。"+nl+nl+"日頃の感謝を込めて、次回ご来院時に使える"+nl+"【500円引きクーポン】をプレゼントいたします🎁"+nl+nl+"有効期限："+todayDisp+"〜"+expireStr+"まで"+nl+"(受付でこのメッセージをご提示ください)"+nl+nl+"素敵な1年になりますように😊"+nl+nl+"倉治整骨院";
    }
    if(excludedList.length){
      report+=nl+nl+"■ 対象外設定により除外された方（"+excludedList.length+"名）"+nl;
      excludedList.forEach(function(nm){ report+="・"+nm+nl; });
    }
    sendLineMessagingAPI(token,ownerId,report);
  }
  // 履歴シートには「検証のみ・患者には未送信」として記録する
  targets.forEach(function(t){
    var newIdx=log.getLastRow()+1;
    var rng=log.getRange(newIdx,1,1,5);
    rng.setNumberFormat("@");
    rng.setValues([[todayStr, t.id, t.name, "検証送信(院長のみ・患者未送信)", expireStr]]);
  });
  excludedList.forEach(function(nm){
    var newIdx=log.getLastRow()+1;
    var rng=log.getRange(newIdx,1,1,5);
    rng.setNumberFormat("@");
    rng.setValues([[todayStr, "", nm, "対象外設定によりスキップ", ""]]);
  });
  return;
  // ↓↓↓ 検証モードが解除されたら、以下の実送信コードが有効になる ↓↓↓

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
// kanri.html側から前日リマインドの送信履歴を確認するためのAPI
function getReminderLog(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var log=ss.getSheetByName("reminder_log");
  if(!log) return {ok:true, list:[]};
  var data=log.getDataRange().getValues().slice(1);
  var list=data.map(function(r){return{date:String(r[0]||""), time:String(r[1]||""), name:String(r[2]||""), targetDate:String(r[3]||""), result:String(r[4]||""), note:String(r[5]||"")};});
  list.sort(function(a,b){return (a.date+a.time)<(b.date+b.time)?1:-1;}); // 新しい順
  return {ok:true, list:list};
}
// kanri.html側から17日/20日アラートの対象履歴を確認するためのAPI
function getDailyAlertLog(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var log=ss.getSheetByName("alert_log");
  if(!log) return {ok:true, list:[]};
  var data=log.getDataRange().getValues().slice(1);
  var list=data.map(function(r){return{date:String(r[0]||""), time:String(r[1]||""), name:String(r[2]||""), id:String(r[3]||""), type:String(r[4]||""), note:String(r[5]||"")};});
  list.sort(function(a,b){return (a.date+a.time)<(b.date+b.time)?1:-1;}); // 新しい順
  return {ok:true, list:list};
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
// 「Web予約経由の方向け」返信メッセージのプレビューを、指定した相手（通常は院長）に送る
function sendWebLineGreetingPreviewTo(name){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN");
  if(!token) return {ok:false, error:"LINEトークンが未設定です"};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var nl=String.fromCharCode(10);
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
  // ★「郡」宛てで名前が見つからない場合は、必ず届く院長のLINE(オーナーID)に送る
  if(!tid && (target==="郡"||target==="郡雄一朗")){
    tid=p.getProperty("LINE_USER_ID")||"";
  }
  if(!tid) return {ok:false, error:target+"さんのLINE連携が見つかりませんでした"};
  var webMsg="【プレビュー送信：Web予約経由の方への返信文】"+nl+nl+
    target+"様、お名前を確認いたしました😊"+nl+nl+
    "Web予約フォームからいただいたご希望内容をもとに、確定のご連絡を改めてこちらのLINEにお送りいたします。今しばらくお待ちください。"+nl+nl+
    "🔶ご予約の変更・キャンセルについて"+nl+
    "ご予約の変更・キャンセルは、前日の診療時間内（20時）までにご連絡をお願いいたします。"+nl+
    "当日キャンセルやご連絡のないキャンセルが続いてしまった場合、次回以降のご予約を控えさせていただくことがございます。多くの方に気持ちよくご利用いただくため、ご理解・ご協力をお願いいたします🌿"+nl+nl+
    "◆ご連絡方法"+nl+
    "📞 お電話：072-892-3223"+nl+
    "💬 このLINE公式アカウント"+nl+nl+
    "ご不明な点がございましたら、お気軽にスタッフまでお声がけください🌿"+nl+nl+
    "倉治整骨院";
  var r=sendLineMessagingAPI(token,tid,webMsg);
  return r.ok ? {ok:true} : {ok:false, error:r.error||"送信に失敗しました"};
}
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
  return r.ok ? {ok:true} : {ok:false, error:r.error||"送信に失敗しました"};
}

// ═══════════════════════════════════════
// ★口コミ依頼の自動送信（まだ運用開始していません。setupAllTriggersには含めていないため、
//   手動で runReviewRequestsNow を実行するかテストする以外は動きません）★
// ═══════════════════════════════════════
// 通院回数が指定回数（デフォルト3回目）に達した患者に、Googleクチコミ依頼のLINEを1回だけ送信する
function sendReviewRequests(){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
  if(!token)return;
  var reviewUrl=p.getProperty("GOOGLE_REVIEW_URL")||"";
  if(!reviewUrl){ if(ownerId)sendLineMessagingAPI(token,ownerId,"[倉治整骨院] 口コミ依頼を送ろうとしましたが、GoogleクチコミのURLが未設定のため中止しました。「setReviewUrl」関数で設定してください。"); return; }
  var targetCount=parseInt(p.getProperty("REVIEW_TARGET_COUNT")||"3"); // 何回目の来院で送るか（デフォルト3回目）

  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var ps=ss.getSheetByName("患者");
  if(!ps)return;
  var nl=String.fromCharCode(10);
  var data=ps.getDataRange().getValues();
  var headers=data[0].map(function(h){return String(h||"").trim();});
  var idI=0, nameI=1, telI=headers.indexOf("電話番号"), countI=headers.indexOf("通院回数");
  var reqI=headers.indexOf("口コミ依頼済み"), revOffI=headers.indexOf("口コミ依頼送信");
  if(telI<0)telI=4; if(countI<0)countI=12;

  var targets=[];
  for(var i=1;i<data.length;i++){
    var cnt=parseInt(data[i][countI])||0;
    if(cnt!==targetCount) continue; // ちょうどその回数になった日だけ対象（毎日既存患者全員に送らないため）
    if(revOffI>-1 && String(data[i][revOffI]||"").toUpperCase()==="FALSE") continue; // 対象外設定の患者はスキップ
    if(reqI>-1 && String(data[i][reqI]||"").toUpperCase()==="TRUE") continue; // 送信済みはスキップ
    targets.push({rowIdx:i+1, id:String(data[i][idI]||""), name:String(data[i][nameI]||"").trim(), tel:String(data[i][telI]||"")});
  }
  if(!targets.length) return;

  if(reqI<0){
    reqI = headers.length;
    ps.getRange(1, reqI+1).setValue("口コミ依頼済み");
  }

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
    if(!tid){skip.push(t.name);return;}
    var msg="いつも倉治整骨院をご利用いただき、ありがとうございます😊"+nl+nl+t.name+"様には"+targetCount+"回目のご来院をいただきました。"+nl+nl+"もしよろしければ、今後の励みになりますので"+nl+"Googleクチコミへのご協力をお願いできますと大変嬉しいです🙏"+nl+nl+reviewUrl+nl+nl+"(1分ほどで完了します。ご協力いただける方のみで構いません)"+nl+nl+"倉治整骨院";
    if(sendLineMessagingAPI(token,tid,msg).ok){
      sentNames.push(t.name);
      var rngC=ps.getRange(t.rowIdx, reqI+1);
      rngC.setNumberFormat("@");
      rngC.setValue("TRUE");
    }else{skip.push(t.name);}
  });

  if(ownerId){
    var s="[倉治整骨院] 口コミ依頼メッセージ送信結果"+nl+"送信:"+sentNames.length+"件";
    if(sentNames.length)s+=nl+"送信した人: "+sentNames.join(", ");
    if(skip.length)s+=nl+"未登録: "+skip.join(", ");
    sendLineMessagingAPI(token,ownerId,s);
  }
}
// 指定した名前の患者に、実際の通院回数に関係なく口コミ依頼メッセージのプレビューを送信する（文面確認用）
function sendReviewRequestTestTo(name){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN");
  if(!token) return {ok:false, error:"LINEトークンが未設定です"};
  var reviewUrl=p.getProperty("GOOGLE_REVIEW_URL")||"";
  if(!reviewUrl) return {ok:false, error:"GoogleクチコミのURLが未設定です"};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var nl=String.fromCharCode(10);

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
  var msg="【プレビュー送信】"+nl+"いつも倉治整骨院をご利用いただき、ありがとうございます😊"+nl+nl+target+"様には3回目のご来院をいただきました。"+nl+nl+"もしよろしければ、今後の励みになりますので"+nl+"Googleクチコミへのご協力をお願いできますと大変嬉しいです🙏"+nl+nl+reviewUrl+nl+nl+"(1分ほどで完了します。ご協力いただける方のみで構いません)"+nl+nl+"倉治整骨院";
  var r=sendLineMessagingAPI(token,tid,msg);
  return r.ok ? {ok:true} : {ok:false, error:r.error||"送信に失敗しました"};
}
// GoogleクチコミのURLを設定する（Apps Scriptエディタから手動で1回だけ実行）
// 例: setReviewUrlの中のURLを実際のクチコミURLに書き換えてから実行してください
// ═══════════════════════════════════════
// ★休眠患者への再来促進配信（まだ自動送信トリガーには含めていません。
//   kanri.htmlから手動テスト実行のみ可能な状態です）★
// ═══════════════════════════════════════
// 前回来院から一定期間（デフォルト90日）経った患者様に、再来を促すLINEを送る
// 同じ人に何度も送らないよう、直近60日以内に送信済みの場合はスキップする
function sendDormantPatientOutreach(){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
  if(!token)return;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var today=new Date();today.setHours(0,0,0,0);
  var nl=String.fromCharCode(10);
  var DORMANT_DAYS=90; // 何日来院がなければ「休眠」とみなすか
  var COOLDOWN_DAYS=60; // 一度送ったら何日は再送しないか

  // 患者ごとの除外設定を確認
  var ps=ss.getSheetByName("患者");
  var offIds={}, offNames={};
  if(ps){
    var pd=ps.getDataRange().getValues(), ph=pd[0].map(function(h){return String(h||"").trim();});
    var offI=ph.indexOf("休眠促進送信");
    if(offI>-1){
      pd.slice(1).forEach(function(r){
        if(String(r[offI]||"").toUpperCase()==="FALSE"){
          if(r[0])offIds[String(r[0]).trim()]=true;
          if(r[1])offNames[String(r[1]).trim().replace(/[\s　]+/g,"")]=true;
        }
      });
    }
  }

  // 患者ごとの最終来院日を計算（17日/20日アラートと同じロジック）
  var bs=ss.getSheetByName("予約表");
  if(!bs)return;
  var bd=bs.getDataRange().getValues(),bh=bd[0];
  var di=bh.indexOf("日付"),ni=bh.indexOf("患者名"),ii=bh.indexOf("診察券No"),ki=bh.indexOf("区分");
  if(di<0)return;
  var lv={};
  bd.slice(1).forEach(function(r){
    var k=String(r[ki]||"");
    if(k.indexOf("継続")>-1||k.indexOf("キャンセル")>-1)return;
    var dv=r[di];if(!dv)return;
    var d=dv instanceof Date?new Date(dv):new Date(String(dv));
    if(isNaN(d.getTime()))return;
    d.setHours(0,0,0,0);if(d>today)return;
    var nm=String(r[ni]||"").trim();
    if(!nm)return;
    var key=nm.replace(/[\s　]+/g,"");
    var idVal=String(r[ii]||"").trim();
    if(!lv[key] || d>lv[key].date){
      lv[key]={date:d, name:nm, id:idVal||(lv[key]?lv[key].id:"")};
    }else if(!lv[key].id && idVal){
      lv[key].id=idVal;
    }
  });

  // 直近送信履歴（クールダウン判定用）
  var log=ss.getSheetByName("dormant_log");
  if(!log){ log=ss.insertSheet("dormant_log"); log.getRange(1,1,1,4).setValues([["date","id","name","result"]]); }
  var logData=log.getDataRange().getValues();
  var lastSentByKey={};
  for(var li=1;li<logData.length;li++){
    var lname=String(logData[li][2]||"").replace(/[\s　]+/g,"");
    var ldate=new Date(String(logData[li][0]));
    if(isNaN(ldate.getTime()))continue;
    if(!lastSentByKey[lname]||ldate>lastSentByKey[lname]) lastSentByKey[lname]=ldate;
  }

  var targets=[];
  Object.values(lv).forEach(function(v){
    var key=String(v.name).replace(/[\s　]+/g,"");
    if(offIds[v.id]||offNames[key])return; // 除外設定の患者はスキップ
    var diff=Math.floor((today-v.date)/(1000*60*60*24));
    if(diff<DORMANT_DAYS)return;
    var lastSent=lastSentByKey[key];
    if(lastSent){
      var sinceSent=Math.floor((today-lastSent)/(1000*60*60*24));
      if(sinceSent<COOLDOWN_DAYS)return; // クールダウン期間中はスキップ
    }
    targets.push(v);
  });
  if(!targets.length)return;

  var todayStr=Utilities.formatDate(today,"Asia/Tokyo","yyyy-MM-dd");
  var sentNames=[], skip=[];
  targets.forEach(function(v){
    var tid="";
    var tel=getTelByPatientName_(v.name);
    if(tel) tid=findLineUidByPhone_(tel);
    if(!tid){
      var ls=ss.getSheetByName("LINE_IDs");
      if(ls){
        var lu={};
        ls.getDataRange().getValues().slice(1).forEach(function(r){if(r[0]&&r[1])lu[String(r[1]).trim()]=String(r[0]);});
        tid=lu[v.name];
        if(!tid){var ln=v.name.split(" ")[0].split("　")[0];var fk=Object.keys(lu).find(function(k){return k.replace(/[ 　]/g,"").indexOf(ln)===0;});if(fk)tid=lu[fk];}
      }
    }
    var result;
    if(!tid){skip.push(v.name);result="未登録";}
    else{
      var msg="いつも倉治整骨院をご利用いただき、ありがとうございます😊"+nl+nl+v.name+"様"+nl+nl+"しばらくご来院がないようですが、その後お体の調子はいかがでしょうか？"+nl+nl+"また気になる症状がございましたら、いつでもお気軽にお越しください。"+nl+"皆様のご来院をお待ちしております。"+nl+nl+"ご予約はこのLINEでどうぞ。"+nl+"(自動送信のため返信不要です)";
      if(sendLineMessagingAPI(token,tid,msg).ok){sentNames.push(v.name);result="送信済み";}else{skip.push(v.name);result="送信失敗";}
    }
    var newIdx=log.getLastRow()+1;
    var rng=log.getRange(newIdx,1,1,4);
    rng.setNumberFormat("@");
    rng.setValues([[todayStr, v.id, v.name, result]]);
  });

  if(ownerId){
    var s="[倉治整骨院] 休眠患者への再来促進配信"+nl+"送信:"+sentNames.length+"件";
    if(sentNames.length)s+=nl+"送信した人: "+sentNames.join(", ");
    if(skip.length)s+=nl+"未登録: "+skip.join(", ");
    sendLineMessagingAPI(token,ownerId,s);
  }
}
// 指定した名前に、休眠促進メッセージのプレビューを送信する（文面確認用）
function sendDormantOutreachTestTo(name){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN");
  if(!token) return {ok:false, error:"LINEトークンが未設定です"};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var nl=String.fromCharCode(10);
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
  var msg="【プレビュー送信】"+nl+"いつも倉治整骨院をご利用いただき、ありがとうございます😊"+nl+nl+target+"様"+nl+nl+"しばらくご来院がないようですが、その後お体の調子はいかがでしょうか？"+nl+nl+"また気になる症状がございましたら、いつでもお気軽にお越しください。"+nl+"皆様のご来院をお待ちしております。"+nl+nl+"ご予約はこのLINEでどうぞ。"+nl+"(自動送信のため返信不要です)";
  var r=sendLineMessagingAPI(token,tid,msg);
  return r.ok ? {ok:true} : {ok:false, error:r.error||"送信に失敗しました"};
}
function getDormantLog(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var log=ss.getSheetByName("dormant_log");
  if(!log) return {ok:true, list:[]};
  var data=log.getDataRange().getValues().slice(1);
  var list=data.map(function(r){return{date:String(r[0]||""), id:String(r[1]||""), name:String(r[2]||""), result:String(r[3]||"")};});
  list.sort(function(a,b){return a.date<b.date?1:-1;});
  return {ok:true, list:list};
}
// 患者ごとの来店周期（平均何日おきに来ているか）・キャンセル率を計算する
// ═══════════════════════════════════════
// ★簡易ポイントカード（通院回数が節目に達したらLINEでお祝い＋割引特典。
//   まだ自動送信トリガーには含めていません。kanri.htmlから手動テストのみ可能）★
// ═══════════════════════════════════════
// 指定した名前に、ポイント特典メッセージのプレビューを送信する（文面確認用）
function sendPointsMilestoneTestTo(name){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN");
  if(!token) return {ok:false, error:"LINEトークンが未設定です"};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var nl=String.fromCharCode(10);
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
  var msg="【プレビュー送信】"+nl+"🎉 ご来院10回目、誠にありがとうございます！"+nl+nl+target+"様"+nl+nl+"日頃のご愛顧に感謝を込めて、次回ご来院時に使える"+nl+"【500円引きクーポン】をプレゼントいたします🎁"+nl+nl+"(受付でこのメッセージをご提示ください)"+nl+nl+"これからも倉治整骨院をよろしくお願いいたします。"+nl+nl+"倉治整骨院";
  var r=sendLineMessagingAPI(token,tid,msg);
  return r.ok ? {ok:true} : {ok:false, error:r.error||"送信に失敗しました"};
}
function sendPointsMilestone(){
  var p=PropertiesService.getScriptProperties();
  var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
  if(!token)return;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var ps=ss.getSheetByName("患者");
  if(!ps)return;
  var nl=String.fromCharCode(10);
  var MILESTONES=[10,20,30,50,100]; // 何回目で特典を送るか

  var data=ps.getDataRange().getValues();
  var headers=data[0].map(function(h){return String(h||"").trim();});
  var idI=0, nameI=1, telI=headers.indexOf("電話番号"), countI=headers.indexOf("通院回数");
  var offI=headers.indexOf("ポイント特典送信"), reqI=headers.indexOf("ポイント特典送信済み回数");
  if(telI<0)telI=4; if(countI<0)countI=12;

  var targets=[];
  for(var i=1;i<data.length;i++){
    var cnt=parseInt(data[i][countI])||0;
    if(MILESTONES.indexOf(cnt)<0) continue; // 節目の回数ちょうどの日だけ対象
    if(offI>-1 && String(data[i][offI]||"").toUpperCase()==="FALSE") continue;
    var sentAt=reqI>-1?String(data[i][reqI]||""):"";
    if(sentAt.indexOf(String(cnt))>-1) continue; // この回数では送信済み
    targets.push({rowIdx:i+1, id:String(data[i][idI]||""), name:String(data[i][nameI]||"").trim(), tel:String(data[i][telI]||""), count:cnt, sentAt:sentAt});
  }
  if(!targets.length) return;
  if(reqI<0){ reqI=headers.length; ps.getRange(1, reqI+1).setValue("ポイント特典送信済み回数"); }

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
    if(!tid){skip.push(t.name);return;}
    var msg="🎉 ご来院"+t.count+"回目、誠にありがとうございます！"+nl+nl+t.name+"様"+nl+nl+"日頃のご愛顧に感謝を込めて、次回ご来院時に使える"+nl+"【500円引きクーポン】をプレゼントいたします🎁"+nl+nl+"(受付でこのメッセージをご提示ください)"+nl+nl+"これからも倉治整骨院をよろしくお願いいたします。"+nl+nl+"倉治整骨院";
    if(sendLineMessagingAPI(token,tid,msg).ok){
      sentNames.push(t.name+"("+t.count+"回目)");
      var newSentAt=(t.sentAt?t.sentAt+",":"")+t.count;
      var rng=ps.getRange(t.rowIdx, reqI+1);
      rng.setNumberFormat("@");
      rng.setValue(newSentAt);
    }else{skip.push(t.name);}
  });

  if(ownerId){
    var s="[倉治整骨院] ポイント特典（通院回数マイルストーン）送信結果"+nl+"送信:"+sentNames.length+"件";
    if(sentNames.length)s+=nl+"送信した人: "+sentNames.join(", ");
    if(skip.length)s+=nl+"未登録: "+skip.join(", ");
    sendLineMessagingAPI(token,ownerId,s);
  }
}
function getPatientVisitStats(cardId, name){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var bs=ss.getSheetByName("予約表");
    if(!bs) return {ok:true, visits:0, avgIntervalDays:null, cancelCount:0, cancelRate:0};
    var bd=bs.getDataRange().getValues(),bh=bd[0];
    var di=bh.indexOf("日付"),ni=bh.indexOf("患者名"),ii=bh.indexOf("診察券No"),ki=bh.indexOf("区分");
    var target=String(name||"").trim().replace(/[\s　]+/g,"");
    var targetId=String(cardId||"").trim();
    var dates=[], cancelCount=0, totalCount=0;
    bd.slice(1).forEach(function(r){
      var rid=String(r[ii]||"").trim();
      var rname=String(r[ni]||"").trim().replace(/[\s　]+/g,"");
      var match=(targetId&&rid===targetId)||(!targetId&&rname===target)||(rname===target);
      if(!match)return;
      var k=String(r[ki]||"");
      if(k.indexOf("継続")>-1)return; // 継続枠は同じ来院なのでカウントしない
      totalCount++;
      if(k.indexOf("キャンセル")>-1){cancelCount++;return;}
      var dv=r[di];if(!dv)return;
      var d=dv instanceof Date?new Date(dv):new Date(String(dv));
      if(isNaN(d.getTime()))return;
      dates.push(d);
    });
    dates.sort(function(a,b){return a-b;});
    var avgIntervalDays=null;
    if(dates.length>=2){
      var totalGap=0;
      for(var i=1;i<dates.length;i++){ totalGap+=(dates[i]-dates[i-1])/(1000*60*60*24); }
      avgIntervalDays=Math.round(totalGap/(dates.length-1));
    }
    var cancelRate=totalCount>0?Math.round(cancelCount/totalCount*1000)/10:0;
    return {ok:true, visits:dates.length, avgIntervalDays:avgIntervalDays, cancelCount:cancelCount, cancelRate:cancelRate};
  }catch(err){ return {ok:false, error:err.message}; }
}
// GoogleクチコミのURLを設定する（Apps Scriptエディタから手動で1回だけ実行）
// 例: setReviewUrlの中のURLを実際のクチコミURLに書き換えてから実行してください
function setReviewUrl(){
  var url = "https://g.page/r/CZBfNKGrXbFyEBM/review";
  PropertiesService.getScriptProperties().setProperty("GOOGLE_REVIEW_URL", url);
  Logger.log("設定しました: " + url);
}
// kanri.html側から直接GoogleクチコミURLを設定・確認する
function setGoogleReviewUrlFromApp(url){
  if(!url) return {ok:false, error:"URLが指定されていません"};
  PropertiesService.getScriptProperties().setProperty("GOOGLE_REVIEW_URL", String(url).trim());
  return {ok:true};
}
function getGoogleReviewUrl(){
  var url = PropertiesService.getScriptProperties().getProperty("GOOGLE_REVIEW_URL")||"";
  return {ok:true, url:url};
}
function sendLineMessagingAPI(token,userId,message){
  if(!token||!userId||!message)return{ok:false,error:"token/userId/messageのいずれかが空です"};
  try{
    var res=UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push",{
      method:"post",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
      payload:JSON.stringify({to:userId,messages:[{type:"text",text:message}]}),
      muteHttpExceptions:true
    });
    var code=res.getResponseCode();
    if(code===200) return {ok:true};
    return {ok:false, error:"LINE API エラー(コード"+code+"): "+res.getContentText()};
  }catch(e){return{ok:false,error:"例外: "+e.message};}
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
        var ovClosed=od[i][1]===true||String(od[i][1]).toUpperCase()==="TRUE";
        return {closed:ovClosed, am:ovClosed?null:[toHHMM_(od[i][2]),toHHMM_(od[i][3])], pm:ovClosed?null:[toHHMM_(od[i][4]),toHHMM_(od[i][5])]};
      }
    }
  }
  // ★祝日は自動的に休診扱いにする（個別にその祝日だけ診療したい場合は「営業時間設定」の個別上書きで開けられる）
  if(isJapaneseHoliday_(dateStr)) return {closed:true, am:null, pm:null};
  var w=ss.getSheetByName("biz_hours_weekly");
  var dow=new Date(dateStr+"T00:00:00").getDay();
  if(w){
    var wd=w.getDataRange().getValues();
    for(var j=1;j<wd.length;j++){
      if(Number(wd[j][0])===dow){
        var closed=wd[j][1]===true||String(wd[j][1]).toUpperCase()==="TRUE";
        return {closed:closed, am:closed?null:[toHHMM_(wd[j][2]),toHHMM_(wd[j][3])], pm:closed?null:[toHHMM_(wd[j][4]),toHHMM_(wd[j][5])]};
      }
    }
  }
  // 設定が無い場合の従来デフォルト（日曜休診・木土は午前のみ）
  if(dow===0) return {closed:true, am:null, pm:null};
  if(dow===4||dow===6) return {closed:false, am:["08:30","12:30"], pm:null};
  return {closed:false, am:["08:30","12:30"], pm:["15:00","20:00"]};
}
// 日本の祝日かどうかを判定する（holidays-jp APIの結果を12時間キャッシュして毎回の通信を減らす）
function isJapaneseHoliday_(dateStr){
  try{
    var cache=CacheService.getScriptCache();
    var key="holidays_jp_json";
    var json=cache.get(key);
    var map;
    if(json){
      map=JSON.parse(json);
    }else{
      var res=UrlFetchApp.fetch("https://holidays-jp.github.io/api/v1/date.json",{muteHttpExceptions:true});
      if(res.getResponseCode()!==200) return false;
      map=JSON.parse(res.getContentText());
      cache.put(key, JSON.stringify(map), 21600); // 6時間キャッシュ
    }
    return !!map[dateStr];
  }catch(e){ return false; }
}
function getSlotsForDate_(dateStr){
  var cfg=getDayConfig_(dateStr);
  if(cfg.closed) return [];
  var mo=genSlots_(cfg.am&&cfg.am[0],cfg.am&&cfg.am[1]);
  var af=genSlots_(cfg.pm&&cfg.pm[0],cfg.pm&&cfg.pm[1]);
  return mo.concat(af);
}

// 指定日の「空いている時間枠」だけを返す（予約空き状況ジェネレーターとの連動用）
// 終業間際の延長枠（12:30・12:50・19:40の次の20:00・20:20）を、
// 実際に予約が入っていなければ「継続枠専用の空き」として追加する
// （11:50/19:20から3枠、12:10/19:40から2枠まで、通常の営業時間を少し超えて予約できるようにする特例）
var EXT_SLOTS_=["12:30","12:50","20:00","20:20"];
function addExtensionSlots_(available, occupied, blocked){
  EXT_SLOTS_.forEach(function(t){
    if(!occupied[t] && !blocked[t] && available.indexOf(t)<0) available.push(t);
  });
  return available;
}
function getAvailableSlots(dateStr){
  try{
    if(!dateStr) return {ok:false, error:"日付を指定してください"};
    var cfg=getDayConfig_(dateStr);
    if(cfg.closed) return {ok:true, closed:true, available:[]};
    var validSlots=getSlotsForDate_(dateStr);
    if(!validSlots.length) return {ok:true, closed:true, available:[]};

    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("予約表");
    var occupied={};
    if(s){
      var rows=s.getDataRange().getValues();
      for(var i=1;i<rows.length;i++){
        if(String(rows[i][0])===String(dateStr) && String(rows[i][3]||"").trim()!==""){
          occupied[String(rows[i][1])]=true;
        }
      }
    }
    // 院長が手動でブロックした枠も予約不可として扱う
    var blocked=getBlockedSlotsSet_(dateStr);
    var available=validSlots.filter(function(t){return !occupied[t] && !blocked[t];});
    available=addExtensionSlots_(available, occupied, blocked);
    return {ok:true, closed:false, available:available};
  }catch(err){ return {ok:false, error:err.message}; }
}
// 指定日にブロック（手動で潰した）されている時間のセットを返す
function getBlockedSlotsSet_(dateStr){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var bs=ss.getSheetByName("blocked_slots");
  var blocked={};
  if(bs){
    var bd=bs.getDataRange().getValues();
    for(var j=1;j<bd.length;j++){
      if(String(bd[j][0])===String(dateStr)) blocked[String(bd[j][1])]=true;
    }
  }
  return blocked;
}
// 週表示など複数日分まとめて空き状況を取得する（Web予約フォームの週間カレンダー用）
function getAvailableSlotsRange(startDateStr,numDays){
  try{
    if(!startDateStr) return {ok:false, error:"開始日を指定してください"};
    numDays=parseInt(numDays)||7;
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var bs=ss.getSheetByName("予約表");
    var allBooked={}; // date -> {time:true}
    if(bs){
      var rows=bs.getDataRange().getValues();
      for(var i=1;i<rows.length;i++){
        if(String(rows[i][3]||"").trim()===""){continue;}
        var dd=String(rows[i][0]);
        if(!allBooked[dd])allBooked[dd]={};
        allBooked[dd][String(rows[i][1])]=true;
      }
    }
    var result={};
    var d0=new Date(startDateStr+"T00:00:00");
    for(var k=0;k<numDays;k++){
      var d=new Date(d0); d.setDate(d0.getDate()+k);
      var dateStr=Utilities.formatDate(d,"Asia/Tokyo","yyyy-MM-dd");
      var cfg=getDayConfig_(dateStr);
      if(cfg.closed){ result[dateStr]={closed:true, available:[]}; continue; }
      var validSlots=getSlotsForDate_(dateStr);
      var occupied=allBooked[dateStr]||{};
      var blocked=getBlockedSlotsSet_(dateStr);
      var available=validSlots.filter(function(t){return !occupied[t] && !blocked[t];});
      available=addExtensionSlots_(available, occupied, blocked);
      result[dateStr]={closed:false, available:available};
    }
    return {ok:true, days:result};
  }catch(err){ return {ok:false, error:err.message}; }
}
// 院長が手動で予約枠を潰す／解除する（kanri.htmlから使用）
function toggleBlockedSlot(dateStr,timeStr,block){
  try{
    if(!dateStr||!timeStr) return {ok:false, error:"日付・時間を指定してください"};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var bs=ss.getSheetByName("blocked_slots");
    if(!bs){ bs=ss.insertSheet("blocked_slots"); bs.getRange(1,1,1,3).setValues([["date","time","note"]]); }
    var data=bs.getDataRange().getValues();
    var foundRow=-1;
    for(var i=1;i<data.length;i++){
      if(String(data[i][0])===String(dateStr) && String(data[i][1])===String(timeStr)){ foundRow=i+1; break; }
    }
    if(block){
      if(foundRow<0){
        var newIdx=bs.getLastRow()+1;
        var rng=bs.getRange(newIdx,1,1,3);
        rng.setNumberFormat("@");
        rng.setValues([[dateStr,timeStr,"院長が手動でブロック"]]);
      }
    }else{
      if(foundRow>0) bs.deleteRow(foundRow);
    }
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}
// 指定日にブロックされている時間の一覧を返す（kanri.html管理画面用）
function getBlockedSlotsForDate(dateStr){
  var set=getBlockedSlotsSet_(dateStr);
  return {ok:true, blocked:Object.keys(set)};
}
// デバッグ用：blocked_slotsシートの中身を全件そのまま返す（日付ごとの実データを確認するため）
function getAllBlockedSlotsDebug(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var bs=ss.getSheetByName("blocked_slots");
  if(!bs) return {ok:true, rows:[]};
  var data=bs.getDataRange().getValues();
  var rows=data.slice(1).map(function(r){return {date:String(r[0]||""), time:String(r[1]||""), note:String(r[2]||"")};});
  return {ok:true, rows:rows};
}
// ═══════════════════════════════════════
// ★Web予約リクエスト方式（第一〜第三希望を受け付け、その場では確定しない）★
// 個人経営で施術中に電話対応できないため、候補日時をいただいて後日院長が確認の上、確定連絡する運用。
// ═══════════════════════════════════════
function saveWebBookingRequest(data){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("web_yoyaku_requests");
    if(!s){
      s=ss.insertSheet("web_yoyaku_requests");
      s.getRange(1,1,1,15).setValues([["date1","time1","date2","time2","date3","time3","name","tel","email","menu","symptom","status","createdAt","kana","cardId"]]);
    }
    if(!data.name || !data.tel) return {ok:false, error:"お名前・お電話番号は必須です"};
    if(!data.date1 || !data.time1) return {ok:false, error:"第一希望日時を選んでください"};

    var todayStr=Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd");
    if(data.date1===todayStr || data.date2===todayStr || data.date3===todayStr){
      return {ok:false, error:"本日中のご希望はWebフォームでは受け付けておりません。お手数ですがLINEかお電話でご連絡ください。"};
    }

    var newRow=[
      data.date1||"", data.time1||"", data.date2||"", data.time2||"", data.date3||"", data.time3||"",
      data.name||"", data.tel||"", data.email||"", data.menu||"", data.symptom||"",
      "未対応", Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd HH:mm:ss"),
      data.kana||"", data.cardId||""
    ];
    var newRowIdx=s.getLastRow()+1;
    var rng=s.getRange(newRowIdx,1,1,newRow.length);
    rng.setNumberFormat("@");
    rng.setValues([newRow]);

    var p=PropertiesService.getScriptProperties();
    var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
    var nl=String.fromCharCode(10);
    function fmtCand(d,t){ return d&&t ? (d+" "+t) : "（未選択）"; }
    if(token&&ownerId){
      sendLineMessagingAPI(token,ownerId,
        "[倉治整骨院] 🗒 Web予約リクエストが届きました"+nl+nl+
        "お名前："+(data.name||"")+" 様"+(data.kana?"（"+data.kana+"）":"")+nl+
        "電話："+(data.tel||"")+nl+
        "メニュー："+(data.menu||"")+nl+
        (data.cardId?"診察券No："+data.cardId+nl:"")+nl+
        "第一希望："+fmtCand(data.date1,data.time1)+nl+
        "第二希望："+fmtCand(data.date2,data.time2)+nl+
        "第三希望："+fmtCand(data.date3,data.time3)+nl+nl+
        "kanri.htmlの「Web予約リクエスト一覧」から確認し、確定のご連絡をお願いします。"
      );
    }
    // 患者様ご本人には「リクエストを受け付けた」旨のみお知らせ（確定はまだ、と明記する）
    if(token){
      var tid="";
      if(data.tel) tid=findLineUidByPhone_(data.tel);
      if(tid){
        sendLineMessagingAPI(token,tid,
          "[倉治整骨院]"+nl+nl+(data.name||"")+"様"+nl+nl+
          "ご予約リクエストを受け付けました。"+nl+
          "第一希望："+fmtCand(data.date1,data.time1)+nl+
          (data.date2?"第二希望："+fmtCand(data.date2,data.time2)+nl:"")+
          (data.date3?"第三希望："+fmtCand(data.date3,data.time3)+nl:"")+nl+
          "※まだご予約は確定しておりません。院長が確認の上、改めてこちらのLINEにてご連絡いたします。"+nl+nl+
          "お急ぎの場合や、この予約システムがうまく動かない場合は、お手数ですがこのままLINEでメッセージいただくか、お電話（072-892-3223）でお問い合わせください。"+nl+nl+
          "(自動送信のため返信不要です)"
        );
      }
    }
    if(data.email){
      try{
        MailApp.sendEmail({
          to: data.email,
          subject: "【倉治整骨院】ご予約リクエストを受け付けました",
          body: (data.name||"")+" 様"+nl+nl+"ご予約リクエストありがとうございます。以下の内容で承りました。"+nl+nl+
                "第一希望："+fmtCand(data.date1,data.time1)+nl+
                (data.date2?"第二希望："+fmtCand(data.date2,data.time2)+nl:"")+
                (data.date3?"第三希望："+fmtCand(data.date3,data.time3)+nl:"")+nl+
                "※まだご予約は確定しておりません。院長確認の上、改めてご連絡いたします。"+nl+nl+
                "お急ぎの場合はお電話（072-892-3223）にてご連絡ください。"+nl+nl+
                "倉治整骨院"
        });
      }catch(err){ Logger.log("mail error:"+err); }
    }
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}
// kanri.html側からWeb予約リクエスト一覧を取得する
// ═══════════════════════════════════════
// ★Web問診票（患者様が来院前にスマホで記入。院内でA4印刷して使える）★
// ═══════════════════════════════════════
var MONDO_HEADERS_=["createdAt","kana","name","dob","sex","job","zip","addr","tel","telHome","emergency",
  "medYn","medDetail","know","lineStatus","symptom","symptomMain","symptomSince","hospital","diagnosis",
  "treatment","effort","alcohol","smoke","otherCond","pregnant","surgery","accident","goal"];
function saveMondoshin(data){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("web_mondoshin");
    if(!s){ s=ss.insertSheet("web_mondoshin"); s.getRange(1,1,1,MONDO_HEADERS_.length).setValues([MONDO_HEADERS_]); }
    if(!data.kana||!data.name||!data.tel) return {ok:false, error:"ふりがな・お名前・お電話番号は必須です"};
    var row=MONDO_HEADERS_.map(function(h){
      if(h==="createdAt") return Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd HH:mm:ss");
      return data[h]||"";
    });
    var newIdx=s.getLastRow()+1;
    var rng=s.getRange(newIdx,1,1,row.length);
    rng.setNumberFormat("@");
    rng.setValues([row]);

    var p=PropertiesService.getScriptProperties();
    var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
    if(token&&ownerId){
      var nl=String.fromCharCode(10);
      sendLineMessagingAPI(token,ownerId,
        "[倉治整骨院] 📋 Web問診票が届きました"+nl+nl+
        "お名前："+data.name+"様（"+data.kana+"）"+nl+
        "症状："+(data.symptom||"")+nl+nl+
        "kanri.htmlの「Web問診票一覧」から内容の確認・A4印刷ができます。"
      );
    }
    return {ok:true, rowIdx:newIdx};
  }catch(err){ return {ok:false, error:err.message}; }
}
function getMondoshinList(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_mondoshin");
  if(!s) return {ok:true, list:[]};
  var data=s.getDataRange().getValues();
  var list=[];
  for(var i=1;i<data.length;i++){
    var obj={rowIdx:i+1};
    MONDO_HEADERS_.forEach(function(h,idx){ obj[h]=String(data[i][idx]||""); });
    list.push(obj);
  }
  list.sort(function(a,b){return a.createdAt<b.createdAt?1:-1;});
  return {ok:true, list:list};
}
function getMondoshinById(rowIdx){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_mondoshin");
  if(!s) return {ok:false, error:"データがありません"};
  var row=s.getRange(parseInt(rowIdx),1,1,MONDO_HEADERS_.length).getValues()[0];
  var obj={rowIdx:rowIdx};
  MONDO_HEADERS_.forEach(function(h,idx){ obj[h]=String(row[idx]||""); });
  return {ok:true, data:obj};
}
// 通常問診票を削除する（テストデータの削除用）
function deleteMondoshin(rowIdx){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_mondoshin");
  if(!s) return {ok:false, error:"シートが見つかりません"};
  s.deleteRow(parseInt(rowIdx));
  return {ok:true};
}
// ═══════════════════════════════════════
// ★交通事故専用Web問診票★
// ═══════════════════════════════════════
var MONDO_KOTSU_HEADERS_=["createdAt","kana","name","dob","zip","addr","tel","accDate","accTime","accPlace","accType","role",
  "otherParty","police","otherIns","myIns","bengoshi","injury","symptomDetail","onset","otherHosp","otherHospName","image","freq","work"];
function saveMondoshinKotsu(data){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("web_mondoshin_kotsu");
    if(!s){ s=ss.insertSheet("web_mondoshin_kotsu"); s.getRange(1,1,1,MONDO_KOTSU_HEADERS_.length).setValues([MONDO_KOTSU_HEADERS_]); }
    if(!data.kana||!data.name||!data.tel||!data.accDate) return {ok:false, error:"ふりがな・お名前・お電話番号・事故日は必須です"};
    var row=MONDO_KOTSU_HEADERS_.map(function(h){
      if(h==="createdAt") return Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd HH:mm:ss");
      return data[h]||"";
    });
    var newIdx=s.getLastRow()+1;
    var rng=s.getRange(newIdx,1,1,row.length);
    rng.setNumberFormat("@");
    rng.setValues([row]);

    var p=PropertiesService.getScriptProperties();
    var token=p.getProperty("LINE_TOKEN"),ownerId=p.getProperty("LINE_USER_ID");
    if(token&&ownerId){
      var nl=String.fromCharCode(10);
      sendLineMessagingAPI(token,ownerId,
        "[倉治整骨院] 🚗 交通事故問診票が届きました"+nl+nl+
        "お名前："+data.name+"様（"+data.kana+"）"+nl+
        "事故日："+(data.accDate||"")+nl+
        "受傷部位："+(data.injury||"")+nl+nl+
        "kanri.htmlの「Web問診票一覧」から内容の確認・A4印刷ができます。"
      );
    }
    return {ok:true, rowIdx:newIdx};
  }catch(err){ return {ok:false, error:err.message}; }
}
function getMondoshinKotsuList(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_mondoshin_kotsu");
  if(!s) return {ok:true, list:[]};
  var data=s.getDataRange().getValues();
  var list=[];
  for(var i=1;i<data.length;i++){
    var obj={rowIdx:i+1};
    MONDO_KOTSU_HEADERS_.forEach(function(h,idx){ obj[h]=String(data[i][idx]||""); });
    list.push(obj);
  }
  list.sort(function(a,b){return a.createdAt<b.createdAt?1:-1;});
  return {ok:true, list:list};
}
function getMondoshinKotsuById(rowIdx){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_mondoshin_kotsu");
  if(!s) return {ok:false, error:"データがありません"};
  var row=s.getRange(parseInt(rowIdx),1,1,MONDO_KOTSU_HEADERS_.length).getValues()[0];
  var obj={rowIdx:rowIdx};
  MONDO_KOTSU_HEADERS_.forEach(function(h,idx){ obj[h]=String(row[idx]||""); });
  return {ok:true, data:obj};
}
// 交通事故問診票を削除する（テストデータの削除用）
function deleteMondoshinKotsu(rowIdx){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_mondoshin_kotsu");
  if(!s) return {ok:false, error:"シートが見つかりません"};
  s.deleteRow(parseInt(rowIdx));
  return {ok:true};
}
// ═══════════════════════════════════════
// ★電子カルテ（SOAP形式：主訴・所見・評価・方針。全国の整体院向けシステムを参考に設計）★
// ═══════════════════════════════════════
var KARTE_HEADERS_=["createdAt","cardId","name","visitDate","subjective","objective","assessment","plan","bodyImage","staffNote"];
function saveKarte(data){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("karte");
    if(!s){ s=ss.insertSheet("karte"); s.getRange(1,1,1,KARTE_HEADERS_.length).setValues([KARTE_HEADERS_]); }
    if(!data.cardId || !data.name) return {ok:false, error:"診察券No・お名前は必須です"};
    var row=KARTE_HEADERS_.map(function(h){
      if(h==="createdAt") return Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd HH:mm:ss");
      if(h==="visitDate") return data.visitDate||Utilities.formatDate(new Date(),"Asia/Tokyo","yyyy-MM-dd");
      return data[h]||"";
    });
    var newIdx=s.getLastRow()+1;
    var rng=s.getRange(newIdx,1,1,row.length);
    rng.setNumberFormat("@");
    rng.setValues([row]);
    return {ok:true, rowIdx:newIdx};
  }catch(err){ return {ok:false, error:err.message}; }
}
function getKarteListByCardId(cardId){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("karte");
  if(!s) return {ok:true, list:[]};
  var data=s.getDataRange().getValues();
  var list=[];
  for(var i=1;i<data.length;i++){
    if(String(data[i][1])!==String(cardId)) continue;
    var obj={rowIdx:i+1};
    KARTE_HEADERS_.forEach(function(h,idx){ obj[h]=String(data[i][idx]||""); });
    list.push(obj);
  }
  list.sort(function(a,b){return a.visitDate<b.visitDate?1:-1;});
  return {ok:true, list:list};
}
function getKarteById(rowIdx){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("karte");
  if(!s) return {ok:false, error:"データがありません"};
  var row=s.getRange(parseInt(rowIdx),1,1,KARTE_HEADERS_.length).getValues()[0];
  var obj={rowIdx:rowIdx};
  KARTE_HEADERS_.forEach(function(h,idx){ obj[h]=String(row[idx]||""); });
  return {ok:true, data:obj};
}
function deleteKarte(rowIdx){
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var s=ss.getSheetByName("karte");
    if(!s) return {ok:false, error:"シートが見つかりません"};
    s.deleteRow(parseInt(rowIdx));
    return {ok:true};
  }catch(err){ return {ok:false, error:err.message}; }
}
function getWebBookingRequests(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_yoyaku_requests");
  if(!s) return {ok:true, list:[]};
  var data=s.getDataRange().getValues();
  var list=[];
  for(var i=1;i<data.length;i++){
    var r=data[i];
    var tel=String(r[7]||"");
    var hasLine=!!findLineUidByPhone_(tel); // 電話番号でLINE連携が見つかるか確認（連絡手段の目安に使う）
    list.push({
      rowIdx:i+1, date1:String(r[0]||""), time1:String(r[1]||""), date2:String(r[2]||""), time2:String(r[3]||""),
      date3:String(r[4]||""), time3:String(r[5]||""), name:String(r[6]||""), tel:tel, email:String(r[8]||""),
      menu:String(r[9]||""), symptom:String(r[10]||""), status:String(r[11]||"未対応"), createdAt:String(r[12]||""),
      hasLine:hasLine, kana:String(r[13]||""), cardId:String(r[14]||"")
    });
  }
  list.sort(function(a,b){return a.createdAt<b.createdAt?1:-1;});
  return {ok:true, list:list};
}
// リクエストの対応状況を更新する（対応済みにする等）
// リクエストを削除する（テストデータの削除用）
function deleteWebBookingRequest(rowIdx){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_yoyaku_requests");
  if(!s) return {ok:false, error:"シートが見つかりません"};
  s.deleteRow(parseInt(rowIdx));
  return {ok:true};
}
function updateWebBookingRequestStatus(rowIdx,status){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var s=ss.getSheetByName("web_yoyaku_requests");
  if(!s) return {ok:false, error:"シートが見つかりません"};
  var rng=s.getRange(parseInt(rowIdx),12);
  rng.setNumberFormat("@");
  rng.setValue(status||"対応済み");
  return {ok:true};
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
// kanri.html側から指定したメールアドレスにテストメールを送信する（権限・到達確認用）
function sendTestEmailTo(email){
  try{
    if(!email) return {ok:false, error:"メールアドレスが指定されていません"};
    MailApp.sendEmail({
      to: email,
      subject: "【テスト】倉治整骨院システムからのメール送信テスト",
      body: "このメールが届いていれば、Web予約フォームのメール確認機能は正常に動作しています。\n\n倉治整骨院"
    });
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
