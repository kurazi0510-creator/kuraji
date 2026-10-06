// Owner-only enhancement. Registration never runs in the public manager copy.
let lineRegistrationState={patients:[],links:[]};
function lineRegistrationRpc(request){return new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).bookingLookupAdminRequest(request));}
function lineRegistrationPhone(value){let digits=String(value||'').replace(/\D/g,'');if(digits.length>=9&&digits.length<=10&&digits[0]!=='0')digits='0'+digits;return digits;}
function lineRegistrationText(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
loadLineUsers=async function(){
 const list=document.getElementById('lu-list');list.replaceChildren(lineRegistrationText('p','読み込み中…'));
 try{
  const result=await lineRegistrationRpc({action:'list'});
  if(result.version!=='line-registration-20261001')throw new Error('管理用コードの更新が反映されていません。新バージョンでデプロイしてください。');
  lineRegistrationState=result;lineUsersCache=result.users||[];renderLineUsers();
 }catch(err){list.replaceChildren(lineRegistrationText('p',err.message));}
};
renderLineUsers=function(){
 const search=document.getElementById('lu-search');search.placeholder='名前・電話番号・診察券・メッセージで検索';
 const keyword=search.value.trim().replace(/\s/g,'').toLowerCase();
 const compact=value=>String(value||'').replace(/\s/g,'').toLowerCase();
 const candidates=user=>lineRegistrationState.patients.filter(p=>p.tel===lineRegistrationPhone(user.phone));
 const active=user=>lineRegistrationState.links.find(link=>link.active&&link.uid===user.userId);
 const category=user=>active(user)?'linked':lineRegistrationPhone(user.phone)?'phone':'missing';
 const selected=document.getElementById('lu-status-filter').value||'all';
 const filtered=lineUsersCache.filter(user=>(selected==='all'||category(user)===selected)&&(!keyword||[user.name,user.phone,user.cardId,user.lastMsg,...candidates(user).map(p=>p.name+' '+p.cardId)].some(value=>compact(value).includes(keyword))));
 filtered.sort((a,b)=>Number(!!active(a))-Number(!!active(b)));
 document.getElementById('lu-count-linked').textContent=lineUsersCache.filter(u=>category(u)==='linked').length;
 document.getElementById('lu-count-ok').textContent=lineUsersCache.filter(u=>category(u)==='phone').length;
 document.getElementById('lu-count-ng').textContent=lineUsersCache.filter(u=>category(u)==='missing').length;
 const list=document.getElementById('lu-list');list.replaceChildren();
 if(!filtered.length){list.append(lineRegistrationText('p','該当するLINEがありません'));return;}
 filtered.forEach(user=>{
  const row=document.createElement('section');row.style.cssText='padding:12px 4px;border-bottom:1px solid #ddd';
  const kind=category(user);
  const badge=lineRegistrationText('span',kind==='linked'?'✅ 予約確認 連携済み':kind==='phone'?'🟠 電話番号のみ登録':'⬜ 電話番号未登録');
  badge.style.cssText='display:inline-block;padding:5px 9px;margin:0 0 6px 8px;border-radius:6px;font-size:0.85rem;font-weight:bold;'+(kind==='linked'?'background:#dcfce7;color:#166534':kind==='phone'?'background:#fef3c7;color:#92400e':'background:#f3f4f6;color:#4b5563');
  row.append(lineRegistrationText('strong',user.name||'名前未登録'),badge,lineRegistrationText('p','最終メッセージ：'+String(user.lastMsg||'').slice(0,120)));
  const fields={};
  [['name','名前',user.name],['phone','電話番号',user.phone],['cardId','診察券番号',user.cardId]].forEach(([key,label,value])=>{
   const input=document.createElement('input');input.value=value||'';input.placeholder=label;input.style.cssText='padding:8px;margin:4px;width:150px';
   // Preserve the existing row-saving selectors.
   input.className=({'name':'lu-name','phone':'lu-phone','cardId':'lu-card'})[key];input.dataset.uid=user.userId;
   fields[key]=input;row.append(input);
  });
  const select=document.createElement('select');select.style.cssText='padding:8px;margin:4px;max-width:100%';
  const note=lineRegistrationText('p','');
  function updateCandidates(){
   const hits=lineRegistrationState.patients.filter(p=>p.tel===lineRegistrationPhone(fields.phone.value));
   select.replaceChildren(new Option(hits.length?'患者候補を選択':'電話番号に一致する患者がいません',''));
   hits.forEach(p=>select.add(new Option(p.name+' ／ 診察券 '+p.cardId,p.cardId)));
   const existing=hits.find(p=>p.cardId===fields.cardId.value);
   const chosen=existing||(hits.length===1?hits[0]:null);
   if(chosen){select.value=chosen.cardId;fields.cardId.value=chosen.cardId;}
   note.textContent=hits.length>1?'同じ電話番号の患者さんが複数います。名前・診察券番号をご確認ください。':hits.length===1?'候補の患者名と、このLINEがご本人のものか確認して登録してください。':'患者一覧の電話番号を確認してください。電話番号のみ保存することもできます。';
  }
  fields.phone.addEventListener('input',updateCandidates);
  select.addEventListener('change',()=>{fields.cardId.value=select.value;});
  row.append(select,note);updateCandidates();
  const status=lineRegistrationText('p',kind==='linked'?'予約確認を利用できます。':kind==='phone'?'電話番号は登録済みです。予約確認を利用するには、下のボタンで本人確認して連携してください。':'電話番号・患者情報を確認して登録してください。');row.append(status);
  function button(label,handler){const b=lineRegistrationText('button',label);b.style.cssText='padding:9px;margin:4px;cursor:pointer';b.onclick=async()=>{b.disabled=true;try{await handler();}catch(err){status.textContent='保存できませんでした：'+err.message;}finally{b.disabled=false;}};row.append(b);}
  button('本人確認して保存・予約確認を連携',async()=>{
   const result=await lineRegistrationRpc({action:'verify',uid:user.userId,tel:lineRegistrationPhone(fields.phone.value),cardId:fields.cardId.value,confirmed:true,patient:patients.find(p=>String(p.id).trim()===String(fields.cardId.value).trim())||null});
   if(!result.ok)throw new Error(result.error||'保存に失敗しました');
   await loadLineUsers();
  });
  button('電話番号などのみ保存',async()=>{await saveLineUserRow(user.userId);});
  if(active(user))button('予約確認の連携を解除',async()=>{
   if(!confirm('このLINEの予約確認用の連携を解除しますか？'))return;
   await lineRegistrationRpc({action:'revoke',tel:active(user).tel});await loadLineUsers();
  });
  list.append(row);
 });
};
