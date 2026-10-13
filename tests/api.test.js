const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'xunde-test-'));
let child,base;
before(async()=>{child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'44318',DATA_DIR:folder},stdio:['ignore','pipe','pipe']});base='http://127.0.0.1:44318';await new Promise((resolve,reject)=>{child.stdout.on('data',x=>{if(x.toString().includes('Demo:'))resolve()});child.on('error',reject);child.on('exit',c=>reject(new Error('server exited '+c)));setTimeout(()=>reject(new Error('启动超时')),8000).unref()})});
after(async()=>{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r))}fs.rmSync(folder,{recursive:true,force:true})});
async function login(role='院长',tenant='demo'){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,tenant})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
async function req(cookie,url,b){const r=await fetch(base+url,{method:b?'POST':'GET',headers:{cookie,...(b?{'Content-Type':'application/json','X-Demo-Request':'1'}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,value:await r.json()}}
test('建档、预约冲突、接诊、服务端计价、收费幂等、报表数据',async()=>{
 const cookie=await login();const state=(await req(cookie,'/api/state')).value;
 const p=await req(cookie,'/api/pets',{name:'测试宠物',owner:'测试宠主',phone:'13811112222',species:'猫',weight:4,branch:'b1'});assert.equal(p.status,201);
 const payload={petId:p.value.id,date:state.today,time:'18:45',doctor:'林医生',reason:'闭环测试'};
 const a=await req(cookie,'/api/appointments',payload);assert.equal(a.status,201);assert.equal((await req(cookie,'/api/appointments',payload)).status,409);
 assert.equal((await req(cookie,'/api/appointments/status',{id:a.value.id,status:'待接诊'})).status,200);
 assert.equal((await req(cookie,'/api/appointments/status',{id:a.value.id,status:'诊疗中'})).status,200);
 const visit={appointmentId:a.value.id,complaint:'年度体检',diagnosis:'记录测试结果',advice:'按计划复诊',services:['consult','blood'],total:1};
 assert.equal((await req(cookie,'/api/visits',visit)).status,201);assert.equal((await req(cookie,'/api/visits',visit)).status,409);
 const s=(await req(cookie,'/api/state')).value;const o=s.orders.find(o=>o.petId===p.value.id);assert.equal(o.total,170);
 assert.equal((await req(cookie,'/api/orders/pay',{id:o.id,method:'微信（模拟）'})).status,200);
 assert.equal((await req(cookie,'/api/orders/pay',{id:o.id,method:'微信（模拟）'})).status,409);
 const done=(await req(cookie,'/api/state')).value;assert.equal(done.appointments.find(x=>x.id===a.value.id).status,'已完成');assert.equal(done.orders.find(x=>x.id===o.id).status,'已支付');
});
test('后端角色权限、宠主记录范围与医院隔离',async()=>{
 const admin=await login();const owner=await login('宠主');const other=await login('院长','sandbox');const doctor=await login('医生');
 const s=(await req(admin,'/api/state')).value;const p=s.pets.find(p=>p.id==='demo-p2');
 assert.equal((await req(owner,'/api/state')).value.pets.length,1);
 assert.equal((await req(owner,'/api/cards/use',{id:p.id})).status,403);
 assert.equal((await req(owner,'/api/appointments',{petId:p.id,date:s.today,time:'19:00',doctor:'林医生',reason:'越权'})).status,403);
 assert.equal((await req(other,'/api/cards/use',{id:p.id})).status,404);
 assert.equal((await req(doctor,'/api/settings',{name:'无权修改'})).status,403);
 assert.equal((await req(doctor,'/api/state')).value.orders.length,0);
 assert.ok((await req(other,'/api/state')).value.pets.every(x=>!x.id.startsWith('demo-')));
});
test('非法输入、库存不足、计次卡余额与静态文件隔离',async()=>{
 const c=await login();const s=(await req(c,'/api/state')).value;
 assert.equal((await req(c,'/api/pets',{name:'a',owner:'b',phone:'bad',branch:'b1',species:'猫',weight:4})).status,400);
 assert.equal((await req(c,'/api/stock',{id:s.stock[0].id,delta:-9999})).status,409);
 assert.equal((await req(c,'/api/cards/use',{id:'demo-p1'})).status,409);
 assert.equal((await fetch(base+'/server.js')).status,404);
 assert.equal((await fetch(base+'/data/clinic.sqlite')).status,404);
 assert.equal((await fetch(base+'/api/state')).status,401);
});
