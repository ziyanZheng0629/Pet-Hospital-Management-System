// 电话口述与正式档案共用字段；未知不等于“无”。
const labels={breed:'品种',color:'毛色',weight:'体重',sex:'性别',neutered:'绝育情况',ageText:'年龄',vaccineHistory:'疫苗记录',dewormHistory:'驱虫记录',allergies:'过敏史',medicalHistory:'既往病史',medications:'当前用药',diet:'日常饮食',temperament:'性格及操作注意事项'};
const unknown=v=>v==null||v===''||/^(未知|待补充|待确认|待核实)$/.test(String(v));
const missing=p=>Object.keys(labels).filter(k=>k==='ageText'?(!p.birthday&&unknown(p.ageText)):k==='weight'?!(Number(p.weight)>0):unknown(p[k]));
function clean(b,check){const out={};for(const k of [...Object.keys(labels),'address','backupPhone','microchip','notes','birthday'])if(k in b&&k!=='weight')out[k]=String(b[k]??'').trim().slice(0,k==='notes'?1000:300);
 if('weight' in b){out.weight=b.weight===''||b.weight==null?null:Number(b.weight);check(out.weight===null||(Number.isFinite(out.weight)&&out.weight>0&&out.weight<200),'体重须大于 0 且小于 200 kg；不清楚请留空');out.weightStatus=out.weight===null?'待核实':'已记录'}
 if(out.sex)check(['公','母','未知','待核实'].includes(out.sex),'性别选项无效');
 if(out.neutered)check(['已绝育','未绝育','待核实'].includes(out.neutered),'绝育选项无效');
 if(out.birthday){const d=new Date(out.birthday+'T00:00:00Z');check(/^\d{4}-\d{2}-\d{2}$/.test(out.birthday)&&!isNaN(d)&&d.toISOString().slice(0,10)===out.birthday&&d<=new Date(),'请输入有效且不晚于今天的生日')}
 if(out.backupPhone)check(/^1\d{10}$/.test(out.backupPhone),'备用电话应为 11 位手机号');return out;
}
module.exports={labels,unknown,missing,clean,intakeKeys:['breed','color','weight','sex','allergies']};
