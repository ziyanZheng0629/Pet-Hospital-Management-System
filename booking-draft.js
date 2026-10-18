// 从来电原话代填；不推测未明确给出的医生和时间，不创建正式预约。
function calendarDate(at){const d=new Date(new Date(at).getTime()+8*3600000);return d.toISOString().slice(0,10)}
function shifted(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function chineseNumber(s){if(/^\d+$/.test(s))return Number(s);const n={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};if(s==='十')return 10;if(s.includes('十')){const [a,b]=s.split('十');return (a?n[a]:1)*10+(b?n[b]:0)}return n[s]}
module.exports=function buildDraft(c,pets,services,doctors){
 if(c.bookingDraft?.status==='已确认'||c.bookingDraft?.editedBy)return c.bookingDraft;
 const turns=c.turns.filter(t=>t.role==='caller');if(!c.reception?.service&&!turns.some(t=>/预约|挂号|登记.*(体检|洗护|疫苗|检查)/.test(t.text)))return c.bookingDraft;
 const fields={branch:c.branch,caller:c.caller,phone:c.phone,petName:'',petId:'',date:'',time:'',period:'',doctor:'',serviceId:'',duration:'',reason:''};
 const evidence={branch:{kind:'来电元数据',excerpt:'接听门店'},caller:{kind:'来电元数据',excerpt:'来电人填写信息'},phone:{kind:'来电元数据',excerpt:'来电号码'}};let cancelled=false;
 const rf=c.reception?.fields;if(rf){for(const k of ['petId','petName','owner'])if(rf[k]){const dest=k==='owner'?'caller':k;fields[dest]=rf[k];evidence[dest]=c.reception.evidence[k]||{kind:'来电号码匹配档案',excerpt:'服务端档案匹配'}}if(c.reception.service){fields.serviceId=c.reception.service;const svc=services.find(x=>x.code===fields.serviceId);fields.duration=fields.serviceId==='groom'?'':svc?.duration||'';fields.reason=fields.serviceId==='groom'?'美容到店意向（内容与实际耗时到店确认）':svc?.name+'预约';}}
 const base=calendarDate(c.createdAt);const set=(key,value,t,kind='来电原话')=>{fields[key]=value;evidence[key]={kind,turnId:t.id,excerpt:t.text}};
 for(const t of turns){const q=t.text;if(/不预约了|取消预约|不用预约|不需要预约/.test(q)){cancelled=true;continue}if(/预约|挂号/.test(q))cancelled=false;
  const named=pets.filter(p=>q.includes(p.name)&&(!c.reception||p.phone===c.phone));if(named.length===1){set('petName',named[0].name,t);set('petId',named[0].id,t,'宠物名称匹配，需人工核验')}else{const match=q.match(/(?:宠物叫|名字叫|猫叫|狗叫)[“"\s]*([\u4e00-\u9fa5a-zA-Z]{1,10})/);if(match){set('petName',match[1],t);set('petId','',t,'未匹配档案，须先建档或选择现有宠物')}}
  const explicit=q.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/);const month=q.match(/(?:^|[^\d])(\d{1,2})月(\d{1,2})日?/);if(explicit)set('date',`${explicit[1]}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`,t);else if(month)set('date',base.slice(0,4)+'-'+month[1].padStart(2,'0')+'-'+month[2].padStart(2,'0'),t);else if(q.includes('后天'))set('date',shifted(base,2),t);else if(q.includes('明天'))set('date',shifted(base,1),t);else if(q.includes('今天'))set('date',base,t);else{const week=q.match(/(下周|本周|这周|周|星期)([一二三四五六日天])/);if(week){const target='日一二三四五六'.indexOf(week[2]==='天'?'日':week[2]);const dow=new Date(base+'T00:00:00Z').getUTCDay();const offset=week[1]==='下周'?7-((dow+6)%7)+(target+6)%7:(target-dow+7)%7;set('date',shifted(base,offset),t)}}
  const period=q.match(/上午|中午|下午|晚上|早上/);if(period)set('period',period[0],t);
  const clock=q.match(/(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/);const spoken=q.match(/(早上|上午|中午|下午|晚上)?\s*([零一二两三四五六七八九十\d]{1,3})[点时](?:(半)|([零一二三四五六七八九十\d]{1,3})分?)?/);
  if(clock){let h=Number(clock[1]);if(['下午','晚上','中午'].includes(period?.[0])&&h<12)h+=12;set('time',String(h).padStart(2,'0')+':'+clock[2],t)}else if(spoken){let h=chineseNumber(spoken[2]);const p=spoken[1]||period?.[0]||fields.period;if(['下午','晚上','中午'].includes(p)&&h<12)h+=12;const m=spoken[3]?30:spoken[4]?chineseNumber(spoken[4]):0;if((p||h>12||h===0)&&Number.isInteger(h)&&h>=0&&h<24&&Number.isInteger(m)&&m>=0&&m<60)set('time',String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'),t)}else if(period&&fields.time){set('time','',t,'客户改述为时间段，具体时刻待核实')}
  for(const doctor of doctors)if(q.includes(doctor))set('doctor',doctor,t);
  const patterns={groom:/洗护|美容/,vaccine:/疫苗|接种/,ultrasound:/超声|B超/,blood:/血常规/,consult:/体检|门诊|诊查|检查/};const found=Object.keys(patterns).find(code=>patterns[code].test(q));if(found&&(!fields.serviceId||/预约|挂号|改成|换成/.test(q))){const service=services.find(s=>(s.code||s.id)===found);if(service){set('serviceId',found,t);set('duration',service.duration,t,'统一服务目录标准时长');set('reason',service.name+'预约',t)}}
 }
 if(c.reception?.fields.petId){fields.petId=c.reception.fields.petId;fields.petName=c.reception.fields.petName;evidence.petId={kind:'来电号码匹配档案',excerpt:'手机号匹配，最后由前台核对'}}
 if(c.reception?.service==='groom'){fields.duration='';fields.reason='美容到店意向（内容与实际耗时到店确认）'}
 if(!fields.reason)fields.reason='电话预约（项目待前台核实）';
 return {status:cancelled?'已取消':'待前台确认',fields,evidence,durationPending:c.reception?.service==='groom',revision:(c.bookingDraft?.revision||0)+1,generatedAt:new Date().toISOString(),note:'名称匹配不等于身份核验；不明确的时间或医生留空。草稿不占用医生时段。'};
};
