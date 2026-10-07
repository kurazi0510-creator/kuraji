import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=fs.readFileSync('kanri.html','utf8');function fn(name){const tail=html.slice(html.indexOf('function '+name+'('));const end=tail.slice(10).search(/\n(?:async )?function /);return tail.slice(0,end<0?undefined:end+10);}
const amount={value:'',dataset:{},disabled:false};const elements={'m-pay-amount':amount,'m-shochi-discount':{value:'0'},'m-bussan-discount':{value:'0'}};
const c={document:{getElementById:id=>elements[id]},window:{},shochiMaster:[{id:'h',name:'水素+ツイスター',price:1100}],mShochiSel:{h:1},bussanMaster:[{id:'b',name:'商品',price:500}],mBussanQty:{},mBussanPrice:{},mBussanDisc:{},payItems:[{id:'fee',label:'施術料',amount:'3500',qty:1}],Map,String,Math,parseInt};vm.createContext(c);for(const n of ['calculatePaymentTotal','recalcTotalPay','updatePayDetailSummary','recalcTotalPayWithQty','updateShochiNet'])vm.runInContext(fn(n),c);
c.recalcTotalPay(true);assert.equal(amount.value,'4600','3500 fee plus 1100 treatment');
c.mShochiSel.h=2;c.updatePayDetailSummary();assert.equal(amount.value,'5700','quantity changes update immediately even without summary DOM');
c.payItems.push({label:'水素+ツイスター',qty:1,amount:'1100'});c.recalcTotalPay(true);assert.equal(amount.value,'5700','same treatment in both sections counted once per unit');
c.mShochiSel.h=1;c.recalcTotalPay(true);assert.equal(amount.value,'4600');
c.payItems.pop();c.mBussanQty.b=2;c.recalcTotalPay(true);assert.equal(amount.value,'5600');
elements['m-shochi-discount'].value='100';c.recalcTotalPay();assert.equal(amount.value,'5500','discount is applied');
c.mShochiSel={};c.mBussanQty={};c.recalcTotalPay();assert.equal(amount.value,'3500','deselecting extras removes their charge');
amount.dataset.manual='1';amount.value='3200';c.mShochiSel={h:1};c.recalcTotalPay();assert.equal(amount.value,'3200','intentional manual override is preserved');c.recalcTotalPay(true);assert.equal(amount.value,'4500','explicit payment change resumes automatic calculation');
c.payItems=[];c.recalcTotalPay(true);assert.equal(amount.value,'1000','detail-only payment also calculated');
c.payItems=[{id:'pi-legacy',label:'施術料',amount:'4600',coversDetails:true}];c.recalcTotalPay(true);assert.equal(amount.value,'4600','legacy saved total is not double counted');
console.log('PASS: 3500+1100=4600; quantity, removal, goods, discount, duplicate coverage, manual override and legacy total');
