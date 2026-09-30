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
const status=get({action:'getPublicSecurityStatus'});
assert.equal(status.version,'kuraji-public-boundary-20260930');
assert.equal(status.managementAccess,false);
assert.equal(status.webhookRequiresRelay,true);
const legacyActions=[...new Set([...source.matchAll(/action\s*===\s*"([^"]+)"/g)].map(m=>m[1]))];
for(const action of legacyActions){
  if(!Object.hasOwn(ctx.PUBLIC_GET_ACTIONS_,action))assert.equal(get({action}).ok,false,`GET ${action}`);
  if(!Object.hasOwn(ctx.PUBLIC_POST_ACTIONS_,action))assert.equal(post({action}).ok,false,`POST ${action}`);
}
ctx.LockService={getScriptLock:()=>({waitLock(){throw new Error('lock busy')},releaseLock(){}})};
assert.equal(post({events:[]},{webhookKey:'test-key'}).ok,false,'lock failures must not be acknowledged as success');
ctx.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
assert.equal(post({events:[]},{webhookKey:'test-key'}).ok,true,'valid LINE verification request');
assert.equal(post({events:[null]},{webhookKey:'test-key'}).ok,false,'failed LINE event must not report success');
const webhookCache=new Map();
ctx.CacheService={getScriptCache:()=>({get:key=>webhookCache.get(key)||null,put:(key,value)=>webhookCache.set(key,value)})};
ctx.Utilities={DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,text)=>text,base64EncodeWebSafe:text=>Buffer.from(text).toString('base64url')};
let savedUsers=0;
ctx.saveLineUserId=()=>{savedUsers++;};
ctx.findPendingWebRequestByName_=()=>null;
const event={webhookEventId:'test-event-id',type:'message',source:{userId:'test-line-user'},message:{type:'text',text:'test-name'}};
assert.equal(post({events:[event]},{webhookKey:'test-key'}).ok,true);
assert.equal(post({events:[event]},{webhookKey:'test-key'}).ok,true);
assert.equal(savedUsers,1,'completed event must not run twice during cache window');
const failedEvent={...event,webhookEventId:'retry-event-id'};
ctx.saveLineUserId=()=>{throw new Error('temporary write failure');};
assert.equal(post({events:[failedEvent]},{webhookKey:'test-key'}).ok,false);
ctx.saveLineUserId=()=>{savedUsers++;};
assert.equal(post({events:[failedEvent]},{webhookKey:'test-key'}).ok,true);
assert.equal(savedUsers,2,'failed event must be retryable');
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
let forwarded=0, forwardedRequest;
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{forwarded++;forwardedRequest={url,options};return {ok:true,status:200,json:async()=>({ok:true})};};
try{
  const raw='{"events":[]}';
  const invalid=await worker.fetch(new Request('https://worker.example/',{method:'POST',body:raw,headers:{'x-line-signature':'wrong'}}),env);
  assert.equal(invalid.status,401);assert.equal(forwarded,0);
  const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(env.LINE_CHANNEL_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('base64');
  const valid=await worker.fetch(new Request('https://worker.example/',{method:'POST',body:raw,headers:{'x-line-signature':sig}}),env);
  assert.equal(valid.status,200);assert.equal(forwarded,1);
  assert.equal(forwardedRequest.url,env.GAS_WEBHOOK_URL);
  assert.equal(forwardedRequest.options.redirect,'follow');
  assert.equal(new TextDecoder().decode(forwardedRequest.options.body),raw);
  const tampered=await worker.fetch(new Request('https://worker.example/',{method:'POST',body:'{"events":[{}]}',headers:{'x-line-signature':sig}}),env);
  assert.equal(tampered.status,401);assert.equal(forwarded,1);
  assert.equal((await worker.fetch(new Request('https://worker.example/'),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://worker.example/',{method:'POST',body:raw}),{})).status,503);
  const signedRequest=()=>new Request('https://worker.example/',{method:'POST',body:raw,headers:{'x-line-signature':sig}});
  globalThis.fetch=async()=>({ok:false,status:403});
  assert.equal((await worker.fetch(signedRequest(),env)).status,502);
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('HTML response')}});
  assert.equal((await worker.fetch(signedRequest(),env)).status,502);
  globalThis.fetch=async()=>({ok:true,json:async()=>({ok:false})});
  assert.equal((await worker.fetch(signedRequest(),env)).status,502);
  globalThis.fetch=async()=>{throw new Error('temporary upstream failure')};
  assert.equal((await worker.fetch(signedRequest(),env)).status,502);
  const logs=[],oldLog=console.log;
  console.log=(...args)=>logs.push(args);
  try {
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({ok:false,error:'権限がありません',patient:'DO_NOT_LOG_PATIENT'})});
    assert.equal((await worker.fetch(signedRequest(),env)).status,502);
    const printed=JSON.stringify(logs);
    assert.ok(printed.includes('"denied":true'));
    for(const secret of [env.LINE_CHANNEL_SECRET,env.GAS_WEBHOOK_URL,'not-real','DO_NOT_LOG_PATIENT',sig])assert.ok(!printed.includes(secret));
  } finally {console.log=oldLog;}
}finally{globalThis.fetch=oldFetch;}
console.log('Security routing and webhook-signature tests passed');
