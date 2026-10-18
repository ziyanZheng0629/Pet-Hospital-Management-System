const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {expiresAfterThreeMonths}=require('../calls');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'xunde-test-'));
let child,base;
before(async()=>{child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,AI_ENABLED:'false',PORT:'44318',DATA_DIR:folder},stdio:['ignore','pipe','pipe']});base='http://127.0.0.1:44318';await new Promise((resolve,reject)=>{child.stdout.on('data',x=>{if(x.toString().includes('Demo:'))resolve()});child.on('error',reject);child.on('exit',c=>reject(new Error('server exited '+c)));setTimeout(()=>reject(new Error('启动超时')),8000).unref()})});
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
const future=days=>{const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
async function createPet(c,name='扩展测试'){const r=await req(c,'/api/pets',{name,owner:'测试客户',phone:'13800009999',species:'猫',weight:4,branch:'b1'});assert.equal(r.status,201);return r.value}
test('服务时长、连续占用、跨店冲突、医生排班、请假和门店停诊',async()=>{
 const c=await login(),p=await createPet(c);const date=future(2);
 const slot={petId:p.id,branch:'b1',date,time:'15:00',doctor:'林医生',duration:60,serviceId:'groom',reason:'连续时长'};
 assert.equal((await req(c,'/api/appointments',slot)).status,201);
 assert.equal((await req(c,'/api/appointments',{...slot,time:'15:30'})).status,409);
 assert.equal((await req(c,'/api/appointments',{...slot,time:'15:30',branch:'b2'})).status,409);
 assert.equal((await req(c,'/api/appointments',{...slot,time:'16:00',duration:30})).status,201);
 assert.equal((await req(c,'/api/schedules',{doctor:'林医生',branch:'b1',date,start:'17:00',end:'20:30'})).status,409);
 const shift=await req(c,'/api/schedules',{doctor:'林医生',branch:'b1',date,start:'08:30',end:'20:30'});assert.equal(shift.status,200);
 assert.equal((await req(c,'/api/schedules',{id:shift.value.id,doctor:'林医生',branch:'b1',date,start:'08:30',end:'14:00'})).status,409);
 const leave=await req(c,'/api/leaves',{type:'医生请假',doctor:'林医生',branch:'b1',date,start:'18:00',end:'19:00',reason:'培训'});assert.equal(leave.status,200);
 assert.equal((await req(c,'/api/appointments',{...slot,time:'18:15',duration:30})).status,409);
 assert.equal((await req(c,'/api/leaves/cancel',{id:leave.value.id})).status,200);
 assert.equal((await req(c,'/api/leaves',{type:'门店停诊',branch:'b1',date,start:'15:30',end:'17:00',reason:'检修'})).status,409);
 const off=await req(c,'/api/leaves',{type:'门店停诊',branch:'b1',date,start:'19:00',end:'20:30',reason:'检修'});assert.equal(off.status,200);
 assert.equal((await req(c,'/api/appointments',{...slot,time:'19:00',duration:30})).status,409);
});
test('会员折扣、统一价格快照、分次收费、余额原路退款、欠费与幂等',async()=>{
 const c=await login(),p=await createPet(c,'会员财务测试');
 assert.equal((await req(c,'/api/members/level',{petId:p.id,level:'金卡'})).status,200);
 const recharge={petId:p.id,amount:'200.00',operationId:'recharge-test-123456'};
 assert.equal((await req(c,'/api/members/recharge',recharge)).status,200);assert.equal((await req(c,'/api/members/recharge',recharge)).status,200);
 assert.equal((await req(c,'/api/members/recharge',{...recharge,amount:'201'})).status,409);
 const s=(await req(c,'/api/state')).value;assert.equal(s.pets.find(x=>x.id===p.id).balanceCents,20000);
 const a=await req(c,'/api/appointments',{petId:p.id,date:s.today,time:'19:45',duration:30,doctor:'陈医生',reason:'体检'});assert.equal(a.status,201);
 await req(c,'/api/appointments/status',{id:a.value.id,status:'待接诊'});await req(c,'/api/appointments/status',{id:a.value.id,status:'诊疗中'});
 assert.equal((await req(c,'/api/visits',{appointmentId:a.value.id,complaint:'检查',diagnosis:'正常',services:['consult','blood']})).status,201);
 let state=(await req(c,'/api/state')).value,o=state.orders.find(o=>o.petId===p.id);assert.equal(o.totalCents,15300);
 assert.equal((await req(c,'/api/services',{id:'consult',price:'60',duration:40})).status,200);
 assert.equal((await req(c,'/api/orders/debt',{id:o.id,dueDate:future(7),reason:'分期'})).status,200);
 assert.equal((await req(c,'/api/orders/pay',{id:o.id,method:'现金（模拟）',amount:'50'})).status,200);
 assert.equal((await req(c,'/api/orders/pay',{id:o.id,method:'会员余额',amount:'104'})).status,400);
 assert.equal((await req(c,'/api/orders/pay',{id:o.id,method:'会员余额',amount:'103'})).status,200);
 state=(await req(c,'/api/state')).value;o=state.orders.find(o=>o.petId===p.id);assert.equal(o.totalCents,15300);assert.equal(o.status,'已支付');assert.equal(state.pets.find(x=>x.id===p.id).balanceCents,9700);
 const payment=state.ledger.find(l=>l.orderId===o.id&&l.channel==='会员余额');const refund={id:o.id,paymentId:payment.id,amount:'20',reason:'部分服务取消',operationId:'refund-test-123456'};
 assert.equal((await req(c,'/api/orders/refund',refund)).status,200);assert.equal((await req(c,'/api/orders/refund',refund)).status,200);
 assert.equal((await req(c,'/api/orders/refund',{...refund,amount:'100',operationId:'refund-test-654321'})).status,409);
 state=(await req(c,'/api/state')).value;assert.equal(state.pets.find(x=>x.id===p.id).balanceCents,11700);assert.equal(state.orders.find(x=>x.id===o.id).refundCents,2000);
 assert.equal((await req(c,'/api/payments/live',{id:o.id})).status,503);
 const r=(await req(c,'/api/reports?from='+s.today+'&to='+s.today)).value;assert.ok(r.ledger.find(l=>l.paymentId===payment.id));assert.ok(!r.receivables.some(x=>x.id===o.id));assert.equal(r.byService.reduce((n,g)=>n+g.net,0),r.net);
});
test('计次卡购买、跨店核销、未消费比例退卡、储值不足与转档',async()=>{
 const c=await login(),p=await createPet(c,'卡测试');
 const card=await req(c,'/api/cards/buy',{petId:p.id});assert.equal(card.status,200);assert.equal(card.value.remaining,5);
 assert.equal((await req(c,'/api/cards/use',{cardId:card.value.id,branch:'b2',serviceId:'groom'})).status,200);
 assert.equal((await req(c,'/api/cards/use',{cardId:card.value.id,branch:'b2',serviceId:'consult'})).status,400);
 const refund=await req(c,'/api/cards/refund',{id:card.value.id,reason:'剩余不用'});assert.equal(refund.status,200);assert.equal(refund.value.refundCents,32000);
 assert.equal((await req(c,'/api/cards/refund',{id:card.value.id,reason:'重复退'})).status,409);
 assert.equal((await req(c,'/api/members/refund',{petId:p.id,amount:'1',reason:'不足'})).status,409);
 assert.equal((await req(c,'/api/pets/transfer',{id:p.id,branch:'b2'})).status,200);
 assert.equal((await req(c,'/api/state?branch=b2')).value.pets.find(x=>x.id===p.id).branch,'b2');
});
test('员工账号认证、门店权限、跨店写入、授权变更与停用',async()=>{
 const admin=await login();const created=await req(admin,'/api/employees',{username:'tester',password:'TestPassword123!',name:'测试前台',role:'前台',branches:['b1']});assert.equal(created.status,200);assert.equal(created.value.hash,undefined);
 const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'demo',username:'tester',password:'TestPassword123!'})});assert.equal(r.status,200);const c=r.headers.get('set-cookie').split(';')[0];
 assert.equal((await req(c,'/api/state?branch=b2')).status,403);assert.equal((await req(c,'/api/state?branch=all')).value.branches.length,1);
 assert.equal((await req(c,'/api/pets',{name:'越权',owner:'a',phone:'13800009999',species:'猫',weight:4,branch:'b2'})).status,403);
 assert.equal((await req(c,'/api/services',{id:'consult',price:'1',duration:30})).status,403);
 await req(admin,'/api/employees/update',{id:created.value.id,role:'前台',branches:['b2'],active:true});assert.equal((await req(c,'/api/state?branch=b1')).status,403);assert.equal((await req(c,'/api/state?branch=b2')).status,200);
 await req(admin,'/api/employees/update',{id:created.value.id,role:'前台',branches:['b2'],active:false});assert.equal((await req(c,'/api/state')).status,401);
 const wrong=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'demo',username:'tester',password:'wrong'})});assert.equal(wrong.status,401);
});
test('逐笔对账识别缺失、金额差异、额外流水和重复编号',async()=>{
 const c=await login(),s=(await req(c,'/api/state')).value;
 const expected=s.ledger.filter(l=>l.date===s.today&&l.branch==='b1'&&l.channel==='现金（模拟）');const lines=expected.map(l=>({id:l.id,amount:['订单退款','余额退还','计次卡退卡'].includes(l.type)?-l.amount:l.amount}));
 const payload={date:s.today,branch:'b1',channel:'现金（模拟）',lines};const match=await req(c,'/api/reconciliations',payload);assert.equal(match.value.status,'核对一致');
 const missing=await req(c,'/api/reconciliations',{...payload,lines:[]});assert.equal(missing.value.status,'有差异');assert.equal(missing.value.differences.length,expected.length);
 assert.equal((await req(c,'/api/reconciliations',{...payload,lines:[{id:'duplicate',amount:1},{id:'duplicate',amount:1}]})).status,400);
 const mismatch=await req(c,'/api/reconciliations',{...payload,lines:[...lines.map((l,i)=>({...l,amount:l.amount+(i===0?1:0)})),{id:'external-only',amount:100}]});assert.ok(mismatch.value.differences.some(d=>d.type==='金额不符'));assert.ok(mismatch.value.differences.some(d=>d.type==='系统缺失'));
});
test('跨店预约后，接诊门店医生可完成病历但不能访问来源门店其他档案',async()=>{
 const admin=await login(),p=await createPet(admin,'跨店接诊测试'),state=(await req(admin,'/api/state')).value;
 const a=await req(admin,'/api/appointments',{petId:p.id,branch:'b2',date:state.today,time:'19:00',doctor:'张医生',reason:'跨店接诊'});assert.equal(a.status,201);
 await req(admin,'/api/appointments/status',{id:a.value.id,status:'待接诊'});await req(admin,'/api/appointments/status',{id:a.value.id,status:'诊疗中'});
 await req(admin,'/api/employees',{username:'branchdoctor',name:'张医生',password:'BranchDoctor123!',role:'医生',branches:['b2']});
 const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'demo',username:'branchdoctor',password:'BranchDoctor123!'})});assert.equal(r.status,200);const c=r.headers.get('set-cookie').split(';')[0];
 const scoped=(await req(c,'/api/state?branch=b2')).value;assert.ok(scoped.petReferences.find(x=>x.id===p.id));assert.ok(!scoped.pets.some(x=>x.branch==='b1'));
 assert.equal((await req(c,'/api/visits',{appointmentId:a.value.id,complaint:'复诊',diagnosis:'记录检查',services:['consult']})).status,201);
 assert.equal((await req(c,'/api/state?branch=b1')).status,403);
});
test('三个月自然月保留期，月末与闰年钳制，按北京时间计算',()=>{
 assert.equal(expiresAfterThreeMonths('2026-10-18T02:00:00Z'),'2027-01-18T02:00:00.000Z');
 assert.equal(expiresAfterThreeMonths('2026-01-31T12:00:00Z'),'2026-04-30T12:00:00.000Z');
 assert.equal(expiresAfterThreeMonths('2023-11-30T12:00:00Z'),'2024-02-29T12:00:00.000Z');
 assert.equal(expiresAfterThreeMonths('2026-01-30T20:00:00Z'),'2026-04-29T20:00:00.000Z'); // 下行独立验证北京时间1月31日跨月边界。
});
test('电话接待：前台看到总结，明细带来源快照，知识更新不覆盖历史',async()=>{
 const c=await login('前台'),admin=await login();const list=(await req(c,'/api/calls?branch=all')).value;assert.equal(list.scenarios.length,12);assert.ok(list.calls.length>=10);assert.equal(list.calls[0].turns,undefined);assert.ok(list.calls[0].summary.customer);
 const started=await req(c,'/api/calls/start',{branch:'b1',caller:'测试来电',phone:'13800001111',question:'门诊体检多少钱？'});assert.equal(started.status,200);const call=started.value;assert.equal(call.turns.length,2);assert.ok(call.turns[1].sources.some(s=>s.kind==='业务数据快照'));assert.ok(call.summary.response.includes('标准价'));const firstHash=call.turns[1].sources[0].hash;
 const end=await req(c,'/api/calls/end',{id:call.id});assert.equal(end.status,200);assert.equal(end.value.expiresAt,call.expiresAt);
 const knowledge=list.knowledge.find(k=>k.code==='price');const edit=await req(admin,'/api/calls/knowledge',{id:knowledge.id,content:'标准价以演示目录为准，最终收费需要人工确认。'});assert.equal(edit.status,200);
 const detail=(await req(c,'/api/calls/detail?id='+call.id)).value;assert.equal(detail.turns[1].sources[0].hash,firstHash);assert.notEqual(detail.turns[1].sources[0].version,edit.value.version);
 assert.equal((await req(c,'/api/calls/knowledge',{id:knowledge.id,content:'非法更新'})).status,403);
 const note=await req(c,'/api/calls/followup',{id:call.id,note:'已核实并回访',status:'已处理'});assert.equal(note.value.status,'已处理');assert.equal(note.value.followup.length,1);assert.equal(note.value.expiresAt,call.expiresAt);
 assert.equal((await req(c,'/api/calls/message',{id:call.id,text:'结束后不再回复'})).status,409);
});
test('多轮急症与未知问题不编造答案，风险不会被后续普通问题降低',async()=>{
 const c=await login();const call=(await req(c,'/api/calls/start',{branch:'b1',caller:'风险案例',phone:'13800001112',question:'宠物呼吸困难'})).value;
 assert.equal(call.summary.risk,'紧急');assert.ok(call.turns[1].sources.find(k=>k.code==='urgent'));assert.ok(!call.turns[1].text.includes('诊断为'));
 const next=(await req(c,'/api/calls/message',{id:call.id,text:'明天可以预约吗'})).value;assert.equal(next.summary.risk,'紧急');assert.equal(next.turns.length,4);assert.equal(next.expiresAt,call.expiresAt);
 const unknown=(await req(c,'/api/calls/start',{branch:'b1',caller:'未知案例',phone:'13800001113',question:'你们能办理星际旅行许可证吗'})).value;assert.ok(unknown.turns[1].text.includes('核实'));assert.equal(unknown.summary.needsHuman,true);
});
test('电话记录门店和医院隔离，医生宠主不可访问，过期原文和总结均不可读取',async()=>{
 const a=await login(),other=await login('院长','sandbox'),owner=await login('宠主'),doctor=await login('医生');const r=(await req(a,'/api/calls/start',{branch:'b2',caller:'到期测试',phone:'13800001114',question:'地址在哪？'})).value;
 assert.equal((await req(other,'/api/calls/detail?id='+r.id)).status,404);assert.equal((await req(owner,'/api/calls')).status,403);assert.equal((await req(doctor,'/api/calls')).status,403);
 const loginR=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'demo',username:'frontdesk',password:'Demo2026!'})});const front=loginR.headers.get('set-cookie').split(';')[0];assert.equal((await req(front,'/api/calls/detail?id='+r.id)).status,403);
 const db=new DatabaseSync(path.join(folder,'calls.sqlite'));db.prepare('UPDATE calls SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',r.id);
 assert.equal((await req(a,'/api/calls/detail?id='+r.id)).status,404);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calls WHERE id=?').get(r.id).n,0);db.close();
 assert.ok(!(await req(a,'/api/calls')).value.calls.some(c=>c.id===r.id));assert.equal((await fetch(base+'/data/calls.sqlite')).status,404);
});
test('电话代填不占号，前台核验后正式建单，确认重试不会重复预约',async()=>{
 const c=await login('前台'),p=await createPet(c,'代填测试');const date=future(1);
 const call=(await req(c,'/api/calls/start',{branch:'b1',caller:'代填测试客户',phone:p.phone,question:`代填测试想预约洗护，${date}下午3点半找陈医生。`})).value;
 const d=call.bookingDraft;assert.equal(d.fields.petId,p.id);assert.equal(d.fields.date,date);assert.equal(d.fields.time,'15:30');assert.equal(d.fields.doctor,'陈医生');assert.equal(d.fields.serviceId,'groom');assert.equal(d.status,'待前台确认');
 assert.ok(!(await req(c,'/api/state')).value.appointments.some(a=>a.petId===p.id));
 assert.equal((await req(c,'/api/calls/booking/confirm',{id:call.id,revision:d.revision,fields:d.fields,identityVerified:true})).status,409);
 await req(c,'/api/calls/end',{id:call.id});
 assert.equal((await req(c,'/api/calls/booking/confirm',{id:call.id,revision:d.revision,fields:d.fields})).status,400);
 const saved=await req(c,'/api/calls/booking/save',{id:call.id,revision:d.revision,fields:{...d.fields,time:'17:00',duration:60}});assert.equal(saved.status,200);assert.equal(saved.value.bookingDraft.status,'待前台确认');assert.ok(!(await req(c,'/api/state')).value.appointments.some(a=>a.petId===p.id));
 assert.equal((await req(c,'/api/calls/booking/confirm',{id:call.id,revision:d.revision,fields:d.fields,identityVerified:true})).status,409);
 const payload={id:call.id,revision:saved.value.bookingDraft.revision,fields:saved.value.bookingDraft.fields,identityVerified:true};const confirms=await Promise.all([req(c,'/api/calls/booking/confirm',payload),req(c,'/api/calls/booking/confirm',payload)]);assert.ok(confirms.every(r=>r.status===200));assert.equal(confirms[0].value.bookingDraft.appointmentId,confirms[1].value.bookingDraft.appointmentId);
 let state=(await req(c,'/api/state')).value;const appointments=state.appointments.filter(a=>a.petId===p.id);assert.equal(appointments.length,1);assert.equal(appointments[0].time,'17:00');assert.equal(appointments[0].confirmationMethod,'前台人工确认');
 const conflict=(await req(c,'/api/calls/start',{branch:'b1',caller:'冲突来电',phone:p.phone,question:`代填测试想预约洗护，${date}下午5点半找陈医生。`})).value;await req(c,'/api/calls/end',{id:conflict.id});const failed=await req(c,'/api/calls/booking/confirm',{id:conflict.id,revision:conflict.bookingDraft.revision,fields:{...conflict.bookingDraft.fields,duration:60},identityVerified:true});assert.equal(failed.status,409);assert.equal((await req(c,'/api/calls/detail?id='+conflict.id)).value.bookingDraft.status,'待前台确认');
 const sql=new DatabaseSync(path.join(folder,'calls.sqlite'));sql.prepare('UPDATE calls SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',call.id);assert.equal((await req(c,'/api/calls/detail?id='+call.id)).status,404);sql.close();state=(await req(c,'/api/state')).value;assert.ok(state.appointments.find(a=>a.id===appointments[0].id));
});
test('含糊时间留空、取消意向不确认，AI未配置时明确标识兜底',async()=>{
 const c=await login();let call=(await req(c,'/api/calls/start',{branch:'b1',caller:'含糊时间',phone:'13800008888',question:'团子明天下午想预约体检'})).value;assert.equal(call.bookingDraft.fields.time,'');assert.equal(call.bookingDraft.fields.period,'下午');
 call=(await req(c,'/api/calls/message',{id:call.id,text:'不预约了，取消预约。'})).value;assert.equal(call.bookingDraft.status,'已取消');assert.equal(call.turns.at(-1).provider.mode,'rules');await req(c,'/api/calls/end',{id:call.id});assert.equal((await req(c,'/api/calls/booking/confirm',{id:call.id,revision:call.bookingDraft.revision,fields:call.bookingDraft.fields,identityVerified:true})).status,409);
 const status=(await req(c,'/api/calls/ai/status')).value;assert.equal(status.ready,false);assert.equal(status.key,undefined);
});

test('问候前缀不覆盖症状问题，无尿描述优先转人工',async()=>{
 const c=await login();const urgent=(await req(c,'/api/calls/start',{branch:'b1',caller:'症状回归案例',phone:'13800007777',question:'您好，我家猫有一天没尿了，怎么办'})).value;assert.equal(urgent.summary.risk,'紧急');assert.equal(urgent.summary.needsHuman,true);assert.ok(urgent.turns[1].sources.some(k=>k.code==='urgent'));
 const unknown=(await req(c,'/api/calls/start',{branch:'b1',caller:'问候案例',phone:'13800007778',question:'您好，我家宠物一直磨牙怎么办'})).value;assert.equal(unknown.turns[1].intent,'待核实问题');assert.equal(unknown.summary.needsHuman,true);
});
