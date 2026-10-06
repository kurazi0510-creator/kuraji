import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=fs.readFileSync('kanri.html','utf8'),gs=fs.readFileSync('gas_full_v5.gs','utf8');
function fn(src,name){let start=src.indexOf('function '+name+'(');assert.ok(start>=0,name);if(src.slice(start-6,start)==='async ')start-=6;const tail=src.slice(start),next=tail.slice(10).search(/\n(?:async )?function /);return tail.slice(0,next<0?undefined:next+10);}
const store={},dateNode={value:'2026-10-06'};
const c={console,JSON,Date,Math,Set,Object,Number,String,pad:n=>String(n).padStart(2,'0'),localStorage:{setItem:(k,v)=>store[k]=v},document:{getElementById:()=>dateNode},bookings:{},extraSlotsByDate:{},extraSlotsForCurrentDate:[],extraSlotWrites:new Set(),renderSched:()=>{},renderExtraSlotButtons:()=>{},setStat:()=>{},alert:()=>{},GAS:'mock'};vm.createContext(c);
for(const n of ['fmtTime','loadExtraSlotsThenRender','toggleExtraSlotUI'])vm.runInContext(fn(html,n),c);
for(const t of ['07:50','08:10','12:50','13:10','13:30','14:00','14:20','14:40','20:00','20:20'])assert.equal(c.fmtTime(t),t);
assert.equal(c.fmtTime('8:10'),'08:10');assert.equal(c.fmtTime(490/1440),'08:10');assert.equal(c.fmtTime('14:50'),'14:50');
c.fetch=async()=>({json:async()=>({ok:true})});await c.toggleExtraSlotUI('07:50');await c.toggleExtraSlotUI('08:10');assert.deepEqual(JSON.parse(store.kj_extra_slots),{'2026-10-06':['07:50','08:10']});
c.extraSlotsByDate=JSON.parse(store.kj_extra_slots);c.extraSlotsForCurrentDate=[];
c.fetch=async()=>{throw Error('offline')};await c.loadExtraSlotsThenRender();assert.deepEqual(Array.from(c.extraSlotsForCurrentDate),['07:50','08:10']);
let resolve;c.fetch=()=>new Promise(r=>resolve=r);const pending=c.loadExtraSlotsThenRender();dateNode.value='2026-10-07';c.extraSlotsByDate['2026-10-07']=['13:10'];c.extraSlotsForCurrentDate=['13:10'];resolve({json:async()=>({ok:true,extra:['07:50','08:10']})});await pending;assert.deepEqual(Array.from(c.extraSlotsForCurrentDate),['13:10'],'stale response must not change selected day');
dateNode.value='2026-10-06';c.extraSlotsForCurrentDate=['07:50','08:10'];c.bookings={'2026-10-06':{'07:50':{name:'テスト',payAmount:'3980'}}};let called=0;c.fetch=async()=>{called++;return{json:async()=>({ok:true})}};await c.toggleExtraSlotUI('07:50');assert.equal(called,0);assert.equal(c.bookings['2026-10-06']['07:50'].payAmount,'3980');
let data=[['date','time','note'],['2026-10-06','7:50',''],['2026-10-06','08:10',''],['2026-10-06','08:10',''],[new Date('2026-10-07T00:00:00Z'),'13:10','']];let deleted=[],bookingRows=[['日付'],['2026-10-06','07:50','保険','テスト','1']];
const sheet={getDataRange:()=>({getValues:()=>data}),getLastRow:()=>data.length,getRange:()=>({setNumberFormat:()=>{},setValues:rows=>data.push(...rows)}),deleteRow:i=>{deleted.push(i);data.splice(i-1,1)}};
const b={getDataRange:()=>({getValues:()=>bookingRows}),clearContents:()=>{throw Error('unexpected destructive reset')},getRange:()=>({setValues:()=>{}})};
const g={console,JSON,Date,String,Object,Number,Error,Utilities:{formatDate:d=>d.toISOString().slice(0,10)},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>n==='extra_slots'?sheet:n==='予約表'?b:null})}};vm.createContext(g);
for(const n of ['toHHMM_','bookingRowDetail_','bookingResourceTime_','bookingRowOccupied_','getAllExtraSlots_','getExtraSlotsForDate','getExtraSlotsSet_','toggleExtraSlot','resetBookings','slotOverlaps_'])vm.runInContext(fn(gs,n),g);
assert.deepEqual(Array.from(g.getExtraSlotsForDate('2026-10-06').extra),['07:50','08:10']);assert.equal(g.getAllExtraSlots_()['2026-10-07'][0],'13:10');assert.equal(g.toggleExtraSlot('2026-10-06','07:50',false).ok,false);assert.equal(deleted.length,0);assert.throws(()=>g.resetBookings(),/予約が残って/);assert.equal(g.toggleExtraSlot('2026-10-06','08:10',false).ok,true);assert.equal(g.getExtraSlotsForDate('2026-10-06').extra.includes('08:10'),false);assert.equal(g.slotOverlaps_('14:00',{'13:50':true}),true);assert.equal(g.slotOverlaps_('14:10',{'13:50':true}),false);
assert.ok(html.includes('await loadExtraSlotsThenRender(true);\n  // ふりがな'));
console.log('PASS: exact early/lunch/late times, saved daily slot cache, offline reload, stale-response isolation, occupied-slot deletion guard, server dedup/date normalization, safe reset and 20-minute overlap.');
// Exercise the actual getAll synchronization parser after a completely empty local reset.
Object.assign(c,{AbortController,setTimeout:()=>0,clearTimeout:()=>{},patients:[],uriage:{},recalcAllVisitCounts:()=>{},syncLineIds:()=>{},checkElapsedAlert:()=>{},renderPatients:()=>{},pullStock:()=>{},save:()=>{},today:()=> '2026-10-06',tryParse:v=>JSON.parse(v)});
for(const n of ['fmtDate','bookingDetail','syncAll'])vm.runInContext(fn(html,n),c);
const headers=Array(21).fill('');headers[0]='日付';headers[20]='予約詳細(JSON)';
const early=['2026-10-06','07:50','保険','親','1',...Array(10).fill('')];early[15]='3980';early[20]=JSON.stringify({resourceSlot:'07:50',payItems:[{label:'施術料',unitPrice:3980,amount:3980,qty:1}]});
const legacy=['2026-10-06','08:10','保険','子','2'];
c.bookings={};c.extraSlotsByDate={};c.extraSlotsForCurrentDate=[];c.fetch=async()=>({ok:true,text:async()=>JSON.stringify({ok:true,customers:[[]],uriage:[[]],bookings:[headers,early,legacy],extraSlotsByDate:{'2026-10-06':['07:50','08:10']}})});
await c.syncAll();assert.equal(c.bookings['2026-10-06']['07:50'].payAmount,'3980');assert.equal(c.bookings['2026-10-06']['07:50'].payItems[0].amount,3980);assert.equal(c.bookings['2026-10-06']['08:10'].name,'子');assert.equal(c.bookings['2026-10-06']['08:30'],undefined);assert.deepEqual(Array.from(c.extraSlotsForCurrentDate),['07:50','08:10']);
// Cancellation/deletion failures must keep the original booking and must not notify a waitlist.
c.confirm=()=>true;c.moveTimeBy20=(t,n)=>{let [h,m]=t.split(':').map(Number);return c.pad(h+Math.floor((m+20*n)/60))+':'+c.pad((m+20*n)%60)};
for(const n of ['bookingSpanCount','familyBookingBlock','delBk','execCancel'])vm.runInContext(fn(html,n),c);
c.pushB=async()=>false;let notifications=0;c.fetch=async()=>{notifications++;return{}};const beforeBooking=JSON.stringify(c.bookings);await c.delBk('2026-10-06','07:50');assert.equal(JSON.stringify(c.bookings),beforeBooking);
c.cancelDate='2026-10-06';c.cancelSlot='07:50';c.cancelReasonVal='体調不良';dateNode.value='';await c.execCancel();assert.equal(JSON.stringify(c.bookings),beforeBooking);assert.equal(notifications,0);
console.log('PASS: real syncAll parser restores early appointments/payments/details and extra slots from empty local state; failed cancellation/deletion keeps bookings and triggers no notifications.');

dateNode.value='2026-10-06';c.extraSlotsLoadedFromServer=true;let extraReads=0;c.fetch=async()=>{extraReads++;return {json:async()=>({ok:true,extra:['07:50']})}};await c.loadExtraSlotsThenRender(true);assert.equal(extraReads,0,'startup must reuse fresh getAll slots');await c.loadExtraSlotsThenRender();assert.equal(extraReads,1,'explicit date load still refreshes server');
