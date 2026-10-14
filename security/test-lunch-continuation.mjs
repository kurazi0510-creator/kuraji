import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=fs.readFileSync('kanri.html','utf8');
function fn(src,name){let start=src.indexOf('function '+name+'(');assert.ok(start>=0,name);if(src.slice(start-6,start)==='async ')start-=6;const tail=src.slice(start),next=tail.slice(10).search(/\n(?:async )?function /);return tail.slice(0,next<0?undefined:next+10);}
const nodes={};function node(id){return nodes[id]??={value:'',dataset:{},style:{},textContent:'',disabled:false,classList:{toggle:()=>{},contains:()=>false}};}
let nbSlot=1,alerts=[];
const weekly={0:{closed:true,am:null,pm:null},1:{closed:false,am:['08:30','12:30'],pm:['15:00','20:00']},2:{closed:false,am:['08:30','12:30'],pm:['15:00','20:00']},3:{closed:false,am:['08:30','12:30'],pm:['15:00','20:00']},4:{closed:false,am:['08:30','12:30'],pm:['','']},5:{closed:false,am:['08:30','12:30'],pm:['15:00','20:00']},6:{closed:false,am:['08:30','12:30'],pm:['','']}};
const c={deletedPatientIds:new Set(),console,JSON,Date,Math,Set,Object,Number,String,parseInt,isNaN,alert:m=>alerts.push(m),confirm:()=>true,window:{},
  document:{getElementById:node,querySelector:()=>null,querySelectorAll:sel=>sel.startsWith('[id^=nb-slot-]')?[{id:'nb-slot-'+nbSlot,classList:{contains:()=>true}}]:[]},
  bizHours:{weekly,overrides:{}},extraSlotsByDate:{},extraSlotsForCurrentDate:[],
  bookings:{},patients:[{id:'34',name:'白井'},{id:'2053',name:'中谷'},{id:'2088',name:'岩田'}],stockData:[],editDate:'2026-10-14',editSlot:'12:10',mKubunSel:['自費'],mPaySel:[],mBuiSel:[],mShochiSel:{},mBussanQty:{},mBussanPrice:{},mBussanDisc:{},shochiMaster:[],bussanMaster:[],payItems:[],couponData:{},mSlotCount:1,
  pad:n=>String(n).padStart(2,'0'),getKubunPrimary:()=> '自費',elapsed:()=>0,calcVisitCount:()=>0,save:()=>{},renderSched:()=>{},renderPatients:()=>{},closeModal:()=>{},pushB:async()=>true,pushP:async()=>true,pushStock:()=>{},setStat:()=>{}};
vm.createContext(c);
for(const n of ['getBizDayConfig','genSlotsFromRange','dayType','getSlots','moveTimeBy20','lunchBlockedSlot','slotsBeforeLunch','bookingSpanCount','familyBookingBlock','arrivalTimeForSave','bookingDetail','bookingDetailsForSave','setSlotCount','saveBk','bookNextAppt'])vm.runInContext(fn(html,n),c);
async function book(date,slot,count,{name='白井',id='34',companion=''}={}){c.editDate=date;c.editSlot=slot;c.mSlotCount=count;node('m-nm').value=name;node('m-id').value=id;node('m-family-patient').value=companion;await c.saveBk();return c.bookings[date]||{};}
const W='2026-10-14',TH='2026-10-15';

// 12:10開始は2枠でも3枠でも12:10の1枠で止める
for(const n of [2,3]){c.bookings={};const day=await book(W,'12:10',n);assert.deepEqual(Object.keys(day),['12:10'],n+'枠');}
// 11:50開始の3枠は12:10までで止める
c.bookings={};assert.deepEqual(Object.keys(await book(W,'11:50',3)).sort(),['11:50','12:10']);
// 午前のみの日も12:30以降へは延ばさない
c.bookings={};assert.deepEqual(Object.keys(await book(TH,'12:10',2)),['12:10']);
// 院長が特別枠を追加した日は、その枠まで使える
c.extraSlotsByDate={[W]:['12:30']};c.bookings={};
assert.deepEqual(Object.keys(await book(W,'12:10',3)).sort(),['12:10','12:30']);assert.equal(c.bookings[W]['12:30'].cont,true);
c.extraSlotsByDate={[W]:['12:30','12:50']};c.bookings={};
assert.deepEqual(Object.keys(await book(W,'12:10',3)).sort(),['12:10','12:30','12:50']);
c.extraSlotsByDate={};
// 既存の昼休み側の継続行（白井様 12:30）は、再保存しても作り直し・削除のどちらもしない
c.bookings={[W]:{'12:10':{name:'白井',cardId:'34',kubun:'自費'},'12:30':{cont:true,name:'白井',cardId:'34',patientGeneration:'g'}}};
await book(W,'12:10',2);assert.deepEqual(c.bookings[W]['12:30'],{cont:true,name:'白井',cardId:'34',patientGeneration:'g'});
// 同時来院で昼休みにかかる場合は保存せずに知らせる
c.bookings={};alerts=[];await book(W,'12:10',2,{name:'中谷',id:'2053',companion:'2088'});
assert.equal(c.bookings[W]&&Object.keys(c.bookings[W]).length||0,0);assert.match(alerts.at(-1),/昼休み/);
// 夕方の時間外への延長（19:40→20:20）は従来どおり
c.bookings={};assert.deepEqual(Object.keys(await book(W,'19:40',3)).sort(),['19:40','20:00','20:20']);
// 午後の交通事故3枠は今までどおり
c.bookings={};assert.deepEqual(Object.keys(await book(W,'15:20',3,{name:'中谷',id:'2053'})).sort(),['15:20','15:40','16:00']);

// 次回予約フォームも昼休みや午後(15:00)へ飛ばない
for(const [slot,n,want] of [['12:10',3,['12:10']],['11:50',3,['11:50','12:10']],['19:20',3,['19:20','19:40']]]){
  c.bookings={};c.window._foundNextAppt=null;nbSlot=n;node('nb-date').value=W;node('nb-time').value=slot;node('m-nm').value='白井';node('m-id').value='34';
  c.bookNextAppt();assert.deepEqual(Object.keys(c.bookings[W]).sort(),want,slot+' '+n+'枠');
}
c.extraSlotsByDate={[W]:['12:30']};c.bookings={};nbSlot=2;node('nb-time').value='12:10';c.bookNextAppt();assert.deepEqual(Object.keys(c.bookings[W]).sort(),['12:10','12:30']);
console.log('PASS: continuation slots stop before lunch (12:10 start keeps 1 slot), special lunch slots are usable, existing lunch rows are left untouched, family bookings are refused, evening extension unchanged.');
