import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const dist=new URL('./dist/',import.meta.url);
const tel='09012345678',otherTel='09099999999',uid='U'+'a'.repeat(32),otherUid='U'+'b'.repeat(32);
const data={
  '患者':[['id','name','x','x','phone'],['123','確認 太郎','','',tel],['124','別人 花子','','',tel]],
  '予約確認連携':[['tel','uid','cardId','name','status'],[tel,uid,'123','確認 太郎','有効']],
  '予約表':[['date','time','kubun','name','cardId','route','','','','','menu'],
    ['2099-10-01','8:30','自費','確認 太郎','123','','','','','','整体'],
    ['2099-10-01','8:50','自費(継続)','確認 太郎','123'],
    ['2099-10-02','10:00','キャンセル','確認 太郎','123'],
    ['2099-10-03','10:00','自費','別人 花子','124'],
    ['2000-10-01','10:00','自費','確認 太郎','123']],
  'web_yoyaku_meta':[['date'],['2099-12-01','10:00','古い控え',tel,'','誤表示を防ぐ']],
  'web_yoyaku_requests':[['headers'],
    ['2099-10-05','10:30','2099-10-06','11:30','','','確認 太郎',tel,'','整体','','未対応','','','123'],
    ['2099-10-05','10:30','','','','','別人 花子',tel,'','別人','','未対応','','','124'],
    ['2099-10-05','10:30','','','','','確認 太郎',tel,'','対応済み','','対応済み','','','123'],
    ['2099-10-05','10:30','','','','','確認 太郎',otherTel,'','別の電話','','未対応','','','123']],
};
const sheet=name=>data[name]?{
  getDataRange:()=>({getValues:()=>data[name]}),getLastRow:()=>data[name].length,
  appendRow:row=>data[name].push(row),
  getRange:(row,col=1)=>({setNumberFormat(){return this;},setValue(value){data[name][row-1][col-1]=value;return this;},setValues(rows){if(!data[name][row-1])data[name][row-1]=[];rows[0].forEach((v,i)=>data[name][row-1][col-1+i]=v);return this;}}),
}:null;
const ss={getSheetByName:sheet,insertSheet(name){data[name]=[];return sheet(name);}};
const cache=new Map(),props=new Map([['LINE_TOKEN','test-token']]);let sends=[];
const ctx={
  SpreadsheetApp:{getActiveSpreadsheet:()=>ss,openById:()=>ss},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||null})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,text)=>createHash('sha256').update(text).digest(),base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),getUuid:()=> '1234abcd-1234-1234-1234-123456789012',formatDate:(date,tz,format)=>format==='HH:mm'?'08:30':format==='yyyy-MM-dd'?'2026-10-01':'2026-10-01 12:00:00'},
};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('Public.gs',dist),'utf8'),ctx);
ctx.sendBookingLookupCode_=(_,to,message)=>{sends.push({to,message});return {ok:true};};
assert.equal(ctx.verifiedBookingLookupUid_(tel),uid);
assert.equal(ctx.verifiedBookingLookupUid_(otherTel),'');
let result=ctx.lookupBooking(tel);
assert.equal(result.list.length,1);assert.equal(result.list[0].time,'08:30');assert.equal(result.list[0].status,'確定');
assert.equal(result.requests.length,1);assert.equal(result.requests[0].candidates.length,2);
assert.equal(ctx.lookupBooking(otherTel).ok,false);
const generic=ctx.requestBookingLookupCode(otherTel);assert.equal(sends.length,0);
assert.equal(JSON.stringify(ctx.requestBookingLookupCode(tel)),JSON.stringify(generic));assert.equal(sends.length,1);assert.equal(sends[0].to,uid);
ctx.requestBookingLookupCode(tel);assert.equal(sends.length,1,'repeated request must not resend');
result=ctx.verifyBookingLookupCode(tel,'1234abcd');assert.equal(result.list.length,1);assert.equal(result.list[0].name,'確認 太郎');
assert.equal(ctx.verifyBookingLookupCode(tel,'1234abcd').ok,false,'code is one-time');
ctx.requestBookingLookupCode(tel);
for(let i=0;i<4;i++)assert.equal(ctx.verifyBookingLookupCode(tel,'FFFFFFFF').ok,false);
assert.equal(ctx.verifyBookingLookupCode(tel,'1234abcd').ok,false,'correct code after too many failures is rejected');
ctx.requestBookingLookupCode(tel);
const key=ctx.bookingLookupCacheKey_(tel);let state=JSON.parse(cache.get(key));state.expiresAt=Date.now()-1;cache.set(key,JSON.stringify(state));
assert.equal(ctx.verifyBookingLookupCode(tel,'1234abcd').ok,false,'expired code is rejected');
ctx.requestBookingLookupCode(tel);
data['予約確認連携'].push([tel,'','','','無効']);
assert.equal(ctx.verifiedBookingLookupUid_(tel),'');
assert.equal(ctx.verifyBookingLookupCode(tel,'1234abcd').ok,false,'revoked link invalidates outstanding code');
props.set('BOOKING_LOOKUP_VERIFIED_LINKS',JSON.stringify({[tel]:uid}));
assert.equal(ctx.verifiedBookingLookupUid_(tel),'','revocation overrides legacy property');
data['予約確認連携'].push([tel,uid,'123','確認 太郎','有効']);
data['患者'][1][4]=otherTel;
assert.equal(ctx.lookupBooking(tel).ok,false,'changed patient phone cannot expose old account');data['患者'][1][4]=tel;
ctx.sendBookingLookupCode_=()=>({ok:false});ctx.requestBookingLookupCode(tel);assert.equal(cache.has(key),false,'failed delivery removes the code');
const adminCtx={...ctx};vm.createContext(adminCtx);vm.runInContext(fs.readFileSync(new URL('Admin.gs',dist),'utf8'),adminCtx);
adminCtx.adminSpreadsheet_=()=>ss;adminCtx.getLineUsers=()=>({users:[{userId:uid,name:'確認 太郎'},{userId:otherUid,name:'別人 花子'}]});
assert.throws(()=>adminCtx.bookingLookupAdminRequest({action:'verify',tel,uid,cardId:'123'}),/確認/);
assert.throws(()=>adminCtx.bookingLookupAdminRequest({action:'verify',tel:otherTel,uid,cardId:'123',confirmed:true}),/一致/);
assert.equal(adminCtx.bookingLookupAdminRequest({action:'verify',tel,uid,cardId:'123',confirmed:true}).ok,true);
assert.equal(ctx.lookupBooking(tel).list.length,1);
assert.equal(adminCtx.bookingLookupAdminRequest({action:'revoke',tel}).ok,true);
assert.equal(ctx.lookupBooking(tel).ok,false);
assert.equal(fs.readFileSync(new URL('Public.gs',dist),'utf8').includes('function bookingLookupAdminRequest('),false);
for(const file of ['../confirm.html','./BookingLookup.html']){
  const html=fs.readFileSync(new URL(file,import.meta.url),'utf8');
  for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
}
console.log('Booking lookup: identity isolation, live bookings, pending requests, OTP and owner registration passed');

// Older patient sheets put telephone in column 4, rather than column 5.
data['患者']=data['患者'].map((r,i)=>i===0?['診察券No','患者名','性別','電話番号']: [r[0],r[1],'女性',r[4]]);
const candidates=adminCtx.bookingLookupAdminRequest({action:'list'}).patients;assert.equal(candidates[0].tel,tel);assert.equal(adminCtx.bookingLookupAdminRequest({action:'verify',tel,uid,cardId:'123',confirmed:true}).ok,true);assert.equal(ctx.lookupBooking(tel).list.length,1);assert.throws(()=>adminCtx.bookingLookupAdminRequest({action:'verify',tel:otherTel,uid,cardId:'123',confirmed:true}),/一致/);console.log('PASS: header-based phone column works for staff linking and public lookup; mismatched phone remains rejected.');
