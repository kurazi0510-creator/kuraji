import fs from 'node:fs';
import path from 'node:path';

// Build two independent Apps Script projects from the same reviewed core.
// Never put LINE credentials or deployment URLs in these outputs.
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'security', 'dist');
fs.mkdirSync(out, { recursive: true });
const writeGenerated = (filename, contents) =>
  fs.writeFileSync(path.join(out, filename), contents.replace(/[\t ]+$/gm, ''));
const core = fs.readFileSync(path.join(root, 'gas_full_v5.gs'), 'utf8')+'\n'+fs.readFileSync(path.join(root,'security/booking_lookup.gs'),'utf8')+'\n'+fs.readFileSync(path.join(root,'security/booking_lookup_line.gs'),'utf8')+'\n'+fs.readFileSync(path.join(root,'security/line_phone_registration.gs'),'utf8');
const bridge = fs.readFileSync(path.join(root, 'security', 'admin_fetch_bridge.js'), 'utf8');

const publicGet = ['getPublicSecurityStatus', 'getMenuMaster', 'getBizHours', 'getAvailableSlots', 'getAvailableSlotsRange'];
const publicPost = ['saveWebBookingRequest', 'saveTrafficAccidentConsult', 'registerWaitlist', 'saveMondoshin', 'saveMondoshinKotsu', 'requestBookingLookupCode', 'verifyBookingLookupCode'];
const publicPrelude = `// PUBLIC deployment: no patient list, no management writes, no arbitrary LINE sends.
var PUBLIC_GET_ACTIONS_=${JSON.stringify(Object.fromEntries(publicGet.map(x => [x, true])))};
var PUBLIC_POST_ACTIONS_=${JSON.stringify(Object.fromEntries(publicPost.map(x => [x, true])))};
function publicReject_(){return ContentService.createTextOutput(JSON.stringify({ok:false,error:'権限がありません'})).setMimeType(ContentService.MimeType.JSON);}
function webhookAllowed_(e){
  var configured=PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_FORWARD_KEY');
  var supplied=e&&e.parameter&&e.parameter.webhookKey;
  if(!configured||!supplied||String(configured).length!==String(supplied).length)return false;
  var diff=0;for(var i=0;i<configured.length;i++)diff|=configured.charCodeAt(i)^String(supplied).charCodeAt(i);
  return diff===0;
}
`;
let pub = publicPrelude + core;
pub = pub.replace('function doGet(e){', `function doGet(e){
  var publicAction=(e&&e.parameter&&e.parameter.action)||'';
  if(typeof publicAction!=='string'||!Object.prototype.hasOwnProperty.call(PUBLIC_GET_ACTIONS_,publicAction))return publicReject_();
  if(publicAction==='getPublicSecurityStatus')return ContentService.createTextOutput(JSON.stringify({ok:true,version:'kuraji-public-boundary-20260930',bookingLookupVersion:'verified-card-20261001',bookingLineVersion:'one-tap-20261001',phoneRegistrationVersion:'auto-phone-20261002',managementAccess:false,webhookRequiresRelay:true})).setMimeType(ContentService.MimeType.JSON);
  if(e.parameter.callback&&!/^[A-Za-z_$][\\w$]*(\\.[A-Za-z_$][\\w$]*)*$/.test(e.parameter.callback))return publicReject_();
  if(publicAction==='getAvailableSlotsRange')e.parameter.numDays=Math.min(7,Math.max(1,parseInt(e.parameter.numDays,10)||7));`);
pub = pub.replace('function doPost(e){', `function doPost(e){
  var rawBody=e&&e.postData&&e.postData.contents||'{}', incoming;
  try{incoming=JSON.parse(rawBody);}catch(parseError){return publicReject_();}
  if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))return publicReject_();
  if(Object.prototype.hasOwnProperty.call(incoming,'events')){if(!Array.isArray(incoming.events)||incoming.action||!webhookAllowed_(e))return publicReject_();}
  else if(typeof incoming.action!=='string'||!Object.prototype.hasOwnProperty.call(PUBLIC_POST_ACTIONS_,incoming.action))return publicReject_();`);
