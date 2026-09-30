import fs from 'node:fs';
import path from 'node:path';

// Build two independent Apps Script projects from the same reviewed core.
// Never put LINE credentials or deployment URLs in these outputs.
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'security', 'dist');
fs.mkdirSync(out, { recursive: true });
const writeGenerated = (filename, contents) =>
  fs.writeFileSync(path.join(out, filename), contents.replace(/[\t ]+$/gm, ''));
const core = fs.readFileSync(path.join(root, 'gas_full_v5.gs'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'security', 'admin_fetch_bridge.js'), 'utf8');

const publicGet = ['getMenuMaster', 'getBizHours', 'getAvailableSlots', 'getAvailableSlotsRange'];
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
  if(!PUBLIC_GET_ACTIONS_[publicAction])return publicReject_();
  if(e.parameter.callback&&!/^[A-Za-z_$][\\w$]*(\\.[A-Za-z_$][\\w$]*)*$/.test(e.parameter.callback))return publicReject_();
  if(publicAction==='getAvailableSlotsRange')e.parameter.numDays=Math.min(7,Math.max(1,parseInt(e.parameter.numDays,10)||7));`);
pub = pub.replace('function doPost(e){', `function doPost(e){
  var rawBody=e&&e.postData&&e.postData.contents||'{}', incoming;
  try{incoming=JSON.parse(rawBody);}catch(parseError){return publicReject_();}
  if(incoming.events){if(!webhookAllowed_(e))return publicReject_();}
  else if(!PUBLIC_POST_ACTIONS_[incoming.action])return publicReject_();`);
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
var ADMIN_PAGES_={Admin:true,Karte:true,TodaySplit:true,LineSetup:true,TriggerSetup:true,Uriage:true,MondoPrint:true,MondoKotsuPrint:true};
function doGet(e){
  var page=e&&e.parameter&&e.parameter.page||'Admin';
  if(!ADMIN_PAGES_[page])throw new Error('Unknown page');
  var template=HtmlService.createTemplateFromFile(page);
  template.webAppUrl=ScriptApp.getService().getUrl();
  return template.evaluate().setTitle('倉治整骨院 管理システム');
}
function adminRequest(request){
  if(!request||!request.method)throw new Error('Invalid request');
  var output;
  if(request.method==='GET'){
    output=adminApiGet_({parameter:request.params||{}});
  }else if(request.method==='POST'){
    output=adminApiPost_({postData:{contents:JSON.stringify(request.body||{})},parameter:{}});
  }else throw new Error('Invalid method');
  return output.getContent();
}
`;
writeGenerated('Admin.gs', admin);

const bridgeTag = `<script>\nwindow.KURAJI_ADMIN_URL=<?!= JSON.stringify(webAppUrl) ?>;\nfunction adminPageUrl(page){return window.KURAJI_ADMIN_URL+'?page='+encodeURIComponent(page)}\n${bridge}\n</script>\n`;
const pages = {
  Admin: 'kanri.html', Karte: 'karte.html', TodaySplit: 'today_split.html',
  LineSetup: 'line_setup.html', TriggerSetup: 'gas_trigger_setup.html',
  Uriage: 'uriage.html', MondoPrint: 'mondo_print.html', MondoKotsuPrint: 'mondo_kotsu_print.html',
};
const publicPages = ['book.html', 'confirm.html', 'consent.html', 'symptom.html', 'line_template.html', 'gas_update.html', 'gas_copy.html'];
for (const [name, filename] of Object.entries(pages)) {
  let html = fs.readFileSync(path.join(root, filename), 'utf8');
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
