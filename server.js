const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const root = __dirname;
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
function record(kind,id,s){const r=all(kind,s.tenant).find(x=>x.id===id); check(r,'记录不存在',404); if(s.role==='宠主')check(r.petId===s.petId || r.id===s.petId,'无权查看该记录',403);return r}
function audit(s,action){put('audit',s.tenant,'all',{id:crypto.randomUUID(),action,role:s.role,at:new Date().toISOString(),branch:'all'})}
async function body(req){let b='';for await(const c of req){b+=c;check(b.length<100000,'请求过大',413)}try{return JSON.parse(b||'{}')}catch{throw err(400,'JSON 格式错误')}}
function text(v,max=100){return String(v||'').trim().slice(0,max)}
function dateValid(v){const d=new Date(v+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===v}
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 const send=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(v))};
 try{
 if(u.pathname==='/api/login' && req.method==='POST') {const b=await body(req);check(roles.includes(b.role),'角色无效');check(['demo','sandbox'].includes(b.tenant),'医院无效');const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{role:b.role,tenant:b.tenant,petId:b.tenant+'-p1',expires:Date.now()+86400000});res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);return send({ok:true})}
 if(u.pathname.startsWith('/api/')){
 const token=(req.headers.cookie||'').match(/(?:^|; )session=([a-f0-9]+)/)?.[1];const s=sessions.get(token);check(s && s.expires>Date.now(),'请先选择演示身份',401);
 if(!['GET','HEAD'].includes(req.method)){check(req.headers['x-demo-request']==='1','请求校验失败',403);const origin=req.headers.origin;if(origin)check(origin===`http://${req.headers.host}`,'来源校验失败',403)}
 const b=req.method==='GET'?{}:await body(req); const route=u.pathname;
 if(route==='/api/logout'){sessions.delete(token);return send({ok:true})}
 if(route==='/api/state'){
 const branch=u.searchParams.get('branch')||'all';check(branch==='all'||branches.some(x=>x.id===branch),'门店无效');
 const list=k=>all(k,s.tenant).filter(r=>(branch==='all'||r.branch===branch||r.branch==='all') && (s.role!=='宠主'||r.id===s.petId||r.petId===s.petId));
 return send({session:{role:s.role,tenant:s.tenant},today:today(),branches,services,pets:list('pet'),appointments:list('appointment'),visits:list('visit'),orders:s.role==='医生'?[]:list('order'),stock:s.role==='宠主'?[]:list('stock'),messages:s.role==='医生'?[]:list('message'),settings:all('settings',s.tenant)[0],audit:s.role==='院长'?all('audit',s.tenant).slice(-20).reverse():[]})}
 if(route==='/api/pets'&&req.method==='POST'){
 allowed(s,['院长','前台']);check(text(b.name)&&text(b.owner),'宠物名称和宠主必填');check(/^1\d{10}$/.test(b.phone),'请输入 11 位手机号码');check(branches.some(x=>x.id===b.branch),'请选择门店');check(['猫','犬','其他'].includes(b.species),'物种无效');check(Number(b.weight)>0&&Number(b.weight)<200,'体重应在 0～200 kg 之间');
 const p=put('pet',s.tenant,b.branch,{id:crypto.randomUUID(),branch:b.branch,name:text(b.name),owner:text(b.owner),phone:b.phone,species:b.species,breed:text(b.breed),weight:Number(b.weight),birthday:text(b.birthday),sex:text(b.sex),notes:text(b.notes,1000),level:'普通会员',card:0});audit(s,'新建宠物档案：'+p.name);return send(p,201)}
 if(route==='/api/appointments'&&req.method==='POST'){
 allowed(s,roles);const p=record('pet',b.petId,s);check(dateValid(b.date)&&b.date>=today(),'预约日期不能早于今天');check(/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time),'时间无效');check(['林医生','陈医生','张医生'].includes(b.doctor),'请选择医生');check(text(b.reason),'请填写预约事项');
 check(!all('appointment',s.tenant).some(a=>a.branch===p.branch&&a.date===b.date&&a.time===b.time&&a.doctor===b.doctor&&a.status!=='已取消'),'该医生此时段已有预约，请调整时间',409);
 const a=put('appointment',s.tenant,p.branch,{id:crypto.randomUUID(),petId:p.id,branch:p.branch,date:b.date,time:b.time,doctor:b.doctor,reason:text(b.reason),status:'已预约'});audit(s,'创建预约：'+p.name);return send(a,201)}
 if(route==='/api/appointments/status'&&req.method==='POST'){
 const a=record('appointment',b.id,s);const next={'已预约':['待接诊','已取消'],'待接诊':['诊疗中','已取消']};check(next[a.status]?.includes(b.status),'该状态不能执行此操作',409);if(s.role==='宠主')check(b.status==='已取消','宠主只能取消预约',403);else allowed(s,['院长','前台','医生']);a.status=b.status;put('appointment',s.tenant,a.branch,a);audit(s,'预约状态：'+a.status);return send(a)}
 if(route==='/api/visits'&&req.method==='POST'){
 allowed(s,['院长','医生']);const a=record('appointment',b.appointmentId,s);check(a.status==='诊疗中','请先开始接诊',409);check(text(b.complaint)&&text(b.diagnosis),'主诉和诊疗记录必填');check(Array.isArray(b.services)&&b.services.length>0,'至少选择一个服务项目');check(b.services.length<=20,'项目过多');const items=b.services.map(id=>{const x=services.find(i=>i.id===id);check(x,'无效收费项目');return {...x}});check(new Set(b.services).size===b.services.length,'服务项目重复');
 return send(transaction(()=>{const v=put('visit',s.tenant,a.branch,{id:crypto.randomUUID(),appointmentId:a.id,petId:a.petId,branch:a.branch,doctor:a.doctor,date:today(),complaint:text(b.complaint,2000),diagnosis:text(b.diagnosis,2000),advice:text(b.advice,2000),items});put('order',s.tenant,a.branch,{id:crypto.randomUUID(),visitId:v.id,petId:a.petId,branch:a.branch,date:today(),items,total:items.reduce((n,x)=>n+x.price,0),status:'待收费'});a.status='待收费';put('appointment',s.tenant,a.branch,a);audit(s,'保存病历并开单');return v}),201)}
 if(route==='/api/orders/pay'&&req.method==='POST'){
 allowed(s,['院长','前台']);const o=record('order',b.id,s);check(o.status==='待收费','订单已经结算',409);check(['微信（模拟）','现金（模拟）','支付宝（模拟）'].includes(b.method),'支付方式无效');return send(transaction(()=>{o.status='已支付';o.method=b.method;o.paidAt=new Date().toISOString();put('order',s.tenant,o.branch,o);const v=record('visit',o.visitId,s),a=record('appointment',v.appointmentId,s);a.status='已完成';put('appointment',s.tenant,a.branch,a);audit(s,'模拟收款 ¥'+o.total);return o}))}
 if(route==='/api/cards/use'&&req.method==='POST'){allowed(s,['院长','前台']);const p=record('pet',b.id,s);check(p.card>0,'计次卡余额不足',409);p.card--;put('pet',s.tenant,p.branch,p);audit(s,'核销计次卡：'+p.name);return send(p)}
 if(route==='/api/stock'&&req.method==='POST'){allowed(s,['院长','前台']);const r=record('stock',b.id,s);const delta=Number(b.delta);check(Number.isInteger(delta)&&delta!==0&&Math.abs(delta)<=10000,'数量应为非零整数');check(r.quantity+delta>=0,'库存不足',409);r.quantity+=delta;put('stock',s.tenant,r.branch,r);audit(s,`${r.name} 库存调整 ${delta}`);return send(r)}
 if(route==='/api/messages'&&req.method==='POST'){allowed(s,['院长','前台']);const p=record('pet',b.petId,s);check(text(b.content),'提醒内容必填');return send(put('message',s.tenant,p.branch,{id:crypto.randomUUID(),branch:p.branch,petId:p.id,title:text(b.title)||'到店提醒',content:text(b.content,500),type:'短信',status:'待处理'}),201)}
 if(route==='/api/messages/send'&&req.method==='POST'){allowed(s,['院长','前台']);const m=record('message',b.id,s);check(m.status==='待处理','该提醒已处理',409);m.status='模拟已发送';m.sentAt=new Date().toISOString();put('message',s.tenant,m.branch,m);audit(s,'模拟发送提醒');return send(m)}
 if(route==='/api/settings'&&req.method==='POST'){allowed(s,['院长']);check(text(b.name),'医院名称必填');const r=all('settings',s.tenant)[0];r.name=text(b.name);r.smsSignature=text(b.smsSignature);r.autoReminder=!!b.autoReminder;put('settings',s.tenant,'all',r);audit(s,'保存医院配置');return send(r)}
 throw err(404,'接口不存在');
 }
 if(req.method!=='GET'&&req.method!=='HEAD')throw err(405,'请求方法不支持');
 const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css'};check(files[u.pathname],'页面不存在',404);
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css'};res.writeHead(200,{'Content-Type':types[path.extname(files[u.pathname])]+'; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"});res.end(fs.readFileSync(path.join(root,'public',files[u.pathname])));
 }catch(e){send({error:e.code?e.message:'服务器处理失败'},e.code||500);if(!e.code)console.error(e)}
});
server.listen(Number(process.env.PORT)||4318,'127.0.0.1',()=>console.log(`讯德 3.0 Demo: http://127.0.0.1:${server.address().port}`));
