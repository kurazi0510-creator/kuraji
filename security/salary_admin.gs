// Included ONLY in the owner-only project. No public salary API.
function salaryValidate_(data){
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('給与データの形式が違います');
  Object.keys(data).forEach(function(k){
    if(!/^(murao_settings|murao_rest_periods|murao_salary_\d{4}_(?:[0-9]|1[01]))$/.test(k)||typeof data[k]!=='string')throw new Error('給与データの項目が違います');
    var value=JSON.parse(data[k]);
    if(!value||typeof value!=='object')throw new Error('給与データの値が違います');
  });
  var json=JSON.stringify(data);
  if(Utilities.newBlob(json).getBytes().length>180000)throw new Error('データ量が大きすぎます。保存前にバックアップしてください');
  return json;
}
function salaryRead_(props){
  var revision=props.getProperty('SALARY_REVISION')||'';
  if(!revision)return {status:'ok',data:{},revision:''};
  var count=Number(props.getProperty('SALARY_'+revision+'_COUNT'));
  if(!count||count>100)throw new Error('給与データの保存情報を確認してください');
  var raw='';
  for(var i=0;i<count;i++){
    var part=props.getProperty('SALARY_'+revision+'_'+i);
    if(part===null)throw new Error('給与データの保存情報を確認してください');
    raw+=part;
  }
  var data=JSON.parse(raw);salaryValidate_(data);
  return {status:'ok',data:data,revision:revision};
}
function salaryRequest(request){
  if(!request||['load','save'].indexOf(request.action)<0)throw new Error('給与操作が違います');
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var props=PropertiesService.getScriptProperties();
    if(request.action==='load')return salaryRead_(props);
    var previous=props.getProperty('SALARY_REVISION')||'';
    if(typeof request.revision!=='string'||request.revision!==previous)throw new Error('別の画面で更新されました。バックアップしてから最新データを取得してください');
    var raw=salaryValidate_(request.data),revision=Utilities.getUuid(),values={};
    // At most 1800 UTF-16 code units per property (under 9KB in UTF-8).
    // Write all chunks before swapping the pointer, preserving the old snapshot on failure.
    var count=0,start=0;
    while(start<raw.length){
      var end=Math.min(raw.length,start+1800),last=raw.charCodeAt(end-1);
      if(end<raw.length&&last>=0xD800&&last<=0xDBFF)end--;
      values['SALARY_'+revision+'_'+count++]=raw.slice(start,end);start=end;
    }
    values['SALARY_'+revision+'_COUNT']=String(count);
    try{props.setProperties(values);}catch(err){Object.keys(values).forEach(function(k){props.deleteProperty(k);});throw err;}
    try{props.setProperty('SALARY_REVISION',revision);}catch(err){Object.keys(values).forEach(function(k){props.deleteProperty(k);});throw err;}
    if(previous){
      var oldCount=Number(props.getProperty('SALARY_'+previous+'_COUNT'))||0;
      for(var j=0;j<oldCount;j++)props.deleteProperty('SALARY_'+previous+'_'+j);
      props.deleteProperty('SALARY_'+previous+'_COUNT');
    }
    return {status:'ok',revision:revision};
  }finally{lock.releaseLock();}
}