// The legacy handler swallowed failures and returned ok:true. A relay must be able
// to distinguish a rejected/failed webhook from a successfully processed one.
pub=pub.replace('var lock=LockService.getScriptLock();\n      try{ lock.waitLock(10000); }catch(lockErr){ /* ロック取得失敗時もそのまま続行（最悪重複の可能性は残るが処理は止めない） */ }',
  'var webhookFailed=false;\n      var lock=LockService.getScriptLock();\n      lock.waitLock(10000);');
pub=pub.replace('}catch(err){Logger.log("event error:"+err);}', '}catch(err){webhookFailed=true;Logger.log("event error:"+err);}');
// Retry a failed batch without repeating already completed events. Cache entries
// are a best-effort six-hour deduplication window, not an exactly-once guarantee.
pub=pub.replace('body.events.forEach(function(ev){\n        try{', `body.events.forEach(function(ev){
        try{
          var eventKey=ev&&ev.webhookEventId?bookingLookupCacheKey_('webhook:'+ev.webhookEventId):'';
          if(eventKey&&CacheService.getScriptCache().get(eventKey))return;`);
pub=pub.replace('if(handleBookingLookupLineEvent_(ev))return;', "if(handleBookingLookupLineEvent_(ev)){if(eventKey)CacheService.getScriptCache().put(eventKey,'done',21600);return;}");
pub=pub.replace('if(handleLinePhoneRegistrationEvent_(ev))return;', "if(handleLinePhoneRegistrationEvent_(ev)){if(eventKey)CacheService.getScriptCache().put(eventKey,'done',21600);return;}");
pub=pub.replace('}catch(err){webhookFailed=true;Logger.log("event error:"+err);}', `if(eventKey)CacheService.getScriptCache().put(eventKey,'done',21600);
        }catch(err){webhookFailed=true;Logger.log("event error:"+err);}`);
pub=pub.replace('try{ lock.releaseLock(); }catch(relErr){}', `try{ lock.releaseLock(); }catch(relErr){}
      if(webhookFailed)ret=ContentService.createTextOutput(JSON.stringify({ok:false,error:'LINE処理に失敗しました'})).setMimeType(ContentService.MimeType.JSON);`);
pub=pub.replace('}catch(err){Logger.log("doPost error:"+err);}', `}catch(err){Logger.log("doPost error:"+err);ret=ContentService.createTextOutput(JSON.stringify({ok:false,error:'処理に失敗しました'})).setMimeType(ContentService.MimeType.JSON);}`);
writeGenerated('Public.gs', pub);

// The admin deployment MUST be restricted to the owner by Google's deployment ACL.
// It is a standalone project; the spreadsheet ID is configured server-side.
let admin = core.replace('function doGet(e){', 'function adminApiGet_(e){')
                .replace('function doPost(e){', 'function adminApiPost_(e){')
                .replaceAll('SpreadsheetApp.getActiveSpreadsheet()', 'adminSpreadsheet_()');
admin += `
// This entire project must be deployed with access: Only myself.
function adminSpreadsheet_(){
  var id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if(!id)throw new Error('SPREADSHEET_ID is not configured');
  return SpreadsheetApp.openById(id);
}
var ADMIN_PAGES_={Admin:true,Karte:true,TodaySplit:true,LineSetup:true,TriggerSetup:true,Uriage:true,BookingLookup:true,MondoPrint:true,MondoKotsuPrint:true};
function doGet(e){
  var page=e&&e.parameter&&e.parameter.page||'Admin';
  if(typeof page!=='string'||!Object.prototype.hasOwnProperty.call(ADMIN_PAGES_,page))throw new Error('Unknown page');
  var template=HtmlService.createTemplateFromFile(page);
  template.webAppUrl=ScriptApp.getService().getUrl();
  template.pageParamsJson=JSON.stringify(e&&e.parameter||{}).replace(/</g,'\\\\u003c').replace(/>/g,'\\\\u003e').replace(/&/g,'\\\\u0026');
  return template.evaluate().setTitle('倉治整骨院 管理システム');
}
function adminRequest(request){
  if(!request||!request.method)throw new Error('Invalid request');
  var output,deletedCardCleanup;
  if(request.method==='GET'){
    if(request.params&&request.params.action==='getAll'){var repair=repairTomitaCard2085();if(!repair.ok)throw new Error(repair.error);deletedCardCleanup=cleanupDeletedCards2500And3000_();}
    output=adminApiGet_({parameter:request.params||{}});
  }else if(request.method==='POST'){
    if(request.body&&request.body.action==='registerNewPatient')return JSON.stringify(registerNewPatient_(request.body.patient));
    output=adminApiPost_({postData:{contents:JSON.stringify(request.body||{})},parameter:{}});
  }else throw new Error('Invalid method');
  if(deletedCardCleanup){var data=JSON.parse(output.getContent());data.deletedCardCleanup=deletedCardCleanup;return JSON.stringify(data);}
  return output.getContent();
}
`;
admin+='\n'+fs.readFileSync(path.join(root,'security/patient_identity_admin.gs'),'utf8');

