import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const source = fs.readFileSync(path.join(dist, 'Public.gs'), 'utf8');
const admin = fs.readFileSync(path.join(dist, 'Admin.gs'), 'utf8');
new vm.Script(source);new vm.Script(admin);
assert.equal(admin.includes('SpreadsheetApp.getActiveSpreadsheet()'),false);
const sheetSentinel={};
const adminCtx={PropertiesService:{getScriptProperties(){return {getProperty(){return 'test-sheet-id';}};}},SpreadsheetApp:{openById(id){assert.equal(id,'test-sheet-id');return sheetSentinel;}}};
vm.createContext(adminCtx);vm.runInContext(admin,adminCtx);
assert.equal(adminCtx.adminSpreadsheet_(),sheetSentinel);
adminCtx.PropertiesService.getScriptProperties=()=>({getProperty:()=>null});
assert.throws(()=>adminCtx.adminSpreadsheet_(),/SPREADSHEET_ID/);
const ctx = {
  ContentService: {
    MimeType: {JSON: 'json', JAVASCRIPT: 'js'},
    createTextOutput(content) {return {content, setMimeType(){return this;}, getContent(){return this.content;}};},
  },
  PropertiesService: {getScriptProperties(){return {getProperty(name){return name==='LINE_WEBHOOK_FORWARD_KEY'?'test-key':null;}};}},
  Logger: {log(){}},
};
vm.createContext(ctx);
vm.runInContext(source, ctx);
const get = params => JSON.parse(ctx.doGet({parameter:params}).getContent());
const post = (body, parameter = {}) => JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(body)},parameter}).getContent());
for (const action of ['getAll','getLineUsers','getWebBookingRequests','lookupBooking','getKarteListByCardId']) {
  assert.equal(get({action}).ok, false, `GET ${action} must fail`);
}
for(const action of ['constructor','toString','__proto__']){
  assert.equal(get({action}).ok,false);
  assert.equal(post({action}).ok,false);
}
for(const body of [null,[],true,'test',{events:{}},{events:[],action:'getAll'}])assert.equal(post(body).ok,false);
assert.equal(ctx.verifiedBookingLookupUid_('09012345678'),'');
const verifiedUid='U'+'a'.repeat(32);
ctx.PropertiesService.getScriptProperties=()=>({getProperty:name=>name==='BOOKING_LOOKUP_VERIFIED_LINKS'?JSON.stringify({'09012345678':verifiedUid}):name==='LINE_WEBHOOK_FORWARD_KEY'?'test-key':null});
assert.equal(ctx.verifiedBookingLookupUid_('09012345678'),verifiedUid);
assert.equal(ctx.verifiedBookingLookupUid_('09099999999'),'');
let evaluated=false;
adminCtx.HtmlService={createTemplateFromFile(){return {evaluate(){evaluated=true;return {setTitle(){return this;}};}};}};
adminCtx.ScriptApp={getService:()=>({getUrl:()=> 'https://example.invalid/exec'})};
assert.throws(()=>adminCtx.doGet({parameter:{page:'constructor'}}),/Unknown page/);
assert.equal(evaluated,false);
let template;
adminCtx.HtmlService.createTemplateFromFile=()=>template={evaluate:()=>({setTitle(){return this;}})};
adminCtx.doGet({parameter:{page:'Karte',name:'</script><script>alert(1)</script>'}});
assert.equal(template.pageParamsJson.includes('<'),false);
assert.equal(JSON.parse(template.pageParamsJson).name,'</script><script>alert(1)</script>');
for (const action of ['lineNotifyV2','testLineOwner','saveBookings','deletePatientByCardId','runDayBeforeRemindersNow']) {
  assert.equal(post({action,userId:'attacker',message:'test'}).ok, false, `POST ${action} must fail`);
}
assert.equal(post({events:[{type:'message'}]}).ok,false,'spoofed LINE webhook must fail');
ctx.getAvailableSlots=()=>({ok:true,available:['15:00']});
assert.equal(get({action:'getAvailableSlots',date:'2026-09-30'}).available[0],'15:00');
ctx.requestBookingLookupCode=()=>({ok:true});
assert.equal(post({action:'requestBookingLookupCode',tel:'09012345678'}).ok,true);
assert.equal(get({action:'getAvailableSlots',callback:'evil();',date:'2026-09-30'}).ok,false);
const page=fs.readFileSync(path.join(dist,'Admin.html'),'utf8');
assert.match(page,/google\.script\.run/);
assert.match(page,/adminPageUrl\('Karte'\)/);
assert.match(page,/adminPageUrl\('TriggerSetup'\)/);
const bridge=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'admin_fetch_bridge.js'),'utf8');
let intercepted;
const nativeCalls=[];
const bridgeCtx={
  window:{fetch:async url=>{nativeCalls.push(url);return {ok:true};}},
  URL,Response,location:{href:'https://script.googleusercontent.com/iframe'},
  google:{script:{run:{
    withSuccessHandler(cb){this.success=cb;return this;},
    withFailureHandler(cb){this.failure=cb;return this;},
    adminRequest(req){intercepted=req;this.success('{"ok":true}');},
  }}},
};
vm.createContext(bridgeCtx);vm.runInContext(bridge,bridgeCtx);
const gas='https://script.google.com/macros/s/AKfycbxN8GuaDOG2WnR9OiJINtqoMOz2guWn-TrmRlkLQIs3QAvuLZxDh1obSNGDbpFto2oltg/exec';
assert.equal((await bridgeCtx.window.fetch(gas+'?action=getAll')).ok,true);
assert.equal(intercepted.params.action,'getAll');
await bridgeCtx.window.fetch(gas,{method:'POST',body:JSON.stringify({action:'lineNotifyV2',userId:'test'})});
assert.equal(intercepted.body.action,'lineNotifyV2');
await bridgeCtx.window.fetch('https://example.com/public');
assert.equal(nativeCalls.length,1);
const {default: worker}=await import('./line-webhook-worker.js');
const env={LINE_CHANNEL_SECRET:'test-channel-secret',GAS_WEBHOOK_URL:'https://example.invalid/exec?webhookKey=not-real'};
let forwarded=0;
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>{forwarded++;return {ok:true,json:async()=>({ok:true})};};
try{
  const raw='{"events":[]}';
  const invalid=await worker.fetch(new Request('https://worker.example/',{method:'POST',body:raw,headers:{'x-line-signature':'wrong'}}),env);
  assert.equal(invalid.status,401);assert.equal(forwarded,0);
  const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(env.LINE_CHANNEL_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('base64');
  const valid=await worker.fetch(new Request('https://worker.example/',{method:'POST',body:raw,headers:{'x-line-signature':sig}}),env);
  assert.equal(valid.status,200);assert.equal(forwarded,1);
  const signedRequest=()=>new Request('https://worker.example/',{method:'POST',body:raw,headers:{'x-line-signature':sig}});
  globalThis.fetch=async()=>({ok:true,json:async()=>({ok:false})});
  assert.equal((await worker.fetch(signedRequest(),env)).status,502);
  globalThis.fetch=async()=>{throw new Error('temporary upstream failure')};
  assert.equal((await worker.fetch(signedRequest(),env)).status,502);
}finally{globalThis.fetch=oldFetch;}
console.log('Security routing and webhook-signature tests passed');
