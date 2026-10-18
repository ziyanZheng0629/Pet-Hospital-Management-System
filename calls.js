const {DatabaseSync}=require('node:sqlite');
const crypto=require('node:crypto');
const path=require('node:path');
const buildDraft=require('./booking-draft');
const reception=require('./receptionist');
const receptionKnowledge=require('./knowledge/reception.json');
// 三个自然月，按北京时间计算，到月末时钳制日期；不会因后续跟进延长。
function expiresAfterThreeMonths(value){const d=new Date(new Date(value).getTime()+8*3600000),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+3);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return new Date(d.getTime()-8*3600000).toISOString()}
module.exports=function(ctx){
 const {all,put,check,allowed,branches,branchCheck,dataDir,createAppointment,createProfile,updateProfile,ai}=ctx;
 const db=new DatabaseSync(path.join(dataDir,'calls.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, branch TEXT NOT NULL, expires TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS call_expiry ON calls(expires); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);');
 const stamp=()=>new Date().toISOString();
 const urgentPattern=/呼吸困难|无法排尿|尿不出|没尿|没有尿|不尿|排不出尿|抽搐|昏迷|中毒|误食|急症|急救|出血不止|快不行/;
 // 增加业务案例，不改动已有客户或订单；固定标识保证重启不重复添加。
 for(const tenant of ['demo','sandbox'])if(!all('sampleBatch',tenant).some(x=>x.id===tenant+'-zzy-cases-v1')){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
  [['芝麻','猫','美短','何女士','b1','13:00','陈医生','健康体检咨询'],['芒果','犬','柴犬','孙先生','b1','13:45','林医生','年度检查预约'],['奶盖','猫','暹罗','许女士','b2','15:15','张医生','疫苗预约意向'],['饼干','犬','比熊','高先生','b2','16:15','张医生','基础洗护预约']].forEach((x,i)=>{const pid=tenant+'-case-pet-'+i;const mins=Number(x[5].slice(0,2))*60+Number(x[5].slice(3))+30;const endTime=String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');put('pet',tenant,x[4],{id:pid,branch:x[4],name:x[0],species:x[1],breed:x[2],owner:x[3]+'（演示）',phone:'1380000'+(5000+i),weight:[4.1,9.2,3.8,6.4][i],birthday:'2023-06-01',sex:i%2?'公':'母',level:i%2?'银卡':'普通会员',balanceCents:0,card:0,notes:'新增虚构业务案例，不代表真实病例。'});put('appointment',tenant,x[4],{id:tenant+'-case-appointment-'+i,branch:x[4],petId:pid,date:today,time:x[5],doctor:x[6],reason:x[7]+'（演示案例）',duration:30,endTime,serviceId:'consult',status:'已预约'})});
  put('sampleBatch',tenant,'all',{id:tenant+'-zzy-cases-v1',branch:'all',version:'3.2'});
 }
 function purge(now=stamp()){const result=db.prepare('DELETE FROM calls WHERE expires<=?').run(now);if(result.changes)db.exec('PRAGMA wal_checkpoint(TRUNCATE)');return Number(result.changes)}
 purge();const timer=setInterval(()=>{try{purge()}catch(e){console.error('通话到期清理失败',e.message)}},60000);timer.unref();
 const source=(id,title,content,version='1',url='')=>({id,title,content,version,url,kind:'院内演示知识',updatedAt:'2026-10-18T00:00:00+08:00'});
 const defaults=[
  source('hours','营业与门店信息','演示医院营业时间为 08:30—20:30。滨江总院：滨江路128号；城西分院：文一路66号。具体接诊能力由前台确认。'),
  source('booking','预约信息采集规范','先收集宠物、服务、意向日期和时间；预约意向不等于预约成功，须由前台确认医生排班与连续服务时段。'),
  source('price','服务报价说明','标准价以当前全院统一服务目录为准。实际费用由医生评估及最终收费单确认；会员折扣按开单时规则计算，不承诺总治疗费用。'),
  source('urgent','急症转人工规则','本系统遇到急症描述、用药剂量或诊断请求时不作诊断、不提供处方。疑似紧急情况应尽快联系兽医或就近宠物急诊，并交由人工处理。','1','https://ebusiness.avma.org/files/ProductDownloads/mcm-client-brochures-pet-first-aid-2025.pdf'),
  source('vaccine','疫苗咨询接待规范','疫苗种类、适用时间、健康条件由接诊兽医确认；电话端只收集疫苗预约意向，不判断是否适合接种。'),
  source('aftercare','诊后问题接待规范','诊后问题转交原接诊医生确认。电话端记录变化、发生时间和回访诉求，不解释具体用药、不更改医嘱。'),
  source('member','会员与退款接待规范','会员余额、消费与退款须先核验身份；电话演示仅说明充值、计次卡和退款流程，不披露个人账户余额，也不执行资金操作。'),
  source('complaint','投诉与人工接管规范','投诉、费用争议或未命中知识库的问题应登记原话、诉求，交前台或店长处理；不承诺赔付、诊断或未核实信息。')
 ];
 for(const tenant of ['demo','sandbox'])for(const k of defaults)if(!all('callKnowledge',tenant).some(x=>x.id===tenant+'-kb-'+k.id))put('callKnowledge',tenant,'all',{...k,code:k.id,id:tenant+'-kb-'+k.id,branch:'all'});
 for(const tenant of ['demo','sandbox'])for(const k of receptionKnowledge){const existing=all('callKnowledge',tenant).find(x=>x.id===tenant+'-kb-'+k.code);if(!existing||(existing.publisher===k.publisher&&Number(existing.version)<Number(k.version)))put('callKnowledge',tenant,'all',{...k,id:tenant+'-kb-'+k.code,branch:'all',updatedAt:stamp()})}
 const scenarios=[
  {id:'new-vaccine',name:'新客疫苗 · 逐步建档',phone:'13800009221',branch:'b1',caller:'新客疫苗演示',questions:['小猫想打疫苗，现在适合接种吗？','三个月','精神食欲挺好，没有生病','没打过','王女士','奶糖','英短','蓝白','六斤','小女生','没有发现过敏','明天下午三点']},
  {id:'known-groom',name:'老客美容 · 自动填档',phone:'13800001002',branch:'b1',caller:'李先生（案例）',questions:['我想预约宠物美容','黄白色','没有发现过敏','明天下午']},
  {id:'booking',name:'体检预约与价格',branch:'b1',caller:'陈女士（案例）',questions:['团子想预约体检，明天下午能来吗？','门诊和血常规多少钱？','请前台帮我确认时间。']},
  {id:'hours',name:'夜间来电问路',branch:'b2',caller:'杨先生（案例）',questions:['城西分院几点下班，地址在哪里？','谢谢，了解了。']},
  {id:'groom',name:'洗护时长咨询',branch:'b1',caller:'李先生（案例）',questions:['可乐洗护多少钱，需要多久？','想预约周末上午洗护。']},
  {id:'vaccine',name:'幼宠疫苗咨询',branch:'b1',caller:'周女士（案例）',questions:['小猫想打疫苗，现在适合接种吗？','帮我登记疫苗预约，想周六来。']},
  {id:'urgent',name:'急症转人工',branch:'b2',caller:'王先生（案例）',questions:['宠物呼吸困难，很着急。','请马上让人工接听。']},
  {id:'aftercare',name:'诊后复诊回访',branch:'b1',caller:'林女士（案例）',questions:['昨天看诊后想反馈一下，食欲有变化。','请让原来的医生回访我。']},
  {id:'refund',name:'会员退卡咨询',branch:'b2',caller:'刘先生（案例）',questions:['会员计次卡不用了怎么退？','帮我登记退款咨询，稍后核实。']},
  {id:'complaint',name:'费用争议与投诉',branch:'b1',caller:'赵女士（案例）',questions:['我对这次收费有异议，想投诉。','请让店长回电说明费用。']},
  {id:'unknown',name:'未知问题兜底',branch:'b2',caller:'吴先生（案例）',questions:['你们能提供宠物跨境托运证明吗？','请人工核实后联系我。']},
  {id:'medicine',name:'用药请求安全转交',branch:'b1',caller:'郑女士（案例）',questions:['药量要吃多少，能直接给我诊断吗？','好的，请让医生联系我。']}
 ];
 const kb=t=>all('callKnowledge',t);
 const snapshot=k=>({...k,retrievedAt:stamp(),hash:crypto.createHash('sha256').update(JSON.stringify(k)).digest('hex')});
 function reply(t,call,question){
  const get=code=>snapshot(kb(t).find(x=>x.code===code));const cited=[];const use=code=>{const k=get(code);cited.push(k);return k};let answer,intent,result,needsHuman=false,risk='普通';
  if(urgentPattern.test(question)){intent='急症分流';needsHuman=true;risk='紧急';answer=use('urgent').content;result='优先转人工，接诊能力待确认';}
  else if(/药量|剂量|怎么用药|如何用药|用药建议|处方|诊断|吃什么药/.test(question)){intent='医疗问题';needsHuman=true;risk='需医生';answer=use('urgent').content;result='转医生，不提供处方或诊断';}
  else if(/投诉|异议|赔偿|争议/.test(question)){intent='投诉争议';needsHuman=true;answer=use('complaint').content;result='前台 / 店长待处理';}
  else if(/退卡|退款|充值|会员|余额|计次卡/.test(question)){intent='会员咨询';needsHuman=true;answer=use('member').content;result='已记录账户咨询，待核验身份';}
  else if(/诊后|复诊|回访|原来.*医生|看诊后|食欲/.test(question)){intent='诊后回访';needsHuman=true;answer=use('aftercare').content;result='原接诊医生待回访';}
  else if(/疫苗|接种|打针/.test(question)){intent='疫苗预约';needsHuman=true;answer=use('vaccine').content+' '+use('booking').content;result='登记疫苗意向，待医生评估与前台确认';}
  else if(/请.*人工|请.*前台|请.*店长|转人工|回电|回拨|核实后联系/.test(question)){intent='人工跟进';needsHuman=true;answer='已记录人工跟进诉求，等待前台核实与联系；此演示不会真实转接或拨号。';use('complaint');result='等待前台联系，未实际转接';}
  else if(/多少|价格|费用|收费|多久|时长/.test(question)){
   intent='价格与时长';use('price');let services=all('service',t);const matching=services.filter(s=>new RegExp(({consult:'门诊|体检|诊查',blood:'血常规',groom:'洗护|美容',vaccine:'疫苗',ultrasound:'超声|B超'})[s.code]).test(question));services=matching.length?matching:services;
   const facts=services.map(s=>snapshot({id:s.id,title:s.name+' · 统一服务目录',version:String(s.updatedAt||s.priceCents+'-'+s.duration),kind:'业务数据快照',content:`标准价 ¥${(s.priceCents/100).toFixed(2)}；标准时长 ${s.duration} 分钟。`,priceCents:s.priceCents,duration:s.duration,branch:'all'}));cited.push(...facts);answer=facts.map(s=>s.title.replace(' · 统一服务目录','')+'：'+s.content).join(' ')+' '+cited[0].content;result='已回复标准价：'+facts.map(k=>k.title.replace(' · 统一服务目录','')+' ¥'+(k.priceCents/100).toFixed(2)+' / '+k.duration+'分钟').join('、')+'；最终费用待确认';
  }
  else if(/几点|营业|下班|地址|在哪|怎么走/.test(question)){intent='门店信息';answer=use('hours').content;result='已回复营业时间与地址';}
  else if(/预约|排班|明天|周末|周六|星期|登记.*时间/.test(question)){intent='预约意向';needsHuman=true;answer=use('booking').content;result='已记录预约意向，尚未创建预约';}
  else if(/人工|前台|店长|联系我|核实|回电|回拨/.test(question)){intent='人工跟进';needsHuman=true;answer='已把本通交流的询问、回复与待办整理到前台列表，等待人工接管；此演示不会真实拨号。';use('complaint');result='等待前台联系，未实际转接';}
  else if(/^(?:你好|您好|谢谢|好的|了解了|好)[，,。.!！\s]*(?:了解了[。！!\s]*)?$/.test(question.trim())){intent='一般接待';answer='您好，可以咨询门店信息、服务标准价、预约和回访流程；涉及诊疗或未核实内容会交前台确认。';use('booking');result='等待进一步说明诉求';}
  else {intent='待核实问题';needsHuman=true;answer='当前知识库没有能直接回答这一问题的依据。我已记录您的问题，交前台核实后回复，不会猜测或承诺。';use('complaint');result='知识未命中，转人工核实';}
  return {answer,intent,result,needsHuman,risk,sources:cited,engine:'院内知识检索与规则演示 v1（未调用大模型）'};
 }
 function summarize(c){const turns=c.turns.filter(x=>x.role==='assistant');const questions=c.turns.filter(x=>x.role==='caller');const urgent=turns.find(x=>x.risk==='紧急');const pending=turns.some(x=>x.needsHuman);const intents=[...new Set(turns.map(x=>x.intent))];const actions=[];if(intents.some(x=>/预约/.test(x)))actions.push('核实宠物、意向日期与医生时段，另行确认预约');if(intents.includes('会员咨询'))actions.push('核验会员身份后处理账户问题');if(intents.includes('投诉争议'))actions.push('转店长核实费用或服务争议');if(intents.includes('诊后回访'))actions.push('安排原接诊医生回访');if(intents.includes('医疗问题'))actions.push('转接诊医生核实，不在电话端给出处方或诊断');if(intents.includes('待核实问题'))actions.push('核实知识库未覆盖的问题后回复');c.summary={title:urgent?'急症来电，优先人工接管':turns[0]?.intent||'新来电',customer:questions.map(x=>x.text).join('；').slice(0,650),response:turns.map(x=>x.result).filter((x,i,a)=>a.indexOf(x)===i).join('；'),intents:[...new Set(turns.map(x=>x.intent))],risk:urgent?'紧急':turns.some(x=>x.risk==='需医生')?'需医生':'普通',needsHuman:pending,actions:urgent?['立即人工确认接诊能力并联系来电人']:pending?(actions.length?actions:['前台核实诉求并联系来电人']):['确认回复是否解决问题'],turnCount:questions.length,sourceCount:new Set(turns.flatMap(x=>x.sources.map(k=>k.id+'@'+k.version))).size,generatedAt:stamp()};return c}
 function save(c){db.prepare('INSERT OR REPLACE INTO calls VALUES(?,?,?,?,?)').run(c.id,c.tenant,c.branch,c.expiresAt,JSON.stringify(c));return c}
 function create(t,b,now=stamp()){return {id:crypto.randomUUID(),tenant:t,branch:b.branch,caller:String(b.caller||'访客来电').trim().slice(0,60),phone:String(b.phone||'13800000000').slice(0,20),createdAt:now,expiresAt:expiresAfterThreeMonths(now),status:'接待中',reviewed:false,turns:[],summary:{title:'新来电',customer:'等待来电人提问',response:'尚未回复',intents:[],risk:'普通',needsHuman:false,actions:[],turnCount:0,sourceCount:0},followup:[],demo:true,engine:'知识库规则演示',channel:'模拟电话 · 文字转写'};}
 function syncDraft(c){const pets=all('pet',c.tenant).filter(p=>p.branch===c.branch);const doctors=[...new Set(['林医生','陈医生','张医生',...all('employee',c.tenant).filter(e=>e.role==='医生'&&e.active).map(e=>e.name)])];c.bookingDraft=buildDraft(c,pets,all('service',c.tenant),doctors);if(c.bookingDraft?.status==='待前台确认'){c.summary.needsHuman=true;if(c.status==='接待完成')c.status='待人工跟进';if(!c.summary.actions.includes('核对代填预约草稿并人工确认'))c.summary.actions.push('核对代填预约草稿并人工确认')}return c}
 function append(c,question){
  const at=stamp();c.turns.push({id:crypto.randomUUID(),role:'caller',text:question,at});
  const base=reply(c.tenant,c,question),pets=all('pet',c.tenant).filter(p=>p.branch===c.branch);const r=reception.update(c,question,pets);
  if(r.service&&!r.cancelled&&!r.fields.petId&&r.fields.owner&&r.fields.petName&&r.fields.species&&!(r.matchCount>1&&!r.forceNew)&&base.risk!=='紧急'){const pet=createProfile(c,r.fields);r.fields.petId=pet.id;r.petLoaded=pet.id;r.registration={petId:pet.id,ownerId:pet.ownerId,at:stamp()};r.profileStatus='已自动建档，待前台核对';r.evidence.petId={kind:'电话逐步登记后自动建档',excerpt:'宠主、宠物种类及名字均来自本次来电'}}
  if(r.fields.petId)updateProfile(c,r);
  c.turns.push({id:crypto.randomUUID(),role:'assistant',text:base.answer,at,...base});summarize(c);syncDraft(c);
  const last=c.turns.at(-1);const planned=reception.response(c,last);Object.assign(last,planned);
  if(!last.responsePlan){const key=({'急症分流':'urgent','医疗问题':'medical','待核实问题':'unknown','人工跟进':'handoff','一般接待':/谢谢|了解了/.test(question)?'thanks':'greeting','疫苗预约':'age'})[last.intent];if(key){last.text=reception.phrases[key][0];last.responsePlan={key,candidates:reception.phrases[key]}}}
  if(!last.responsePlan){let line;if(last.intent==='门店信息'){line=last.sources.find(x=>x.code==='hours')?.content.replace('演示医院','我们')||'营业信息我请前台核实一下，再给您答复。';if(line.length>100)line='营业信息我请前台核实一下，再给您答复。'}if(last.intent==='价格与时长'){const facts=last.sources.filter(x=>x.kind==='业务数据快照');if(facts.length>2)line='您想了解哪个项目的费用呢？';else if(r.service==='groom')line='基础洗护参考价'+(facts[0]?.priceCents/100)+'元，具体内容、费用和耗时到店看过再确认。';else line=facts.map(x=>x.title.replace(' · 统一服务目录','')+'参考价'+x.priceCents/100+'元').join('，')+'，实际费用到店确认。'}if(last.intent==='会员咨询')line='我先帮您记录，前台核对账户后会联系您。';if(last.intent==='投诉争议')line='让您有不好的体验了，我帮您记下。具体是哪方面的问题呢？';if(last.intent==='诊后回访')line='我请原来的医生回访您。现在主要有什么变化呢？';if(line){last.text=line;last.responsePlan={key:'service',candidates:[line]}}}
  if(r.service){const codes=['reception','profile-intake','profile-clinical',r.service==='groom'?'groom-intake':'vaccine-intake'];if(r.service==='vaccine')codes.push('vaccine-health');for(const code of codes){const k=kb(c.tenant).find(x=>x.code===code);if(k&&!last.sources.some(x=>x.id===k.id))last.sources.push(snapshot(k))}}
  summarize(c);syncDraft(c);if(r.fields.owner)c.summary.owner=r.fields.owner;if(r.fields.petName)c.summary.petName=r.fields.petName;
  if(r.service){c.summary.profileStatus=r.profileStatus;c.summary.collected={...r.fields};c.summary.nextQuestion=last.text.includes('？')?last.text:'';c.summary.title=r.service==='groom'?'美容到店预约':r.service==='vaccine'?'疫苗咨询与预约':'预约信息采集';if(r.healthConcern)c.summary.actions=['请医生先评估客户反馈的不适，再决定是否接种'];}
  return c;
 }
 // 初始化一次，不会在到期清除后重新生成过期案例。
 for(const t of ['demo','sandbox'])if(!db.prepare('SELECT 1 FROM meta WHERE key=?').get(t+'-cases-v1')){for(let n=0;n<scenarios.length;n++){const scenario=scenarios[n];const c=create(t,{...scenario,phone:'1380000'+String(2000+n)},new Date(Date.now()-(n*2+1)*3600000).toISOString());c.scenario=scenario.name;scenario.questions.forEach(q=>append(c,q));c.status=c.summary.needsHuman?'待人工跟进':'接待完成';save(c)}db.prepare('INSERT INTO meta VALUES(?,?)').run(t+'-cases-v1',stamp())}
 async function enhance(c){const turn=c.turns[c.turns.length-1];const generated=await ai.generate(c,turn);turn.text=generated.text;turn.sources=generated.sources;turn.provider=generated.provider;if(generated.provider.mode==='ai'){turn.result=turn.result||'已简短回复客户';const extra={owner:c.summary.owner,petName:c.summary.petName,profileStatus:c.summary.profileStatus,collected:c.summary.collected,nextQuestion:c.summary.nextQuestion,title:c.summary.title};summarize(c);Object.assign(c.summary,extra);if(c.bookingDraft?.status==='待前台确认')c.summary.actions.push('核对代填预约草稿并人工确认')}turn.engine=generated.provider.mode==='ai'?'AI短句接待 · 依据校验':'知识库规则兜底';}
 const authorize=s=>allowed(s,['院长','前台']);
 // 为旧通话补充代填草稿，不改写原交流或历史来源。
 for(const row of db.prepare('SELECT body FROM calls WHERE expires>?').all(stamp())){const c=JSON.parse(row.body);if(!c.bookingDraft){syncDraft(c);if(c.bookingDraft)save(c)}}
 // 仅补充风险复核，不改写历史询问、回复和依据快照。
 for(const row of db.prepare('SELECT body FROM calls WHERE expires>?').all(stamp())){const c=JSON.parse(row.body);if(c.summary.risk!=='紧急'&&c.turns.some(t=>t.role==='caller'&&urgentPattern.test(t.text))){c.summary.risk='紧急';c.summary.needsHuman=true;c.summary.title='急症描述复核，优先人工接管';c.summary.actions=['立即人工确认接诊能力并联系来电人'];if(c.status!=='接待中')c.status='待人工跟进';c.followup.push({at:stamp(),actor:'系统复核',status:'待人工跟进',note:'规则升级复核：历史询问含急症描述，原始交流保留，请人工优先处理。'});save(c)}}
 function get(s,id){purge();const row=db.prepare('SELECT body FROM calls WHERE id=? AND tenant=? AND expires>?').get(id,s.tenant,stamp());check(row,'通话不存在或已超过三个月保留期',404);const c=JSON.parse(row.body);branchCheck(s,c.branch);return c}
 const busy=new Set();
 async function handle(route,b,s,u){if(!route.startsWith('/api/calls'))return undefined;authorize(s);purge();if(b.id&&busy.has(b.id))check(false,'正在生成回复，请稍后再操作',409);
  if(route==='/api/calls/ai/status')return ai.status();
  if(route==='/api/calls'){
   const branch=u.searchParams.get('branch')||'all';if(branch!=='all')branchCheck(s,branch);const q=(u.searchParams.get('q')||'').toLowerCase();const status=u.searchParams.get('status');
   const rows=db.prepare('SELECT body FROM calls WHERE tenant=? AND expires>? ORDER BY expires DESC').all(s.tenant,stamp()).map(r=>JSON.parse(r.body)).filter(c=>s.branches.includes(c.branch)&&(branch==='all'||c.branch===branch));
   const calls=rows.filter(c=>(!status||c.status===status)&&(!q||[c.caller,c.summary.customer,c.summary.title,c.summary.response].join(' ').toLowerCase().includes(q))).map(c=>{const {turns,followup,phone,tenant,bookingDraft,reception,...r}=c;return {...r,bookingDraft:bookingDraft?{status:bookingDraft.status}:null,phone:phone.replace(/^(\d{3})\d+(\d{4})$/,'$1****$2'),followupCount:followup.length}});
   return {calls,bookingOptions:{pets:all('pet',s.tenant).filter(p=>s.branches.includes(p.branch)).map(p=>({id:p.id,name:p.name,owner:p.owner,phone:p.phone,branch:p.branch})),services:all('service',s.tenant),doctors:[...new Set(['林医生','陈医生','张医生',...all('employee',s.tenant).filter(e=>e.role==='医生'&&e.active).map(e=>e.name)])]},stats:{total:rows.length,urgent:rows.filter(c=>c.summary.risk==='紧急'&&c.status!=='已处理').length,pending:rows.filter(c=>c.status==='待人工跟进').length,unread:rows.filter(c=>!c.reviewed).length},scenarios:scenarios.map(({questions,...x})=>({...x,questions})),retention:{months:3,anchor:'来电创建时间',cleanup:'启动、每分钟及访问时清理到期记录'},knowledge:kb(s.tenant),ai:ai.status(),engine:'真实电话、语音识别与录音未接入；AI状态以每条回复的生成方式为准'};
  }
  if(route==='/api/calls/detail')return get(s,u.searchParams.get('id'));
  if(route==='/api/calls/start'){
   branchCheck(s,b.branch);check(typeof b.caller==='string'&&b.caller.trim(),'请填写来电人');check(/^1\d{10}$/.test(String(b.phone||'')),'电话需为11位手机号码');let c=create(s.tenant,b);const scenario=scenarios.find(x=>x.id===b.scenario);if(scenario){c.scenario=scenario.name;scenario.questions.forEach(q=>append(c,q));c.status=c.summary.needsHuman?'待人工跟进':'接待完成'}else if(b.question){check(typeof b.question==='string'&&b.question.length<=2000,'首句不超过2000字');append(c,b.question)}if(b.question&&!scenario)await enhance(c);if(!c.turns.length){c.turns.push({id:crypto.randomUUID(),role:'assistant',text:'您好，宠物医院前台。有什么可以帮您？',at:stamp(),intent:'来电接待',result:'已接听模拟来电，等待客户提供信息',needsHuman:false,risk:'普通',sources:[snapshot(kb(c.tenant).find(k=>k.code==='booking'))],engine:'固定接待语'});summarize(c)}return save(c);
  }
  if(route==='/api/calls/message'){
   const c=get(s,b.id);check(c.status==='接待中','通话已结束，请发起新的模拟来电',409);check(typeof b.text==='string'&&b.text.trim()&&b.text.length<=2000,'内容须为1～2000字');check(c.turns.length<120,'单通演示最多60轮');append(c,b.text.trim());busy.add(c.id);try{await enhance(c);check(new Date(c.expiresAt).getTime()>Date.now(),'通话保留期已到，无法保存新回复',404);return save(c)}finally{busy.delete(c.id)}
  }
  if(route==='/api/calls/end'){const c=get(s,b.id);check(c.status==='接待中','通话已结束',409);c.endedAt=stamp();c.status=c.summary.needsHuman?'待人工跟进':'接待完成';return save(c)}
  if(route==='/api/calls/booking/save'||route==='/api/calls/booking/confirm'){
   const c=get(s,b.id),draft=c.bookingDraft;check(draft,'此来电没有预约意向草稿',404);if(draft.status==='已确认')return c;
   check(c.status!=='接待中','请先结束来电，再由前台核对预约',409);check(draft.status==='待前台确认','预约意向已取消',409);check(Number(b.revision)===draft.revision,'草稿已更新，请刷新后重新核对',409);check(b.fields&&typeof b.fields==='object','预约信息缺失');
   const fields={...draft.fields};for(const key of ['caller','phone','petName','petId','date','time','period','doctor','serviceId','duration','reason'])if(Object.hasOwn(b.fields,key)){check(['string','number'].includes(typeof b.fields[key]),'字段格式错误');fields[key]=String(b.fields[key]).trim().slice(0,key==='reason'?100:80)}
   // 接听门店固定，防止客户端通过草稿改变门店范围。
   fields.branch=c.branch;check(/^1\d{10}$/.test(fields.phone),'联系方式须为11位手机号');
   if(route.endsWith('/confirm')){check(b.identityVerified===true,'请先核对宠物档案、宠主和联系方式');check(c.summary.risk!=='紧急','急症来电应先人工联系，不从草稿创建常规预约',409);check(fields.petId,'请选择已核验的宠物档案；未建档客户请先建档');check(fields.date&&fields.time&&fields.doctor&&fields.serviceId&&fields.reason,'请补全日期、具体时间、医生、服务及事项');const pet=all('pet',s.tenant).find(p=>p.id===fields.petId);check(pet&&s.branches.includes(pet.branch),'无权使用该宠物档案',403);const key=crypto.createHash('sha256').update(s.tenant+':call-booking:'+c.id).digest('hex');const a=createAppointment(s,{petId:fields.petId,branch:c.branch,date:fields.date,time:fields.time,doctor:fields.doctor,serviceId:fields.serviceId,duration:Number(fields.duration),reason:fields.reason},key);if(pet.intakeStatus==='待前台核对'&&!pet.intakeReview){pet.intakeStatus='已核对';pet.verifiedAt=stamp();put('pet',s.tenant,pet.branch,pet);const owner=all('owner',s.tenant).find(o=>o.id===pet.ownerId);if(owner){owner.intakeStatus='已核对';owner.verifiedAt=stamp();put('owner',s.tenant,owner.branch,owner)}}fields.petName=pet.name;draft.status='已确认';draft.appointmentId=a.id;draft.confirmedBy=s.name||s.role;draft.confirmedAt=stamp();draft.confirmation={petName:pet.name,date:a.date,time:a.time,endTime:a.endTime,doctor:a.doctor,serviceId:a.serviceId};c.summary.response+='；前台已人工确认正式预约 '+a.date+' '+a.time;c.summary.actions=c.summary.actions.filter(x=>!x.includes('预约'));c.followup.push({id:crypto.randomUUID(),at:stamp(),actor:s.name||s.role,note:'人工核对身份并确认预约：'+a.date+' '+a.time+' '+a.doctor,status:c.status});}
   for(const key of Object.keys(fields))if(fields[key]!==draft.fields[key])draft.evidence[key]={kind:'前台人工修改',actor:s.name||s.role,excerpt:'人工核对后录入'};
   draft.fields=fields;draft.revision++;draft.editedBy=s.name||s.role;draft.editedAt=stamp();c.reviewed=true;return save(c);
  }
  if(route==='/api/calls/review'){const c=get(s,b.id);c.reviewed=true;return save(c)}
  if(route==='/api/calls/followup'){const c=get(s,b.id);check(typeof b.note==='string'&&b.note.trim()&&b.note.length<=1000,'跟进备注须为1～1000字');check(['待人工跟进','已处理'].includes(b.status),'跟进状态无效');check(c.status!=='接待中','请先结束通话',409);c.followup.push({id:crypto.randomUUID(),at:stamp(),actor:s.name||s.role,note:b.note.trim(),status:b.status});c.status=b.status;c.reviewed=true;return save(c)}
  if(route==='/api/calls/knowledge'){
   allowed(s,['院长']);check(branches.every(x=>s.branches.includes(x.id)),'全院知识配置需要全部门店权限',403);const k=kb(s.tenant).find(x=>x.id===b.id);check(k,'知识不存在',404);check(k.code!=='urgent','急症规则为演示安全基线，不开放编辑');check(typeof b.content==='string'&&b.content.trim()&&b.content.length<=2000,'知识正文须为1～2000字');k.content=b.content.trim();k.version=String(Number(k.version)+1);k.updatedAt=stamp();put('callKnowledge',s.tenant,'all',k);return k;
  }
  check(false,'电话接口不存在',404);
 }
 return {handle,purge,close(){clearInterval(timer);db.close()}};
};
module.exports.expiresAfterThreeMonths=expiresAfterThreeMonths;