admin+='\n'+fs.readFileSync(path.join(root,'security/booking_lookup_admin.gs'),'utf8');
writeGenerated('Admin.gs', admin);

const bridgeTag = `<script>\nwindow.KURAJI_ADMIN_URL=<?!= JSON.stringify(webAppUrl) ?>;\nwindow.KURAJI_PAGE_PARAMS=<?!= pageParamsJson ?>;\nfunction adminPageUrl(page){return window.KURAJI_ADMIN_URL+'?page='+encodeURIComponent(page)}\n${bridge}\n</script>\n`;
const pages = {
  Admin: 'kanri.html', Karte: 'karte.html', TodaySplit: 'today_split.html',
  LineSetup: 'line_setup.html', TriggerSetup: 'gas_trigger_setup.html',
  Uriage: 'uriage.html', Salary: 'murao_salary.html', BookingLookup: 'security/BookingLookup.html', MondoPrint: 'mondo_print.html', MondoKotsuPrint: 'mondo_kotsu_print.html',
};
const publicPages = ['book.html', 'confirm.html', 'consent.html', 'symptom.html', 'line_template.html', 'gas_update.html', 'gas_copy.html'];
for (const [name, filename] of Object.entries(pages)) {
  let html = fs.readFileSync(path.join(root, filename), 'utf8');
  if(name==='Admin')html=html.replace('<div class="nav-t" onclick="location.href=\'uriage.html\'"', '<div class="nav-t" onclick="window.open(adminPageUrl(\'BookingLookup\'),\'_top\')">📋 予約確認の連携</div>\n  <div class="nav-t" onclick="location.href=\'uriage.html\'"');
  if(name==='Salary'){
    const transfer=fs.readFileSync(path.join(root,'security/salary_transfer.js'),'utf8');
    const client=fs.readFileSync(path.join(root,'security/salary_private_client.js'),'utf8');
    html=html.replace(/const GAS_URL = "[^"]+";/, '// Salary data stays in the owner-only project.');
    html=html.replace(/async function gasUpload\(\)\{[\s\S]*?(?=function setSyncStatus)/,client+'\n');
    html=html.replace(/async function gasAutoBackup\(\)\{[\s\S]*?(?=function saveMonth)/,'');
    html=html.replace("const res = await fetch(GAS_URL+'?action=loadMurao&t='+Date.now());\n      const json = await res.json();",'const json = await salaryLoad();');
    html=html.replace('<script src="security/salary_transfer.js"></script>','');
    html=html.replace('<!-- ① GAS同期バー -->',`<p class="hide-on-print"><a href="<?!= webAppUrl ?>?page=Admin" target="_top">← 管理画面へ戻る</a></p>\n<!-- ① GAS同期バー -->`);
    // Define transfer helpers before the startup loader runs.
    html=html.replace('<script>', '<script>\n'+transfer+'\n');
    html=html.replace('※ デスクトップで入力後「⬆保存」→ iPhone/iPad で「⬇取得」すると反映されます','※ 入力内容を共有するには「保存」を押してください。旧画面からはバックアップで引き継げます。');
    if(/GAS_URL|action=(?:load|save)Murao/.test(html))throw new Error('Salary still has a legacy network route');
  }
  if(name==='Admin'){
    const lineCounts=/<div style="display:flex;gap:16px;margin-bottom:10px;font-size:0\.82rem">\s*<div>✅ 登録済み：<b id="lu-count-ok">0<\/b>人<\/div>\s*<div>⬜ 未登録：<b id="lu-count-ng">0<\/b>人<\/div>\s*<\/div>/;
    if(!lineCounts.test(html))throw new Error('LINE registration count block was not found');
    html=html.replace(lineCounts,`<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;font-size:0.82rem">
      <div style="color:#166534">✅ 予約確認 連携済み：<b id="lu-count-linked">0</b>人</div>
      <div style="color:#92400e">🟠 電話番号のみ登録：<b id="lu-count-ok">0</b>人</div>
      <div style="color:#4b5563">⬜ 電話番号未登録：<b id="lu-count-ng">0</b>人</div>
    </div>
    <label style="display:block;margin-bottom:10px">表示する状態：
      <select id="lu-status-filter" onchange="renderLineUsers()" style="padding:7px;max-width:100%">
        <option value="all">すべて</option>
        <option value="phone">電話番号のみ登録（予約確認は未連携）</option>
        <option value="linked">予約確認 連携済み</option>
        <option value="missing">電話番号未登録</option>
      </select>
    </label>`);
    const end=html.lastIndexOf('</body>');
    if(end<0)throw new Error('Admin body terminator missing');
    html=html.slice(0,end)+'<script>\n'+fs.readFileSync(path.join(root,'security/line_registration_client.js'),'utf8')+'\n</script>\n'+html.slice(end);
  }
  html=html.replaceAll('new URLSearchParams(location.search)','new URLSearchParams(window.KURAJI_PAGE_PARAMS)');
  if(name==='Karte'){
    const diagrams=fs.readFileSync(path.join(root,'security/body_diagrams.json'),'utf8');
    html=html.replace('function drawBg(key){',`const BODY_DIAGRAM_PNG=${diagrams};\nfunction drawBg(key){`)
      .replace('if(cur===key)bx.drawImage(img,0,0,f.w,f.h);', `if(cur===key){bx.drawImage(img,0,0,f.w,f.h);const doc=new DOMParser().parseFromString(svg,'image/svg+xml');doc.querySelectorAll('text').forEach(t=>{bx.fillStyle=t.getAttribute('fill')||'#555';bx.font=(t.getAttribute('font-weight')||'normal')+' '+(t.getAttribute('font-size')||12)+'px sans-serif';bx.textAlign=({middle:'center',end:'right'})[t.getAttribute('text-anchor')]||'left';bx.fillText(t.textContent,Number(t.getAttribute('x')),Number(t.getAttribute('y')));});}`)
      .replace("img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);", "img.onerror=()=>{if(cur===key){bx.fillStyle='#b91c1c';bx.font='12px sans-serif';bx.fillText('体図の読み込みに失敗しました',5,30);}};\n  img.src=BODY_DIAGRAM_PNG[key];");
  }
  for (const [target, page] of Object.entries(pages)) {
    html = html.replaceAll(`location.href='${page}'`, `window.open(adminPageUrl('${target}'),'_top')`);
    html = html.replaceAll(`window.open('${page}'`, `window.open(adminPageUrl('${target}')`);
  }
  html = html.replaceAll("'karte.html?cardId='+", "adminPageUrl('Karte')+'&cardId='+");
  html = html.replaceAll("'mondo_kotsu_print.html'", "adminPageUrl('MondoKotsuPrint')");
  html = html.replaceAll("'mondo_print.html'", "adminPageUrl('MondoPrint')");
  if(name==='Admin')html=html.replaceAll('${printPage}?id=', '${printPage}&id=');
  html = html.replaceAll('href="line_setup.html"', 'href="<?!= webAppUrl ?>?page=LineSetup"');
  html = html.replaceAll('src="karte.html"', 'src="<?!= webAppUrl ?>?page=Karte"');
  html = html.replaceAll("frame.src='karte.html?cardId='+", "frame.src=adminPageUrl('Karte')+'&cardId='+");
  html = html.replaceAll("'karte.html?cardId='+", "adminPageUrl('Karte')+'&cardId='+");
  html = html.replaceAll("'karte.html'", "adminPageUrl('Karte')");
  for (const publicPage of publicPages) {
    html = html.replaceAll(`'${publicPage}'`, `'https://kurazi0510-creator.github.io/kuraji/${publicPage}'`);
  }
  writeGenerated(name + '.html', html.replace('</head>', `${bridgeTag}</head>`));
}
console.log('Built security/dist/Public.gs, Admin.gs and owner-only HTML pages');
