function salaryLocalData(){
  const data={};
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(/^(murao_settings|murao_rest_periods|murao_salary_\d{4}_(?:[0-9]|1[01]))$/.test(key))data[key]=localStorage.getItem(key);
  }
  return data;
}
function salaryExport(){
  localStorage.setItem(MK(currentYear,currentMonth),JSON.stringify(collectData()));
  const blob=new Blob([JSON.stringify({format:'kuraji-salary-backup-v1',data:salaryLocalData()},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='kuraji-salary-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function salaryImport(file){
  if(!file)return;
  try{
    const backup=JSON.parse(await file.text());
    const data=backup.format==='kuraji-salary-backup-v1'?backup.data:backup;
    if(!data||typeof data!=='object'||Array.isArray(data)||!Object.keys(data).length)throw new Error('給与バックアップを選んでください');
    for(const [key,value] of Object.entries(data)){
      if(!/^(murao_settings|murao_rest_periods|murao_salary_\d{4}_(?:[0-9]|1[01]))$/.test(key)||typeof value!=='string')throw new Error('バックアップの形式が違います');
      const parsed=JSON.parse(value);
      if(!parsed||typeof parsed!=='object')throw new Error('バックアップの内容が違います');
    }
    if(!confirm('現在のデータをバックアップしてから、同じ月・設定のデータを取り込みます。続けますか？'))return;
    salaryExport();
    for(const [key,value] of Object.entries(data))localStorage.setItem(key,value);
    loadSettings();renderRestTags();buildTable(currentYear,currentMonth);renderHistory();
    setSyncStatus('✅ 取り込み完了。内容を確認してから「保存」を押してください');
  }catch(err){setSyncStatus('❌ 取り込み失敗: '+err.message);}
}
