// 3.1 业务扩展；所有金额以整数分入账，旧版数据通过启动迁移保留。
const crypto=require('node:crypto');
module.exports=function(ctx){
 const {all,put,check,allowed,record,today,text,dateValid,transaction,audit,branches,services}=ctx;
 const id=()=>crypto.randomUUID();
 const doctors=t=>[...new Set(['林医生','陈医生','张医生',...all('employee',t).filter(e=>e.role==='医生'&&e.active).map(e=>e.name)])];
 const cents=v=>{check(/^(\d+)(\.\d{1,2})?$/.test(String(v)),'金额最多保留两位小数');const n=Math.round(Number(v)*100);check(Number.isSafeInteger(n)&&n>0&&n<=100000000,'金额必须大于零且不超过一百万元');return n};
 const time=v=>{check(/^([01]\d|2[0-3]):[0-5]\d$/.test(v),'时间格式应为 HH:mm');return Number(v.slice(0,2))*60+Number(v.slice(3))};
 const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 const overlap=(a,b,c,d)=>a<d&&c<b;
 const visible=(s,b)=>s.role==='宠主'||s.branches.includes(b);
 const branchCheck=(s,b)=>check(branches.some(x=>x.id===b)&&visible(s,b),'无权操作此门店',403);
 const config=t=>all('policy',t)[0];
 const catalog=t=>all('service',t);
 const hash=p=>{const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync(p,salt,64).toString('hex')}};
 const cleanEmployee=e=>{const {salt,hash,password,...r}=e;return r};
 const ledger=(s,type,amount,branch,extra={})=>put('ledger',s.tenant,branch,{id:id(),branch,type,amount,at:new Date().toISOString(),date:today(),actor:s.employeeId||s.role,...extra});
 function migrate(t){
  if(!all('policy',t).length)put('policy',t,'all',{id:t+'-policy',branch:'all',discounts:{'普通会员':100,'银卡':95,'金卡':90},cardName:'基础洗护5次卡',cardService:'groom',cardCount:5,cardPrice:40000});
  if(!catalog(t).length)services.forEach((s,i)=>put('service',t,'all',{...s,id:t+'-service-'+s.id,code:s.id,branch:'all',duration:[30,30,20,45,60][i],priceCents:s.price*100}));
  if(!all('employee',t).length){[['admin','院长',['b1','b2'],'连锁院长'],['frontdesk','前台',['b1'],'滨江前台'],['doctor','医生',['b1'],'林医生']].forEach(([username,role,bs,name])=>put('employee',t,'all',{id:t+'-'+username,branch:'all',username,role,branches:bs,name,active:true,...hash('Demo2026!')}))}
  all('pet',t).forEach(p=>{if(p.balanceCents===undefined){p.balanceCents=0;put('pet',t,p.branch,p)}if(p.card>0&&!all('card',t).some(c=>c.petId===p.id))put('card',t,p.branch,{id:id(),branch:p.branch,petId:p.id,name:'历史演示赠卡',serviceId:'groom',count:p.card,remaining:p.card,priceCents:0,status:'有效',at:new Date().toISOString()})});
  all('appointment',t).forEach(a=>{if(!a.duration){a.duration=30;a.serviceId='consult';a.endTime=clock(time(a.time)+30);put('appointment',t,a.branch,a)}});
  all('order',t).forEach(o=>{if(!o.petName){const p=all('pet',t).find(p=>p.id===o.petId);o.petName=p?.name||'历史宠物';o.ownerName=p?.owner||'';put('order',t,o.branch,o)}if(o.totalCents===undefined){o.totalCents=Math.round(o.total*100);o.subtotalCents=o.totalCents;o.discountPercent=100;o.paidCents=o.status==='已支付'?o.totalCents:0;o.refundCents=0;put('order',t,o.branch,o);if(o.paidCents)ledger({tenant:t,role:'迁移'},'订单收款',o.paidCents,o.branch,{orderId:o.id,petId:o.petId,channel:o.method||'现金（模拟）',date:o.date,at:o.paidAt||o.date+'T00:00:00+08:00',migrated:true})}});
 }
 migrate('demo');migrate('sandbox');
 function effectiveShifts(shifts,doctor,date){const day=new Date(date+'T00:00:00Z').getUTCDay();const specific=shifts.filter(x=>x.doctor===doctor&&x.date===date);return specific.length?specific:shifts.filter(x=>x.doctor===doctor&&!x.date&&x.weekday===day)}
 function getSchedule(s,doctor,branch,date){return effectiveShifts(all('schedule',s.tenant),doctor,date).filter(x=>x.branch===branch)}
 function scheduleFits(s,doctor,branch,date,start,end){const day=new Date(date+'T00:00:00Z').getUTCDay();const configured=all('schedule',s.tenant).some(x=>x.doctor===doctor&&(x.date?x.date===date:x.weekday===day));const shifts=getSchedule(s,doctor,branch,date);return shifts.length?shifts.some(x=>time(x.start)<=start&&time(x.end)>=end):!configured&&start>=510&&end<=1230}
 function validateSlot(s,a,ignore){
  const start=time(a.time),end=start+a.duration;check(end<=1440,'服务不能跨过午夜');check(scheduleFits(s,a.doctor,a.branch,a.date,start,end),'预约超出医生排班时段',409);
  check(!all('leave',s.tenant).some(x=>x.active&&x.date===a.date&&(x.type==='门店停诊'?x.branch===a.branch:x.doctor===a.doctor)&&overlap(start,end,time(x.start),time(x.end))),'该时段医生请假或门店停诊',409);
  check(!all('appointment',s.tenant).some(x=>x.id!==ignore&&x.date===a.date&&x.doctor===a.doctor&&x.status!=='已取消'&&overlap(start,end,time(x.time),time(x.time)+(x.duration||30))),'该医生连续时段已有预约（含跨门店）',409);
  a.endTime=clock(end);
 }
 function orderStatus(o){if(o.refundCents>0&&o.paidCents===o.totalCents)o.status=o.refundCents===o.paidCents?'已退款':'部分退款';else o.status=o.paidCents>=o.totalCents?'已支付':o.paidCents>0?'部分支付':'待收费';o.total=o.totalCents/100;return o}
 const attempts=new Map();
 function authenticate(b,ip){
  check(['demo','sandbox'].includes(b.tenant),'医院无效');
  if(b.username){const key=ip+':'+b.tenant+':'+text(b.username);const attemptsNow=attempts.get(key)||{count:0,at:Date.now()};if(Date.now()-attemptsNow.at>600000){attemptsNow.count=0;attemptsNow.at=Date.now()}check(attemptsNow.count<10,'登录失败次数过多，请十分钟后再试',429);const e=all('employee',b.tenant).find(x=>x.username===text(b.username));const derived=crypto.scryptSync(String(b.password||''),e?.salt||'dummy-salt',64);const ok=e?.active&&crypto.timingSafeEqual(derived,Buffer.from(e.hash,'hex'));if(!ok){attemptsNow.count++;attempts.set(key,attemptsNow);check(false,'账号或密码错误',401)}attempts.delete(key);return {role:e.role,tenant:b.tenant,employeeId:e.id,branches:e.branches,name:e.name}}
  check(process.env.DEMO_LOGIN!=='0','演示身份入口已关闭',403);check(['院长','前台','医生','宠主'].includes(b.role),'角色无效');return {role:b.role,tenant:b.tenant,petId:b.tenant+'-p1',branches:['b1','b2'],name:'演示'+b.role,demo:true};
 }
 function refreshSession(s){if(s.employeeId){const e=all('employee',s.tenant).find(x=>x.id===s.employeeId);check(e?.active,'账号已停用，请重新选择身份',401);s.role=e.role;s.branches=e.branches;s.name=e.name}if(!s.branches)s.branches=['b1','b2']}
 function totals(s,from,to,branch){
  const ls=all('ledger',s.tenant).filter(l=>(branch==='all'||l.branch===branch)&&visible(s,l.branch)&&l.date>=from&&l.date<=to);
  const os=all('order',s.tenant).filter(o=>(branch==='all'||o.branch===branch)&&visible(s,o.branch));
  const sum=types=>ls.filter(l=>types.includes(l.type)).reduce((n,l)=>n+l.amount,0);
  const received=sum(['订单收款']),refunded=sum(['订单退款']);
  const groups=(key)=>{const map={};ls.forEach(l=>{const k=(key==='month'?l.date.slice(0,7):l[key])||'未分类';if(!map[k])map[k]={name:k,in:0,out:0,net:0};const out=['订单退款','余额退还','计次卡退卡'].includes(l.type);map[k][out?'out':'in']+=l.amount;map[k].net=map[k].in-map[k].out});return Object.values(map)};
  const allocation={};catalog(s.tenant).forEach(x=>allocation[x.code]=0);
  ls.filter(l=>l.orderId&&['订单收款','订单退款'].includes(l.type)).forEach(l=>{const o=os.find(x=>x.id===l.orderId);if(!o)return;const weights=o.items.map(i=>({code:i.id,weight:i.priceCents||Math.round(i.price*100)}));const total=weights.reduce((n,w)=>n+w.weight,0);if(!total)return;const parts=weights.map(w=>({...w,amount:Math.floor(l.amount*w.weight/total),remainder:(l.amount*w.weight)%total}));let leftover=l.amount-parts.reduce((n,w)=>n+w.amount,0);parts.sort((a,b)=>b.remainder-a.remainder||a.code.localeCompare(b.code));for(let n=0;n<leftover;n++)parts[n%parts.length].amount++;parts.forEach(w=>allocation[w.code]=(allocation[w.code]||0)+w.amount*(l.type==='订单退款'?-1:1))});
  const byService=catalog(s.tenant).map(service=>({name:service.name,code:service.code,net:allocation[service.code]||0}));
  const historicalPaid=orderId=>all('ledger',s.tenant).filter(l=>l.orderId===orderId&&l.type==='订单收款'&&l.date<=to).reduce((n,l)=>n+l.amount,0);
  const receivables=os.filter(o=>o.totalCents>historicalPaid(o.id)&&o.date<=to).map(o=>({...o,owedCents:o.totalCents-historicalPaid(o.id),ageDays:o.dueDate?Math.max(0,Math.floor((new Date(to)-new Date(o.dueDate))/86400000)):0}));
  return {from,to,received,refunded,net:received-refunded,recharge:sum(['会员充值']),balanceRefund:sum(['余额退还']),cardIncome:sum(['计次卡购买']),cardRefund:sum(['计次卡退卡']),cashNet:ls.filter(l=>l.channel!=='会员余额').reduce((n,l)=>n+(['订单退款','余额退还','计次卡退卡'].includes(l.type)?-l.amount:l.amount),0),balanceLiability:all('pet',s.tenant).filter(p=>(branch==='all'||p.branch===branch)&&visible(s,p.branch)).reduce((n,p)=>n+(p.balanceCents||0),0),cardLiability:all('card',s.tenant).filter(c=>c.status==='有效'&&(branch==='all'||c.branch===branch)&&visible(s,c.branch)).reduce((n,c)=>n+Math.floor(c.priceCents*c.remaining/c.count),0),receivables,byDay:groups('date'),byMonth:groups('month'),byChannel:groups('channel'),byBranch:groups('branch'),byService,ledger:ls.sort((a,b)=>b.at.localeCompare(a.at))};
 }
 function state(s,branch){
  check(branch==='all'||branches.some(x=>x.id===branch),'门店无效');if(branch!=='all')branchCheck(s,branch);
  const list=k=>all(k,s.tenant).filter(r=>(branch==='all'||r.branch===branch||r.branch==='all')&&(r.branch==='all'||visible(s,r.branch))&&(s.role!=='宠主'||r.id===s.petId||r.petId===s.petId));
  const staff=['院长','前台'].includes(s.role);
  const referencedIds=new Set([...list('appointment'),...list('visit'),...(s.role==='医生'?[]:list('order'))].map(x=>x.petId));const petReferences=all('pet',s.tenant).filter(p=>referencedIds.has(p.id)).map(p=>({id:p.id,name:p.name,owner:p.owner,breed:p.breed,species:p.species}));
  const pets=list('pet').map(p=>({...p,card:all('card',s.tenant).filter(c=>c.petId===p.id&&c.status==='有效').reduce((n,c)=>n+c.remaining,0)}));
  return {session:{role:s.role,tenant:s.tenant,name:s.name,branches:s.branches,demo:s.demo||false},today:today(),branches:branches.filter(b=>visible(s,b.id)),services:catalog(s.tenant).map(x=>({...x,id:x.code,price:x.priceCents/100})),pets,petReferences,appointments:list('appointment'),visits:list('visit'),orders:s.role==='医生'?[]:list('order'),stock:s.role==='宠主'?[]:list('stock'),messages:s.role==='医生'?[]:list('message'),settings:all('settings',s.tenant)[0],audit:s.role==='院长'?all('audit',s.tenant).slice(-50).reverse():[],policy:config(s.tenant),cards:s.role==='医生'?[]:list('card'),ledger:staff?list('ledger').reverse():[],schedules:s.role==='宠主'?[]:list('schedule'),leaves:s.role==='宠主'?[]:list('leave'),employees:s.role==='院长'?all('employee',s.tenant).map(cleanEmployee):[],reconciliations:s.role==='院长'?list('reconciliation'):[],doctors:doctors(s.tenant),paymentProvider:{mode:'simulation',liveReady:false}};
 }
 function handle(route,b,s,u){
  const admin=()=>allowed(s,['院长']);const globalAdmin=()=>{admin();check(branches.every(b=>s.branches.includes(b.id)),'全院配置需要全部门店权限',403)};const desk=()=>allowed(s,['院长','前台']);
  if(route==='/api/state')return state(s,u.searchParams.get('branch')||'all');
  if(route==='/api/reports'){admin();const from=u.searchParams.get('from')||today().slice(0,7)+'-01',to=u.searchParams.get('to')||today(),branch=u.searchParams.get('branch')||'all';check(dateValid(from)&&dateValid(to)&&from<=to,'报表日期无效');if(branch!=='all')branchCheck(s,branch);return totals(s,from,to,branch)}
  if(route==='/api/appointments'){
   const p=record('pet',b.petId,s);check(dateValid(b.date)&&b.date>=today(),'预约日期不能早于今天');check(doctors(s.tenant).includes(b.doctor),'医生无效');check(text(b.reason),'预约事项必填');const service=catalog(s.tenant).find(x=>x.code===(b.serviceId||'consult'));check(service,'服务无效');const ab=b.branch||p.branch;branchCheck(s,ab);const duration=b.duration===undefined?service.duration:Number(b.duration);check(Number.isInteger(duration)&&duration>=5&&duration<=240,'服务时长必须为 5～240 分钟');const a={id:id(),branch:ab,petId:p.id,date:b.date,time:b.time,doctor:b.doctor,reason:text(b.reason),duration,serviceId:service.code,status:'已预约'};validateSlot(s,a);put('appointment',s.tenant,ab,a);audit(s,'创建预约 '+a.time+'—'+a.endTime);return a;
  }
  if(route==='/api/schedules'){
   admin();branchCheck(s,b.branch);check(doctors(s.tenant).includes(b.doctor),'医生无效');const start=time(b.start),end=time(b.end);check(start<end,'结束时间须晚于开始时间');if(b.date)check(dateValid(b.date)&&b.date>=today(),'排班日期无效');else check(Number.isInteger(Number(b.weekday))&&Number(b.weekday)>=0&&Number(b.weekday)<=6,'星期无效');
   if(b.id)record('schedule',b.id,s);
   const shifts=all('schedule',s.tenant).filter(x=>x.id!==b.id&&x.doctor===b.doctor&&(b.date?x.date===b.date:!x.date&&x.weekday===Number(b.weekday)));check(!shifts.some(x=>overlap(start,end,time(x.start),time(x.end))),'医生排班跨门店重叠',409);
   const relevant=all('appointment',s.tenant).filter(a=>a.status!=='已取消'&&a.doctor===b.doctor&&a.date>=today()&&(b.date?a.date===b.date:new Date(a.date+'T00:00:00Z').getUTCDay()===Number(b.weekday)));
   const next={id:b.id||id(),branch:b.branch,doctor:b.doctor,start:b.start,end:b.end,...(b.date?{date:b.date}:{weekday:Number(b.weekday)})};
   const configured=all('schedule',s.tenant).filter(x=>x.id!==b.id&&x.doctor===b.doctor);
   // 首次显式排班也不能将既有预约变为无排班预约。
   for(const a of relevant){const day=new Date(a.date+'T00:00:00Z').getUTCDay();const candidates=effectiveShifts([...configured,next],a.doctor,a.date).filter(x=>x.branch===a.branch);check(candidates.some(x=>time(x.start)<=time(a.time)&&time(x.end)>=time(a.time)+(a.duration||30)),'新排班不能覆盖既有预约，请先取消冲突预约或扩大时段',409)}
   put('schedule',s.tenant,b.branch,next);audit(s,'新增医生排班');return next;
  }
  if(route==='/api/schedules/remove'){
   admin();const shift=record('schedule',b.id,s);transaction(()=>{ctx.remove(shift.id);try{all('appointment',s.tenant).filter(a=>a.doctor===shift.doctor&&a.status!=='已取消'&&a.date>=today()).forEach(a=>check(scheduleFits(s,a.doctor,a.branch,a.date,time(a.time),time(a.time)+(a.duration||30)),'删除排班会影响现有预约',409))}catch(e){throw e}audit(s,'删除医生排班')});return {ok:true};
  }
  if(route==='/api/leaves'){
   admin();branchCheck(s,b.branch);check(['医生请假','门店停诊'].includes(b.type),'停诊类型无效');if(b.type==='医生请假')check(doctors(s.tenant).includes(b.doctor),'医生无效');check(dateValid(b.date)&&b.date>=today(),'日期无效');const start=time(b.start),end=time(b.end);check(start<end,'结束时间须晚于开始时间');check(text(b.reason),'原因必填');check(!all('appointment',s.tenant).some(a=>a.date===b.date&&a.status!=='已取消'&&(b.type==='门店停诊'?a.branch===b.branch:a.doctor===b.doctor)&&overlap(start,end,time(a.time),time(a.time)+(a.duration||30))),'此时段存在预约，请先取消预约再设置请假或停诊',409);const l=put('leave',s.tenant,b.branch,{id:id(),branch:b.branch,type:b.type,doctor:b.doctor,date:b.date,start:b.start,end:b.end,reason:text(b.reason),active:true});audit(s,'登记 '+b.type);return l;
  }
  if(route==='/api/leaves/cancel'){admin();const l=record('leave',b.id,s);check(l.active,'已恢复营业',409);l.active=false;put('leave',s.tenant,l.branch,l);audit(s,'恢复 '+l.type);return l}
  if(route==='/api/policy'){
   globalAdmin();const p=config(s.tenant);for(const level of ['普通会员','银卡','金卡']){const n=Number(b.discounts?.[level]);check(Number.isInteger(n)&&n>=1&&n<=100,'折扣百分比应为 1～100');p.discounts[level]=n}check(Number.isInteger(Number(b.cardCount))&&Number(b.cardCount)>0&&Number(b.cardCount)<=100,'卡次数应为 1～100');check(catalog(s.tenant).some(x=>x.code===b.cardService),'卡服务无效');p.cardCount=Number(b.cardCount);p.cardPrice=cents(b.cardPrice);p.cardService=b.cardService;p.cardName=text(b.cardName);check(p.cardName,'卡名称必填');put('policy',s.tenant,'all',p);audit(s,'更新会员折扣和卡套餐');return p;
  }
  if(route==='/api/services'){
   globalAdmin();const service=catalog(s.tenant).find(x=>x.code===b.id);check(service,'服务不存在',404);service.priceCents=cents(b.price);service.price=service.priceCents/100;service.duration=Number(b.duration);check(Number.isInteger(service.duration)&&service.duration>=5&&service.duration<=240,'服务时长无效');put('service',s.tenant,'all',service);audit(s,'更新统一服务价格 '+service.name);return service;
  }
  if(route==='/api/members/level'){desk();const p=record('pet',b.petId,s);check(Object.hasOwn(config(s.tenant).discounts,b.level),'会员等级无效');p.level=b.level;put('pet',s.tenant,p.branch,p);audit(s,'更新会员等级');return p}
  if(route==='/api/members/recharge'||route==='/api/members/refund'){
   desk();const p=record('pet',b.petId,s);const amount=cents(b.amount);return transaction(()=>{if(route.endsWith('recharge')){p.balanceCents+=amount;ledger(s,'会员充值',amount,p.branch,{petId:p.id,channel:'现金（模拟）',reason:text(b.reason)||'会员充值'})}else{check(p.balanceCents>=amount,'余额不足',409);check(text(b.reason),'退款原因必填');p.balanceCents-=amount;ledger(s,'余额退还',amount,p.branch,{petId:p.id,channel:'现金（模拟）',reason:text(b.reason)})}put('pet',s.tenant,p.branch,p);audit(s,route.endsWith('recharge')?'会员充值':'余额退还');return p})
  }
  if(route==='/api/cards/buy'){
   desk();const p=record('pet',b.petId,s),policy=config(s.tenant);return transaction(()=>{const c=put('card',s.tenant,p.branch,{id:id(),branch:p.branch,petId:p.id,name:policy.cardName,serviceId:policy.cardService,count:policy.cardCount,remaining:policy.cardCount,priceCents:policy.cardPrice,status:'有效',at:new Date().toISOString()});ledger(s,'计次卡购买',c.priceCents,p.branch,{petId:p.id,cardId:c.id,channel:'现金（模拟）'});audit(s,'购买计次卡');return c})
  }
  if(route==='/api/cards/use'){
   desk();const p=b.cardId?record('card',b.cardId,s):null;const c=p||all('card',s.tenant).find(x=>x.petId===b.id&&x.status==='有效'&&x.remaining>0);if(!p)record('pet',b.id,s);check(c&&c.remaining>0&&c.status==='有效','计次卡余额不足',409);branchCheck(s,b.branch||c.branch);if(b.serviceId)check(b.serviceId===c.serviceId,'服务与计次卡不匹配');c.remaining--;put('card',s.tenant,c.branch,c);audit(s,`计次卡核销 ${c.name}，剩余 ${c.remaining} 次`);put('cardUse',s.tenant,b.branch||c.branch,{id:id(),branch:b.branch||c.branch,cardId:c.id,petId:c.petId,date:today(),serviceId:c.serviceId});return c;
  }
  if(route==='/api/cards/refund'){
   desk();const c=record('card',b.id,s);check(c.status==='有效','已退卡',409);check(text(b.reason),'退卡原因必填');return transaction(()=>{const amount=Math.floor(c.priceCents*c.remaining/c.count);c.status='已退卡';c.refundCents=amount;c.remaining=0;put('card',s.tenant,c.branch,c);ledger(s,'计次卡退卡',amount,c.branch,{petId:c.petId,cardId:c.id,channel:'现金（模拟）',reason:text(b.reason)});audit(s,'退还未消费计次卡余额');return c})
  }
  if(route==='/api/visits'){
   allowed(s,['院长','医生']);const a=record('appointment',b.appointmentId,s);check(a.status==='诊疗中','请先开始接诊',409);check(text(b.complaint)&&text(b.diagnosis),'主诉和诊疗记录必填');check(Array.isArray(b.services)&&b.services.length>0&&b.services.length<=20,'至少选择一个服务项目');check(new Set(b.services).size===b.services.length,'服务项目重复');const items=b.services.map(code=>{const x=catalog(s.tenant).find(x=>x.code===code);check(x,'服务项目无效');return {id:x.code,name:x.name,price:x.priceCents/100,priceCents:x.priceCents}});const p=all('pet',s.tenant).find(p=>p.id===a.petId);check(p,'宠物不存在',404);const percent=config(s.tenant).discounts[p.level]||100,subtotal=items.reduce((n,i)=>n+i.priceCents,0),total=Math.round(subtotal*percent/100);
   return transaction(()=>{const v=put('visit',s.tenant,a.branch,{id:id(),branch:a.branch,petId:a.petId,appointmentId:a.id,doctor:a.doctor,date:today(),complaint:text(b.complaint,2000),diagnosis:text(b.diagnosis,2000),advice:text(b.advice,2000),items});put('order',s.tenant,a.branch,{id:id(),branch:a.branch,petId:a.petId,visitId:v.id,petName:p.name,ownerName:p.owner,date:today(),items,subtotalCents:subtotal,totalCents:total,total:total/100,discountPercent:percent,paidCents:0,refundCents:0,status:'待收费'});a.status='待收费';put('appointment',s.tenant,a.branch,a);audit(s,'保存病历并按会员折扣开单');return v})
  }
  if(route==='/api/orders/pay'){
   desk();const o=record('order',b.id,s);check(o.paidCents<o.totalCents,'订单已经结算',409);check(['微信（模拟）','现金（模拟）','支付宝（模拟）','会员余额'].includes(b.method),'支付方式无效');const amount=b.amount===undefined?o.totalCents-o.paidCents:cents(b.amount);check(amount<=o.totalCents-o.paidCents,'收款超过未付金额');
   return transaction(()=>{if(b.method==='会员余额'){const p=record('pet',o.petId,s);check(p.balanceCents>=amount,'会员余额不足',409);p.balanceCents-=amount;put('pet',s.tenant,p.branch,p)}o.paidCents+=amount;o.method=b.method;o.paidAt=new Date().toISOString();orderStatus(o);put('order',s.tenant,o.branch,o);ledger(s,'订单收款',amount,o.branch,{orderId:o.id,petId:o.petId,channel:b.method});const v=record('visit',o.visitId,s),a=record('appointment',v.appointmentId,s);if(o.paidCents===o.totalCents){a.status='已完成';put('appointment',s.tenant,a.branch,a)}audit(s,'收款 ¥'+amount/100);return o})
  }
  if(route==='/api/orders/debt'){desk();const o=record('order',b.id,s);check(o.paidCents<o.totalCents,'已无欠费',409);check(dateValid(b.dueDate)&&b.dueDate>=today(),'到期日无效');check(text(b.reason),'欠费原因必填');o.dueDate=b.dueDate;o.debtReason=text(b.reason);put('order',s.tenant,o.branch,o);audit(s,'登记欠费账期');return o}
  if(route==='/api/orders/refund'){
   desk();const o=record('order',b.id,s);const payment=record('ledger',b.paymentId,s);check(payment.orderId===o.id&&payment.type==='订单收款','退款必须关联原收款');const amount=cents(b.amount);const already=all('ledger',s.tenant).filter(l=>l.paymentId===payment.id&&l.type==='订单退款').reduce((n,l)=>n+l.amount,0);check(amount<=payment.amount-already,'退款超过该笔收款可退金额',409);check(text(b.reason),'退款原因必填');return transaction(()=>{if(payment.channel==='会员余额'){const p=record('pet',o.petId,s);p.balanceCents+=amount;put('pet',s.tenant,p.branch,p)}o.refundCents+=amount;orderStatus(o);put('order',s.tenant,o.branch,o);ledger(s,'订单退款',amount,o.branch,{orderId:o.id,petId:o.petId,paymentId:payment.id,channel:payment.channel,reason:text(b.reason)});audit(s,'原路模拟退款 ¥'+amount/100);return o})
  }
  if(route==='/api/payments/live'){desk();check(false,'真实支付尚未配置商户号、证书及签名回调。当前仅开放模拟支付。',503)}
  if(route==='/api/employees'){
   admin();check(/^[a-zA-Z0-9_]{3,32}$/.test(b.username),'账号须为 3～32 位字母数字或下划线');check(!all('employee',s.tenant).some(e=>e.username===b.username),'账号已存在',409);check(String(b.password||'').length>=8&&String(b.password).length<=128,'密码需要 8～128 位');check(['院长','前台','医生'].includes(b.role),'角色无效');check(Array.isArray(b.branches)&&b.branches.length>0&&b.branches.every(x=>branches.some(y=>y.id===x)),'至少授权一个有效门店');b.branches.forEach(x=>branchCheck(s,x));check(text(b.name),'姓名必填');const e=put('employee',s.tenant,'all',{id:id(),branch:'all',name:text(b.name),username:b.username,role:b.role,branches:[...new Set(b.branches)],active:true,...hash(b.password)});audit(s,'创建员工账号 '+e.username);return cleanEmployee(e);
  }
  if(route==='/api/employees/update'){
   admin();const e=record('employee',b.id,s);check(e.branches.every(x=>s.branches.includes(x)),'无权管理此员工门店',403);check(e.id!==s.employeeId,'不能修改自己当前账号权限');check(['院长','前台','医生'].includes(b.role),'角色无效');check(Array.isArray(b.branches)&&b.branches.length>0&&b.branches.every(x=>branches.some(y=>y.id===x)),'请选择门店');b.branches.forEach(x=>branchCheck(s,x));check(typeof b.active==='boolean','账号状态无效');if(e.role==='院长'&&(!b.active||b.role!=='院长'))check(all('employee',s.tenant).some(x=>x.id!==e.id&&x.role==='院长'&&x.active),'不能停用最后一个院长',409);e.role=b.role;e.branches=[...new Set(b.branches)];e.active=b.active;put('employee',s.tenant,'all',e);audit(s,'更新员工门店权限 '+e.username);return cleanEmployee(e);
  }
  if(route==='/api/pets/transfer'){desk();const p=record('pet',b.id,s);branchCheck(s,b.branch);check(p.branch!==b.branch,'请选择不同门店');check(!all('appointment',s.tenant).some(a=>a.petId===p.id&&!['已完成','已取消'].includes(a.status)),'宠物仍有未完成预约，请先处理',409);return transaction(()=>{p.branch=b.branch;put('pet',s.tenant,p.branch,p);all('card',s.tenant).filter(c=>c.petId===p.id&&c.status==='有效').forEach(c=>{c.branch=b.branch;put('card',s.tenant,c.branch,c)});audit(s,'转移宠物档案至 '+b.branch+'，历史订单门店保持原归属');return p})}
  if(route==='/api/reconciliations'){
   admin();branchCheck(s,b.branch);check(dateValid(b.date),'对账日期无效');check(['微信（模拟）','支付宝（模拟）','现金（模拟）'].includes(b.channel),'对账渠道无效');check(Array.isArray(b.lines)&&b.lines.length<=1000,'对账明细最多 1000 行');check(new Set(b.lines.map(l=>l.id)).size===b.lines.length,'流水号重复');const expected=all('ledger',s.tenant).filter(l=>l.date===b.date&&l.branch===b.branch&&l.channel===b.channel);const entries=b.lines.map(l=>{check(typeof l.id==='string'&&l.id.length<=100,'流水号无效');check(Number.isSafeInteger(l.amount)&&Math.abs(l.amount)<=100000000,'对账金额无效');return {id:l.id,amount:l.amount}});const signed=l=>['订单退款','余额退还','计次卡退卡'].includes(l.type)?-l.amount:l.amount;
   const differences=[];expected.forEach(l=>{const a=entries.find(x=>x.id===l.id);if(!a)differences.push({id:l.id,type:'渠道缺失',expected:signed(l),actual:0});else if(a.amount!==signed(l))differences.push({id:l.id,type:'金额不符',expected:signed(l),actual:a.amount})});entries.filter(l=>!expected.some(x=>x.id===l.id)).forEach(l=>differences.push({id:l.id,type:'系统缺失',expected:0,actual:l.amount}));
   const r=put('reconciliation',s.tenant,b.branch,{id:id(),branch:b.branch,date:b.date,channel:b.channel,expected:expected.reduce((n,l)=>n+signed(l),0),actual:entries.reduce((n,l)=>n+l.amount,0),status:differences.length?'有差异':'核对一致',differences,expectedSnapshot:expected.map(l=>({id:l.id,amount:signed(l)})),actualSnapshot:entries,at:new Date().toISOString()});audit(s,'保存渠道对账结果');return r;
  }
  return undefined;
 }
 return {authenticate,refreshSession,handle,branchCheck,visible};
};
