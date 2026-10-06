let salaryRevision=null;
function salaryRpc(request){
  return new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).salaryRequest(request));
}
async function salaryLoad(){
  const result=await salaryRpc({action:'load'});salaryRevision=result.revision;return result;
}
async function salarySave(){
  if(salaryRevision===null){
    const current=await salaryLoad();
    if(Object.keys(current.data).length&&!confirm('保存済みの給与データを、この画面の内容で更新しますか？'))throw new Error('保存を取り消しました');
  }
  const result=await salaryRpc({action:'save',data:salaryLocalData(),revision:salaryRevision});
  salaryRevision=result.revision;return result;
}
async function gasUpload(){
  const btn=document.getElementById('btnUpload');btn.disabled=true;
  try{
    localStorage.setItem(MK(currentYear,currentMonth),JSON.stringify(collectData()));
    await salarySave();setSyncStatus('✅ 管理専用画面に保存しました '+nowStr());
  }catch(err){setSyncStatus('❌ 保存失敗: '+err.message);}
  finally{btn.disabled=false;}
}
async function gasDownload(){
  const btn=document.getElementById('btnDownload');btn.disabled=true;
  try{
    const result=await salaryLoad();
    if(!Object.keys(result.data).length){setSyncStatus('保存済みデータはありません。旧画面のバックアップを取り込めます');return;}
    if(!confirm('この画面のデータをバックアップしてから、保存済みデータを取得しますか？'))return;
    salaryExport();
    Object.keys(salaryLocalData()).forEach(k=>localStorage.removeItem(k));
    Object.entries(result.data).forEach(([k,v])=>localStorage.setItem(k,v));
    loadSettings();renderRestTags();buildTable(currentYear,currentMonth);renderHistory();
    setSyncStatus('✅ 最新データを取得しました '+nowStr());
  }catch(err){setSyncStatus('❌ 取得失敗: '+err.message);}
  finally{btn.disabled=false;}
}
async function gasAutoBackup(){setSyncStatus('📱 この画面に保存済み。共有するには「保存」を押してください');}
