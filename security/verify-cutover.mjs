// Read-only check. Does not call patient-list routes, write data, or send LINE.
// Usage: node security/verify-cutover.mjs <PUBLIC_GAS_EXEC_URL>
const supplied=process.argv[2];
if(!supplied)throw new Error('公開GASのWebアプリURLを指定してください。トークンや中継キーは指定しません。');
const url=new URL(supplied);
if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname))throw new Error('Apps Scriptの /exec URLを指定してください');
url.search='';
url.searchParams.set('action','getPublicSecurityStatus');
const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error('公開GASへ接続できません');
let status;
try{status=await response.json();}catch{throw new Error('制限版GASの確認応答がありません');}
if(status.ok!==true||status.version!=='kuraji-public-boundary-20260930'||status.managementAccess!==false||status.webhookRequiresRelay!==true)throw new Error('制限版GASの反映を確認できません。切替完了とは判断しません。');
console.log('制限版GASの応答を確認しました。患者情報を取得する操作は実行していません。');
console.log('Web予約とLINEの実際の受信、古い公開デプロイの停止は別途確認が必要です。');
