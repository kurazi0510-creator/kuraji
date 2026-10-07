import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync('kanri.html','utf8');
function fn(name){const start=html.indexOf('function '+name+'('),tail=html.slice(start),next=tail.slice(10).search(/\n(?:async )?function /);assert.ok(start>=0);return tail.slice(0,next<0?undefined:next+10)}
const values=new Map(),writes=[];
const c={storedSaveValues:new Map(),purgeDeletedCardCaches(){},cleanCachedPatientAddresses(){},deletedPatientIds:new Set(),extraSlotsByDate:{},patients:[{id:'2088',name:'患者'}],bookings:{'2026-10-07':{a:{cardId:'2088'}}},uriage:[],bussanLog:[],bussanMaster:[],shochiMaster:[],stockData:[],ticketMaster:[],patientTickets:[],dataRenderVersion:0,localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);writes.push(k)}},console};
vm.createContext(c);vm.runInContext(fn('save'),c);c.save();assert.equal(writes.length,13);writes.length=0;c.save();assert.deepEqual(writes,[]);assert.equal(c.dataRenderVersion,1);
c.patients[0].name='更新';c.save();assert.deepEqual(writes,['kj_p']);writes.length=0;
c.bookings['2026-10-07'].a.name='更新';c.save();assert.ok(writes.includes('kj_b'));assert.ok(writes.includes('kj_b_bak'));assert.ok(!writes.includes('kj_p'));assert.deepEqual(JSON.parse(values.get('kj_b')),JSON.parse(values.get('kj_b_bak')));
let shochi=0,bussan=0;
const t={modalDetailRenderPending:{shochi:true,bussan:true},renderMShochiBtns:()=>shochi++,renderMBussanItems:()=>bussan++,document:{querySelectorAll:()=>Array.from({length:4},()=>({classList:{toggle(){}}}))}};
vm.createContext(t);vm.runInContext(fn('switchMTab'),t);t.switchMTab('basic');assert.equal(shochi+bussan,0);t.switchMTab('shochi');t.switchMTab('shochi');assert.equal(shochi,1);t.switchMTab('bussan');t.switchMTab('bussan');assert.equal(bussan,1);
assert.ok(html.includes('更新版：2026-10-07-1205'));
console.log('PASS: hidden detail panes render once on demand; unchanged save writes nothing; patient-only changes preserve booking backup; booking changes update backup and preserve other stores.');
