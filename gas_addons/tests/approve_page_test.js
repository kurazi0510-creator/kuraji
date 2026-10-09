const fs=require('fs'),vm=require('vm');
const H=["候補日","診察券No","患者名","前回来院日","経過日数","タイミング","ステージ","次回予約","送信する文面（編集できます）","送信OK","結果","結果日時","メモ","重複チェック用キー"];
const rows=[H.slice(),["2026-10-09","1","A","2026-09-25",14,"14日","14","なし","old",false,"","","","k1"],["2026-10-09","2","B","2026-10-08",1,"翌日","1","なし","old2",true,"送信済み","","","k2"]];
const sh={getLastRow:()=>rows.length,getRange:(r,c,nr,nc)=>({getValues:()=>[rows[r-1].slice(c-1,c-1+(nc||1))].concat([]).slice(0,1).length&&Array.from({length:nr||1},(_,i)=>rows[r-1+i].slice(c-1,c-1+(nc||1))),setValue:v=>{rows[r-1][c-1]=v}})};
const ctx={SpreadsheetApp:{openById:()=>({getSheetByName:()=>sh}),flush(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>({AP_TOKEN:"T",AP_SHEET_ID:"x"})[k]})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Utilities:{},Logger:{log(){}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('approve_page/Code.gs','utf8'),ctx);
const a=(c,m)=>{if(!c){console.log("NG",m);process.exitCode=1}else console.log("OK",m)};
a(ctx.apList("T").length===1,"結果が空の行だけ一覧");
let r=ctx.apSave("T",[{row:2,key:"k1",text:"new",ok:true}]);a(r[0].ok&&rows[1][8]==="new"&&rows[1][9]===true,"編集＋送信OK");
r=ctx.apSave("T",[{row:2,key:"zz",text:"x",ok:true}]);a(!r[0].ok&&rows[1][8]==="new","キー不一致は書かない");
r=ctx.apSave("T",[{row:3,key:"k2",text:"x",ok:true}]);a(!r[0].ok&&rows[2][8]==="old2","処理済み行は書かない");
r=ctx.apSave("T",[{row:2,key:"k1",text:" ",ok:true}]);a(!r[0].ok,"空文面は送信OKにしない");
try{ctx.apList("bad");a(false,"トークン")}catch(e){a(true,"トークン違いは拒否")}
const fixed=new Date();
ctx.CacheService={getScriptCache:()=>({_m:{},get(k){return this._m[k]||null},put(k,v){this._m[k]=v},remove(k){delete this._m[k]}})};
ctx.Utilities={formatDate:(d,tz,f)=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10)};
rows[1][0]=ctx.Utilities.formatDate(new Date());rows[2][0]=rows[1][0];
ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>({AP_TOKEN:"T",AP_SHEET_ID:"x",AP_VIEW_PIN:"pinpin12"})[k]})};
const v=ctx.apView("pinpin12");a(v.length===2&&v[0].text!==undefined,"閲覧：直近の候補が見える");
a(v.some(x=>x.status==="送信済み")&&v.some(x=>x.status.indexOf("送信待ち")>0),"閲覧：状態が出る");
let bad=0;for(let i=0;i<6;i++){try{ctx.apView("x")}catch(e){bad++}}a(bad===6,"閲覧：間違いは拒否");
try{ctx.apView("pinpin12");a(false,"ロック")}catch(e){a(/間違えすぎ/.test(e.message),"閲覧：5回失敗でロック")}
