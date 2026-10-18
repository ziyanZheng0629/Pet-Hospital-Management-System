const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const root = __dirname;
if(fs.existsSync(path.join(root,'.env')))process.loadEnvFile(path.join(root,'.env'));
const profile=require('./pet-profile');
const ai=require('./ai-provider')();
fs.mkdirSync(process.env.DATA_DIR || path.join(root, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'clinic.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, tenant TEXT NOT NULL, branch TEXT NOT NULL, body TEXT NOT NULL);');
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai'}).format(new Date());
function all(kind, tenant) { return db.prepare('SELECT body FROM records WHERE kind=? AND tenant=?').all(kind,tenant).map(r=>JSON.parse(r.body)); }
function put(kind, tenant, branch, obj) { db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?,?,?)').run(obj.id,kind,tenant,branch,JSON.stringify(obj)); return obj; }
const branches = [{id:'b1',name:'滨江总院',address:'滨江路 128 号'},{id:'b2',name:'城西分院',address:'文一路 66 号'}];
const services = [{id:'consult',name:'门诊诊查',price:50},{id:'blood',name:'血常规检查',price:120},{id:'vaccine',name:'犬猫疫苗服务',price:98},{id:'ultrasound',name:'腹部超声',price:180},{id:'groom',name:'基础洗护',price:88}];
function seed(tenant) {
 if(all('pet',tenant).length) return;
 const pets=[['p1','团子','猫','英短','陈女士','13800001001',4.2,'金卡'],['p2','可乐','犬','柯基','李先生','13800001002',11.5,'普通会员'],['p3','糯米','猫','布偶','周女士','13800001003',3.6,'银卡'],['p4','豆豆','犬','金毛','王先生','13800001004',25,'金卡'],['p5','小满','猫','中华田园猫','林女士','13800001005',3.2,'普通会员']];
 pets.forEach((p,i)=>put('pet',tenant,i===4?'b2':'b1',{id:tenant+'-'+p[0],name:p[1],species:p[2],breed:p[3],owner:p[4],phone:p[5],weight:p[6],level:p[7],sex:i%2?'公':'母',birthday:'2023-05-12',notes:i===0?'对陌生环境敏感，请温柔保定':'',branch:i===4?'b2':'b1',card: i===1?3:0}));
 const appts=[['p1','09:00','年度健康检查','林医生','待接诊'],['p2','09:30','疫苗预约','陈医生','待接诊'],['p3','10:15','食欲下降复诊','林医生','诊疗中'],['p4','11:00','皮肤检查','陈医生','已预约'],['p5','14:00','基础洗护','张医生','已预约']];
 appts.forEach((a,i)=>put('appointment',tenant,i===4?'b2':'b1',{id:crypto.randomUUID(),petId:tenant+'-'+a[0],date:today(),time:a[1],reason:a[2],doctor:a[3],status:a[4],branch:i===4?'b2':'b1'}));
 [['犬猫疫苗',32,10],['一次性注射器',168,50],['检测试剂盒',6,15],['医用纱布',42,20]].forEach((a,i)=>branches.forEach(b=>put('stock',tenant,b.id,{id:crypto.randomUUID(),name:a[0],quantity:a[1]-(b.id==='b2'?2:0),threshold:a[2],unit:i===0?'支':'盒',branch:b.id})));
 put('message',tenant,'b1',{id:crypto.randomUUID(),title:'团子年度体检回访',petId:tenant+'-p1',content:'体检后请关注饮食和精神状态，如有疑问请联系医院。',status:'待处理',type:'回访',branch:'b1'});
 put('settings',tenant,'all',{id:tenant+'-settings',name:tenant==='demo'?'青禾宠物医疗':'星野动物医院',smsSignature:'青禾宠物医疗',autoReminder:true});
}
seed('demo'); seed('sandbox');
const sessions = new Map();
const roles=['院长','前台','医生','宠主'];
const err=(code,message)=>Object.assign(new Error(message),{code});
function check(cond,message,code=400){if(!cond)throw err(code,message)}
function allowed(s,rs){check(rs.includes(s.role),'当前角色没有此操作权限',403)}
function record(kind,id,s){const r=all(kind,s.tenant).find(x=>x.id===id); check(r,'记录不存在',404);if(s.branches && r.branch!=='all' && s.role!=='宠主')check(s.branches.includes(r.branch),'无权访问此门店记录',403); if(s.role==='宠主')check(r.petId===s.petId || r.id===s.petId,'无权查看该记录',403);return r}
function audit(s,action){put('audit',s.tenant,'all',{id:crypto.randomUUID(),action,role:s.role,at:new Date().toISOString(),branch:'all'})}
async function body(req){let b='';for await(const c of req){b+=c;check(b.length<100000,'请求过大',413)}try{return JSON.parse(b||'{}')}catch{throw err(400,'JSON 格式错误')}}
function text(v,max=100){return String(v||'').trim().slice(0,max)}
function dateValid(v){const d=new Date(v+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===v}
let txDepth=0;
function transaction(fn){const name='nested_'+txDepth;const nested=txDepth>0;db.exec(nested?'SAVEPOINT '+name:'BEGIN IMMEDIATE');txDepth++;try{const r=fn();db.exec(nested?'RELEASE '+name:'COMMIT');return r}catch(e){db.exec(nested?'ROLLBACK TO '+name:'ROLLBACK');if(nested)db.exec('RELEASE '+name);throw e}finally{txDepth--}}
const domain=require('./domain')({all,put,check,allowed,record,today,text,dateValid,transaction,audit,branches,services,remove:id=>db.prepare('DELETE FROM records WHERE id=?').run(id)});
const calls=require('./calls')({ai,all,put,updateProfile:(c,r)=>{const p=all('pet',c.tenant).find(p=>p.id===r.fields.petId&&p.branch===c.branch);if(!p)return;const fields={};for(const k of [...Object.keys(profile.labels),'ageMonths','weightStatus'])if(r.evidence[k]?.kind==='来电原话')fields[k]=r.fields[k];if(!Object.keys(fields).length)return;const entry={fields:{...p.intakeReview?.fields,...fields},at:new Date().toISOString(),source:'客户电话口述，待前台核对'};if(r.registration?.petId===p.id){Object.assign(p,fields);p.intakeStatus='待前台核对'}p.intakeReview=entry;p.missingFields=profile.missing(p);put('pet',c.tenant,p.branch,p)},createProfile:(c,f)=>transaction(()=>{const existing=all('pet',c.tenant).find(p=>p.branch===c.branch&&p.phone===c.phone&&p.name===f.petName&&p.species===f.species);if(existing)return existing;const ownerKey=crypto.createHash('sha256').update(c.tenant+':'+c.branch+':'+c.phone).digest('hex').slice(0,24);const owner=all('owner',c.tenant).find(o=>o.id==='owner-'+ownerKey)||put('owner',c.tenant,c.branch,{id:'owner-'+ownerKey,branch:c.branch,name:f.owner,phone:c.phone,source:'电话逐步登记',intakeStatus:'待前台核对'});return put('pet',c.tenant,c.branch,{id:c.tenant+'-call-pet-'+c.id,ownerId:owner.id,branch:c.branch,name:f.petName,owner:owner.name,phone:c.phone,species:f.species,breed:f.breed||'待补充',birthday:'',ageText:f.ageText||'',ageMonths:f.ageMonths??null,...Object.fromEntries(Object.keys(profile.labels).filter(k=>k in f).map(k=>[k,f[k]])),sex:f.sex||'待核实',weight:f.weight||null,weightStatus:f.weightStatus||'待核实',level:'普通会员',balanceCents:0,card:0,notes:'电话登记；年龄与免疫情况为客户口述，待前台核对。',source:'电话逐步登记',intakeStatus:'待前台核对',createdAt:new Date().toISOString()})}),check,allowed,branches,branchCheck:domain.branchCheck,createAppointment:(session,fields,key)=>transaction(()=>{const previous=all('appointment',session.tenant).find(a=>a.callRequestKey===key);if(previous){domain.branchCheck(session,previous.branch);return previous}const appointment=domain.handle('/api/appointments',fields,session,new URL('http://localhost'));appointment.callRequestKey=key;appointment.createdBy=session.name||session.role;appointment.confirmationMethod='前台人工确认';put('appointment',session.tenant,appointment.branch,appointment);return appointment}),dataDir:process.env.DATA_DIR||path.join(root,'data')});
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 const send=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(v))};
 try{
 if(u.pathname==='/api/login' && req.method==='POST') {const b=await body(req);if(req.headers.origin)check(req.headers.origin===`http://${req.headers.host}`,'来源校验失败',403);const identity=domain.authenticate(b,req.socket.remoteAddress);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{...identity,expires:Date.now()+86400000});res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);return send({ok:true})}
 if(u.pathname.startsWith('/api/')){
 const token=(req.headers.cookie||'').match(/(?:^|; )session=([a-f0-9]+)/)?.[1];const s=sessions.get(token);check(s && s.expires>Date.now(),'请先选择演示身份',401);
 if(!['GET','HEAD'].includes(req.method)){check(req.headers['x-demo-request']==='1','请求校验失败',403);const origin=req.headers.origin;if(origin)check(origin===`http://${req.headers.host}`,'来源校验失败',403)}
 domain.refreshSession(s);
 const b=req.method==='GET'?{}:await body(req); const route=u.pathname;
 const getRoutes=['/api/state','/api/reports','/api/calls','/api/calls/detail','/api/calls/ai/status'];
 if(getRoutes.includes(route))check(req.method==='GET','请求方法不支持',405);else check(req.method==='POST','请求方法不支持',405);
 const callResult=await calls.handle(route,b,s,u);if(callResult!==undefined)return send(callResult);
 const run=()=>domain.handle(route,b,s,u);
 const financial=['/api/members/recharge','/api/members/refund','/api/cards/buy','/api/cards/use','/api/cards/refund','/api/orders/pay','/api/orders/refund'];
 const advanced=financial.includes(route)&&b.operationId?transaction(()=>{check(/^[a-zA-Z0-9-]{8,100}$/.test(b.operationId),'操作编号无效');const key=s.tenant+'-'+(s.employeeId||s.role)+'-'+b.operationId;const saved=all('operation',s.tenant).find(x=>x.id===key);const signature=JSON.stringify({route,b});if(saved){check(saved.signature===signature,'同一操作编号不可用于不同请求',409);return saved.result}const result=run();put('operation',s.tenant,'all',{id:key,branch:'all',signature,result});return result}):run();if(advanced!==undefined)return send(advanced,req.method==='POST'&&['/api/pets','/api/appointments','/api/visits'].includes(route)?201:200);
 if(route==='/api/pets')domain.branchCheck(s,b.branch);
 if(route==='/api/logout'){sessions.delete(token);return send({ok:true})}
 if(route==='/api/pets'||route==='/api/pets/update'){
 allowed(s,['院长','前台']);const old=route.endsWith('/update')?record('pet',b.id,s):null;const input=old?{...old,...b,branch:old.branch}:b;
 check(text(input.name)&&text(input.owner),'宠物名称和宠主必填');check(/^1\d{10}$/.test(input.phone),'请输入 11 位手机号码');check(branches.some(x=>x.id===input.branch),'请选择门店');domain.branchCheck(s,input.branch);check(['猫','犬','其他'].includes(input.species),'物种无效');
 if(old?.intakeReview)check(b.profileVerified===true||b.profileVerified==='on','请逐项核对电话补充资料并勾选确认后保存');const details=profile.clean(input,check);const p={...(old||{id:crypto.randomUUID(),level:'普通会员',card:0,balanceCents:0}),...details,branch:input.branch,name:text(input.name),owner:text(input.owner),phone:input.phone,species:input.species};
 if(b.profileVerified===true||b.profileVerified==='on'){delete p.intakeReview;p.intakeStatus='已核对';p.verifiedAt=new Date().toISOString();p.verifiedBy=s.name||s.role}else if(old?.intakeReview)p.intakeStatus='待前台核对';
 if(b.birthday!==undefined||b.ageText!==undefined){p.ageMonths=null;if(p.birthday)p.ageText=''}p.missingFields=profile.missing(p);put('pet',s.tenant,p.branch,p);audit(s,(old?'更新':'新建')+'宠物档案：'+p.name);return send(p,old?200:201)}
 if(route==='/api/appointments/status'&&req.method==='POST'){
 const a=record('appointment',b.id,s);const next={'已预约':['待接诊','已取消'],'待接诊':['诊疗中','已取消']};check(next[a.status]?.includes(b.status),'该状态不能执行此操作',409);if(s.role==='宠主')check(b.status==='已取消','宠主只能取消预约',403);else allowed(s,['院长','前台','医生']);a.status=b.status;put('appointment',s.tenant,a.branch,a);audit(s,'预约状态：'+a.status);return send(a)}
 if(route==='/api/stock'&&req.method==='POST'){allowed(s,['院长','前台']);const r=record('stock',b.id,s);const delta=Number(b.delta);check(Number.isInteger(delta)&&delta!==0&&Math.abs(delta)<=10000,'数量应为非零整数');check(r.quantity+delta>=0,'库存不足',409);r.quantity+=delta;put('stock',s.tenant,r.branch,r);audit(s,`${r.name} 库存调整 ${delta}`);return send(r)}
 if(route==='/api/messages'&&req.method==='POST'){allowed(s,['院长','前台']);const p=record('pet',b.petId,s);check(text(b.content),'提醒内容必填');return send(put('message',s.tenant,p.branch,{id:crypto.randomUUID(),branch:p.branch,petId:p.id,title:text(b.title)||'到店提醒',content:text(b.content,500),type:'短信',status:'待处理'}),201)}
 if(route==='/api/messages/send'&&req.method==='POST'){allowed(s,['院长','前台']);const m=record('message',b.id,s);check(m.status==='待处理','该提醒已处理',409);m.status='模拟已发送';m.sentAt=new Date().toISOString();put('message',s.tenant,m.branch,m);audit(s,'模拟发送提醒');return send(m)}
 if(route==='/api/settings'&&req.method==='POST'){allowed(s,['院长']);check(text(b.name),'医院名称必填');const r=all('settings',s.tenant)[0];r.name=text(b.name);r.smsSignature=text(b.smsSignature);r.autoReminder=!!b.autoReminder;put('settings',s.tenant,'all',r);audit(s,'保存医院配置');return send(r)}
 throw err(404,'接口不存在');
 }
 if(req.method!=='GET'&&req.method!=='HEAD')throw err(405,'请求方法不支持');
 const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/profiles.js':'profiles.js','/advanced.js':'advanced.js','/styles.css':'styles.css','/calls.js':'calls.js','/booking.js':'booking.js','/phone.js':'phone.js','/voice-demo.wav':'voice-demo.wav'};if(/^\/voice\/[a-zA-Z0-9-]+\.(mp3|json)$/.test(u.pathname)&&fs.existsSync(path.join(root,'public',u.pathname.slice(1))))files[u.pathname]=u.pathname.slice(1);check(files[u.pathname],'页面不存在',404);
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wav':'audio/wav','.mp3':'audio/mpeg','.json':'application/json'};res.writeHead(200,{'Content-Type':types[path.extname(files[u.pathname])]+'; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"});res.end(fs.readFileSync(path.join(root,'public',files[u.pathname])));
 }catch(e){send({error:e.code?e.message:'服务器处理失败'},e.code||500);if(!e.code)console.error(e)}
});
server.listen(Number(process.env.PORT)||4318,'127.0.0.1',()=>console.log(`zzy Demo: http://127.0.0.1:${server.address().port}`));
