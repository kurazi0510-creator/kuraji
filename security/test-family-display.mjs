import fs from 'node:fs';import assert from 'node:assert/strict';
const html=fs.readFileSync('kanri.html','utf8'),admin=fs.readFileSync('security/dist/Admin.html','utf8'),gs=fs.readFileSync('security/dist/Admin.gs','utf8');
assert.ok(!html.includes('function renderFamilyBookingSummary'));assert.ok(html.includes('来院時刻（前日リマインドで案内する時刻）'));assert.ok(!admin.includes('💴 給与管理'));assert.ok(!gs.includes('Salary:true'));assert.ok(!gs.includes('function salaryLoad'));console.log('PASS: compact ordinary patient rows, editable arrival, salary navigation/route/RPC removed.');
