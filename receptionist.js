const profile=require('./pet-profile');
// 电话接待状态机：一次只追问一个缺项；档案与预约变更由服务端完成。
const phrases={
 breed:['它是什么品种呀？'],
 color:['它的毛色是什么样的呀？'],
 weight:['它现在大概多重？公斤或斤都可以。'],
 sex:['它是小男生还是小女生呀？'],
 neutered:['做过绝育了吗？'],
 dewormHistory:['最近一次驱虫是什么时候呀？'],
 allergies:['有没有已知的药物或食物过敏呀？'],
 medicalHistory:['以前生过什么病，或者做过手术吗？'],
 medications:['现在有在吃药吗？'],
 diet:['平时主要吃什么呀？'],
 temperament:['它会怕生或抗拒触碰吗？'],
 greeting:['您好，宠物医院前台。有什么可以帮您？'],
 age:['我先帮您了解一下。猫咪现在多大啦？','好，我先了解一下。猫咪现在多大啦？'],
 petAge:['我先了解一下。小家伙现在多大啦？'],
 health:['它最近精神和食欲怎么样？','了解了。它最近精神和食欲怎么样？'],
 history:['之前打过疫苗吗？','好，再确认一下，之前打过疫苗吗？'],
 owner:['我帮您登记一下，怎么称呼您？','这个号码还没有档案，怎么称呼您？'],
 petName:['小家伙叫什么名字呀？','好，小家伙叫什么名字呀？'],
 species:['养的是猫咪还是狗狗呀？'],
 choose:['这个号码有几只宠物，今天是给哪一只预约呀？'],
 date:['您想哪天带它过来呢？','好，您想哪天带它过来呢？'],
 time:['那天大概几点方便到店呢？','那天上午还是下午方便呢？'],
 knownGroom:['档案找到了，不用重新登记。您想哪天带它过来呢？'],
 groomTime:['美容内容和需要多久，到店看过再确认。您想哪天带它过来呢？'],
 groomDone:['好，先帮您登记到店意向，前台确认后联系您。美容内容和需要多久，到店再定。'],
 vaccineDone:['好，先帮您登记，前台确认后联系您。能不能接种，到店请医生看一下。'],
 done:['好，先帮您登记，前台确认后联系您。'],
 sick:['先别急着安排打针，建议让医生看看。我帮您备注这个情况，方便医生联系您。'],
 cancel:['好的，这次预约意向取消了。需要的时候再联系我们。'],
 handoff:['好，我记下了，请前台同事联系您。'],
 unknown:['这个我得请同事核实一下，再给您准确答复。'],
 thanks:['不客气，有需要随时联系我们。'],
 urgent:['这种情况请尽快联系宠物急诊。我也会提醒前台优先处理。'],
 medical:['这个需要医生判断，我先帮您记录，请医生联系您。'],
 changedPet:['好，是另一只小家伙。它叫什么名字呀？'],
 noAge:['没关系，年龄先记为待确认。它最近精神和食欲怎么样？']
};
function number(s){if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);const n={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};if(s.includes('十')&&s!=='十'){const [a,b]=s.split('十');return (n[a]||1)*10+(n[b]||0)}return n[s]}
function age(q){if(/半岁/.test(q))return {ageText:'半岁',ageMonths:6};const m=q.match(/([一二两三四五六七八九十\d.]+)\s*(个月|月龄|月大|岁|周|天)(?:大|了)?/);if(!m)return;const v=number(m[1]);if(!Number.isFinite(v)||v<0||v>120)return;return {ageText:m[0],ageMonths:m[2]==='岁'?v*12:/周/.test(m[2])?v*7/30:/天/.test(m[2])?v/30:v}}
function simpleName(q){const clean=q.trim().replace(/[。！!，,呀啊呢啦了]+$/g,'');return /^[\u4e00-\u9fa5a-zA-Z·]{1,16}$/.test(clean)&&!/[吗？?]|不知道|随便|不用|取消|预约|疫苗|美容|明天|后天|不是|怎么|价格|多少钱|谢谢/.test(clean)?clean:''}
function update(c,q,pets){
 const r=c.reception||(c.reception={version:1,fields:{},evidence:{},expected:'',service:''});const f=r.fields;
 const turnId=c.turns.at(-1)?.id;const set=(k,v,kind='来电原话')=>{f[k]=v;r.evidence[k]={kind,turnId,excerpt:q}};
 const found=q.match(/(?:改用|联系号码是|手机号是|电话是)\s*(1\d{10})/);if(found){c.phone=found[1];r.phoneChanged=true;for(const key of Object.keys(f))delete f[key];delete r.lookupDone;r.answered={};r.forceNew=false;r.petLoaded='';r.expected='';r.registration=null;}
 if(!r.lookupDone){r.matches=pets.filter(p=>p.phone===c.phone).map(p=>p.id);r.lookupDone=true;r.matchCount=r.matches.length;if(r.matches.length===1)f.petId=r.matches[0];}
 if(/不是.*(?:这只|团子|可乐|糯米)|另一只|新养的|新来的/.test(q)){for(const k of [...Object.keys(profile.labels),'petId','petName','ageMonths','health','birthday','weightStatus'])delete f[k];r.answered={};r.petLoaded='';r.forceNew=true;r.registration=null;}
 const matches=pets.filter(p=>(r.matches||[]).includes(p.id));const named=matches.filter(p=>q.includes(p.name));if(named.length===1&&!r.forceNew)f.petId=named[0].id;
 const pet=pets.find(p=>p.id===f.petId);
 if(pet&&r.petLoaded!==pet.id){for(const k of Object.keys(profile.labels)){if(!profile.unknown(pet[k])&&(k!=='weight'||pet.weight>0)&&!f[k]){f[k]=pet[k];r.evidence[k]={kind:'来电号码匹配现有档案',excerpt:'档案 '+pet.id}}}}
 if(pet){for(const [k,v] of Object.entries({petName:pet.name,owner:pet.owner,species:pet.species,breed:pet.breed})){if((!f[k]||r.petLoaded!==pet.id)&&!profile.unknown(v)){f[k]=v;r.evidence[k]={kind:'来电号码匹配现有档案',excerpt:'档案 '+pet.id}}}if(r.petLoaded!==pet.id){if(!pet.birthday&&pet.ageText){f.ageText=pet.ageText;f.ageMonths=pet.ageMonths;r.evidence.ageText={kind:'已有档案口述年龄',excerpt:pet.ageText}}if(pet.birthday){const months=Math.floor((new Date(c.createdAt)-new Date(pet.birthday))/(86400000*30.4375));if(months>=0){f.ageMonths=months;f.ageText=months>=12?Math.floor(months/12)+'岁'+(months%12?months%12+'个月':''):months+'个月';r.evidence.ageText={kind:'档案出生日期换算',excerpt:pet.birthday}}}r.petLoaded=pet.id}r.profileStatus=pet.intakeStatus==='待前台核对'?'已自动建档，待前台核对':'已匹配现有档案'}
 if(/猫|喵/.test(q))set('species','猫');else if(/狗|犬/.test(q))set('species','犬');
 if((!r.service||/想.*(?:预约|打疫苗|美容|洗澡)|改约|换成/.test(q))&&/疫苗|接种|打针/.test(q))r.service='vaccine';else if((!r.service||/想.*(?:预约|美容|洗澡)|改约|换成/.test(q))&&/美容|洗护|洗澡|剪毛/.test(q))r.service='groom';else if(/体检|门诊|检查/.test(q)&&!r.service)r.service='consult';
 if(/不预约了|取消预约|不用预约|不需要预约/.test(q))r.cancelled=true;else if(/想.*(?:预约|打疫苗|美容|洗澡)|帮.*预约|重新预约/.test(q))r.cancelled=false;
 const a=age(q);if(a){set('ageText',a.ageText);set('ageMonths',a.ageMonths)}else if(r.expected==='age'&&/不知道|不清楚|不确定/.test(q))set('ageText','待确认');
 const healthAsked=r.expected==='health';if(healthAsked&&/精神|食欲|吃|喝|正常|挺好|都好|活泼|生病|发烧|没有|不清楚|不知道|呕吐|拉稀|便|咳嗽|不舒服|健康|一般|好着/.test(q)||/精神|食欲|呕吐|拉稀|腹泻|生病|发烧|咳嗽/.test(q)){if(!/多少钱|预约|哪天|几点/.test(q)){set('health',q.slice(0,100));const negativesRemoved=q.replace(/没有(?:呕吐|拉稀|腹泻|发烧|咳嗽)|不吐|没吐|不拉稀|没有生病/g,'');r.healthConcern=/(呕吐|拉稀|腹泻|发烧|咳嗽|没精神|不吃|生病|不太好|不舒服|吃药|服药|治疗)/.test(negativesRemoved)}}
 if(r.expected==='history'&&/打过|接种|第一次|第一针|针|不知道|不清楚|不记得|上次|还没|从没|去年|上个月|有的|没有/.test(q)&&!/[？?]|多少钱|哪天|几点/.test(q)||/没打过|没接种过|打过.*(?:针|疫苗)|接种过|疫苗本/.test(q))set('vaccineHistory',q.slice(0,100));
 let owner=q.match(/(?:我叫|叫我|称呼我|我姓|姓)([\u4e00-\u9fa5a-zA-Z]{1,12}?)(?=[，。！!\s]|$)/)?.[1];if(!owner&&r.expected==='owner')owner=simpleName(q);if(owner)set('owner',owner);
 let name=q.match(/(?:宠物叫|名字叫|猫咪叫|狗狗叫|猫叫|狗叫|它叫|叫做)([\u4e00-\u9fa5a-zA-Z]{1,12}?)(?=[，。！!\s]|$)/)?.[1];if(!name&&r.expected==='petName')name=simpleName(q.split(/[，,。]/)[0].replace(/^(?:叫|是)/,''));if(name&&f.petId&&name!==f.petName){for(const k of [...Object.keys(profile.labels),'petId','petName','ageMonths','health','birthday','weightStatus'])delete f[k];r.answered={};r.petLoaded='';r.forceNew=true;r.registration=null;if(a){f.ageText=a.ageText;f.ageMonths=a.ageMonths}}if(name&&!f.petId)set('petName',name);

 const expected=r.expected;r.answered||={};
 const unknownAnswer=/^(?:这个)?(?:不知道|不清楚|不确定|不记得|没称过|忘了|到店再说|暂时不说)[呀啊了。！!]*$/.test(q.trim());
 const interrupted=/[？?]|多少钱|想预约|转人工|取消预约|明天|后天|周末/.test(q);
 if(expected in profile.labels&&!interrupted){
  if(unknownAnswer){set(expected,expected==='weight'?null:'待核实');if(expected==='weight')set('weightStatus','待核实');r.answered[expected]=true}
  else if(expected==='weight'){const m=q.match(/([一二两三四五六七八九十\d.]+)\s*(公斤|千克|kg|斤)/i);if(m){const w=number(m[1])*(m[2]==='斤'?0.5:1);if(Number.isFinite(w)&&w>0&&w<200){set('weight',Math.round(w*100)/100);set('weightStatus','口述，待称重');r.answered.weight=true}}}
  else if(expected==='sex'){if(/女生|女孩|母/.test(q)){set('sex','母');r.answered.sex=true}else if(/男生|男孩|公/.test(q)){set('sex','公');r.answered.sex=true}}
  else if(expected==='neutered'){if(/没有|没做|还没|未绝育/.test(q)){set('neutered','未绝育');r.answered.neutered=true}else if(/做过|做了|已绝育|绝育了/.test(q)){set('neutered','已绝育');r.answered.neutered=true}}
  else if(!['ageText','vaccineHistory'].includes(expected)&&q.trim().length<=300&&!/^(好的|谢谢|嗯|好)$/.test(q.trim())){set(expected,q.trim());r.answered[expected]=true}
 }
 if(expected==='age'&&unknownAnswer){set('ageText','待核实');r.answered.ageText=true}
 if(expected==='history'&&unknownAnswer){set('vaccineHistory','待核实');r.answered.vaccineHistory=true}
 if(!pet)r.profileStatus='新客信息采集中';return r;
}
function response(c,base){const r=c.reception;if(!r?.service)return base;const f=r.fields;if(base.intent==='价格与时长')return base;let key,expected='';
 if(c.summary.risk==='紧急')key='urgent';else if(base.risk==='需医生'&&base.intent==='医疗问题')key='medical';else if(r.cancelled)key='cancel';else if(/人工跟进|投诉争议|会员咨询/.test(base.intent))return base;
 else if(r.matchCount>1&&!f.petId&&!r.forceNew){key='choose';expected='choose'}
 else if(r.service==='vaccine'&&!f.ageText){key=f.species==='犬'?'petAge':'age';expected='age'}
 else if(r.service==='vaccine'&&!f.health){key='health';expected='health'}
 else if(r.service==='vaccine'&&r.healthConcern)key='sick';
 else if(r.service==='vaccine'&&!f.vaccineHistory){key='history';expected='history'}
 else if(!f.owner){key='owner';expected='owner'}
 else if(!f.petName){key='petName';expected='petName'}
 else if(!f.species){key='species';expected='species'}
 else if(profile.intakeKeys.some(k=>!r.answered?.[k]&&(k==='weight'?!(f.weight>0):profile.unknown(f[k])))){const k=profile.intakeKeys.find(k=>!r.answered?.[k]&&(k==='weight'?!(f.weight>0):profile.unknown(f[k])));key=k==='ageText'?'petAge':k==='vaccineHistory'?'history':k;expected=k==='ageText'?'age':k==='vaccineHistory'?'history':k}
 else if(!c.bookingDraft?.fields.date){key=r.service==='groom'?(f.petId&&r.matchCount>0&&!r.registration&&!r.dateAsked?'knownGroom':'groomTime'):'date';expected='date';r.dateAsked=true}
 else if(!c.bookingDraft.fields.time&&!c.bookingDraft.fields.period){key='time';expected='time'}
 else key=r.service==='groom'?'groomDone':r.service==='vaccine'?'vaccineDone':'done';
 r.expected=expected;r.stage=key;r.complete=['groomDone','vaccineDone','done'].includes(key);const candidates=phrases[key];return {...base,text:candidates[0],answer:candidates[0],intent:r.service==='vaccine'?'疫苗预约':r.service==='groom'?'美容预约':'预约意向',risk:key==='urgent'?'紧急':key==='sick'?'需医生':base.risk,needsHuman:true,result:r.complete?'预约资料已收集，待前台确认':key==='cancel'?'已取消预约意向':key==='sick'?'已记录不适，交医生先评估':'正在补充'+({age:'年龄',health:'近期状态',history:'接种经历',owner:'宠主称呼',petName:'宠物名字',species:'宠物种类',date:'到店日期',time:'到店时段',choose:'本次服务宠物'}[expected]||profile.labels[expected]||'接待信息'),responsePlan:{key,candidates}};
}
module.exports={update,response,phrases,age};
