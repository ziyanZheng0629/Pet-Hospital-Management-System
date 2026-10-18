const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
let server,cookie;const base='http://127.0.0.1:44319',folder=fs.mkdtempSync(path.join(os.tmpdir(),'zzy-reception-'));
before(async()=>{server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,AI_ENABLED:'false',PORT:'44319',DATA_DIR:folder},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{server.stdout.on('data',x=>{if(x.toString().includes('Demo:'))resolve()});server.once('error',reject);server.once('exit',c=>reject(Error('启动失败 '+c)));setTimeout(()=>reject(Error('启动超时')),8000).unref()});const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'demo',role:'前台'})});cookie=r.headers.get('set-cookie').split(';')[0]});
after(async()=>{if(server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r))}fs.rmSync(folder,{recursive:true,force:true})});
async function api(url,b){const res=await fetch(base+url,{method:b?'POST':'GET',headers:{cookie,'Content-Type':'application/json','X-Demo-Request':'1'},body:b?JSON.stringify(b):undefined});const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value}
const start=(phone,question)=>api('/api/calls/start',{branch:'b1',caller:'来电测试',phone,question});
async function say(c,text){const next=await api('/api/calls/message',{id:c.id,text});const answer=next.turns.at(-1).text;assert.ok(answer.length<=100,answer);assert.ok((answer.match(/[？?]/g)||[]).length<=1,answer);assert.ok(!/依据|SHA|知识库|草稿|来源/.test(answer),answer);return next}
test('新客疫苗逐轮只问一个问题，自动建档与预约代填，未知生日不推测',async()=>{
 let c=await start('13800009101','小猫想打疫苗，现在适合接种吗？');assert.equal(c.reception.expected,'age');assert.equal(c.bookingDraft.fields.petId,'');assert.ok(c.turns.at(-1).text.includes('多大'));
 c=await say(c,'三个月');assert.equal(c.reception.expected,'health');
 c=await say(c,'精神食欲都挺好，没有生病');assert.equal(c.reception.expected,'history');
 c=await say(c,'没打过');assert.equal(c.reception.expected,'owner');
 c=await say(c,'我姓王');assert.equal(c.reception.expected,'petName');
 c=await say(c,'奶糖');assert.equal(c.reception.expected,'breed');assert.ok(c.reception.registration.petId);assert.equal(c.bookingDraft.fields.petId,c.reception.registration.petId);
 for(const [expected,answer] of [['breed','英短'],['color','蓝白'],['weight','六斤'],['sex','小女生'],['allergies','没有发现过敏']]){assert.equal(c.reception.expected,expected);c=await say(c,answer)}
 assert.equal(c.reception.expected,'date');
 c=await say(c,'明天下午三点');assert.equal(c.reception.complete,true);assert.equal(c.bookingDraft.fields.time,'15:00');assert.equal(c.bookingDraft.status,'待前台确认');assert.ok(c.turns.at(-1).text.includes('前台确认'));
 let state=await api('/api/state');const pets=state.pets.filter(p=>p.phone==='13800009101');assert.equal(pets.length,1);assert.equal(pets[0].name,'奶糖');assert.equal(pets[0].owner,'王');assert.equal(pets[0].birthday,'');assert.equal(pets[0].ageMonths,3);assert.equal(pets[0].weight,3);assert.equal(pets[0].color,'蓝白');assert.equal(pets[0].breed,'英短');assert.equal(pets[0].allergies,'没有发现过敏');assert.ok(pets[0].missingFields.includes('neutered'));assert.equal(pets[0].neutered,undefined);assert.ok(pets[0].ownerId);assert.ok(!state.appointments.some(a=>a.petId===pets[0].id));
 c=await say(c,'好的谢谢');state=await api('/api/state');assert.equal(state.pets.filter(p=>p.phone==='13800009101').length,1);const returnCall=await start('13800009101','奶糖想预约疫苗');assert.equal(returnCall.reception.expected,'health');
});
test('老客美容按号码复用档案，实际耗时待到店确认，不重复问姓名',async()=>{
 let c=await start('13800001002','我想预约宠物美容');assert.equal(c.reception.fields.petId,'demo-p2');assert.equal(c.reception.fields.owner,'李先生');assert.equal(c.reception.expected,'color');assert.equal(c.bookingDraft.durationPending,true);assert.equal(c.bookingDraft.fields.duration,'');
 for(const answer of ['黄白','没有发现过敏'])c=await say(c,answer);assert.equal(c.reception.service,'groom');assert.equal(c.reception.expected,'date');
 c=await say(c,'明天下午');assert.equal(c.reception.complete,true);assert.equal(c.bookingDraft.fields.time,'');assert.equal(c.bookingDraft.fields.period,'下午');assert.ok(c.turns.at(-1).text.includes('到店再定'));assert.equal(c.reception.registration,undefined);const p=(await api('/api/state')).pets.find(p=>p.id==='demo-p2');assert.equal(p.color,undefined);assert.equal(p.intakeReview.fields.color,'黄白');assert.equal(p.weight,11.5);const saved=await api('/api/pets/update',{id:p.id,...p.intakeReview.fields,profileVerified:true});assert.equal(saved.color,'黄白');assert.equal(saved.intakeReview,undefined);
});
test('老客疫苗跳过已知年龄；不适时停止常规接种承诺',async()=>{
 let c=await start('13800001001','团子想打疫苗');assert.equal(c.reception.expected,'health');assert.equal(c.bookingDraft.fields.petId,'demo-p1');
 c=await say(c,'今天有点拉稀，食欲不太好');assert.equal(c.summary.risk,'需医生');assert.equal(c.reception.stage,'sick');assert.ok(!c.turns.at(-1).text.includes('可以接种'));assert.equal(c.reception.complete,false);
});
test('同号码多宠先选宠物，跨医院与跨门店不匹配',async()=>{
 const res=await fetch(base+'/api/pets',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Demo-Request':'1'},body:JSON.stringify({name:'另一只',owner:'陈女士',phone:'13800001001',species:'猫',weight:2,branch:'b1'})});assert.equal(res.status,201);
 let c=await start('13800001001','想预约洗澡');assert.equal(c.reception.expected,'choose');assert.equal(c.bookingDraft.fields.petId,'');c=await say(c,'团子');assert.equal(c.bookingDraft.fields.petId,'demo-p1');assert.equal(c.reception.expected,'color');
 const other=await start('13800001005','小猫想打疫苗');assert.equal(other.reception.matchCount,0);assert.equal(other.reception.expected,'age');
});

test('电话只追加五项，未知体重不填零、不循环追问，历史补充须人工核对',async()=>{
 let c=await start('13800009777','我家猫咪想预约洗澡');c=await say(c,'王女士');c=await say(c,'五项测试');
 for(const [key,answer] of [['breed','英短'],['color','蓝白'],['weight','不清楚'],['sex','母'],['allergies','不清楚']]){assert.equal(c.reception.expected,key);c=await say(c,answer)}
 assert.equal(c.reception.expected,'date');c=await say(c,'明天下午');assert.equal(c.reception.complete,true);
 const p=(await api('/api/state')).pets.find(p=>p.id===c.reception.fields.petId);assert.equal(p.weight,null);assert.equal(p.weightStatus,'待核实');assert.equal(p.allergies,'待核实');assert.equal(p.medicalHistory,undefined);
 const post=async(body,ck=cookie)=>fetch(base+'/api/pets/update',{method:'POST',headers:{cookie:ck,'Content-Type':'application/json','X-Demo-Request':'1'},body:JSON.stringify(body)});
 assert.equal((await post({id:p.id,color:'纯白'})).status,400);assert.equal((await post({id:p.id,weight:-1,profileVerified:true})).status,400);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:'demo',role:'医生'})});assert.equal((await post({id:p.id,profileVerified:true},login.headers.get('set-cookie').split(';')[0])).status,403);
 const saved=await api('/api/pets/update',{id:p.id,weight:3.1,allergies:'未发现过敏（宠主口述）',profileVerified:true});assert.equal(saved.weight,3.1);assert.equal(saved.intakeReview,undefined);assert.equal(saved.intakeStatus,'已核对');
});
