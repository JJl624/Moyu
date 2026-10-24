export const automaticSyncGap=30000;
export function retryAfterTime(value,now=Date.now()){
  if(typeof value!=='string'||!value.trim())return 0;
  const text=value.trim();
  if(/^\d+(?:\.\d+)?$/.test(text))return now+Math.max(1000,Math.ceil(Number(text)*1000));
  const date=Date.parse(text);return Number.isFinite(date)?Math.max(now+1000,date):0;
}
export function limitedError(status,retryAt){
  return Object.assign(Error((status===429?'WebDAV 请求过于频繁':'WebDAV 服务暂时不可用')+'，请在 '+new Date(retryAt).toLocaleTimeString('zh-CN',{hour12:false})+' 后重试。'),{status,code:'RATE_LIMITED',retryAt});
}
export class RequestBudget{
  constructor(spacing=100){this.spacing=spacing;this.minimum=spacing;this.next=0;this.retryAt=0;this.status=503;this.failures=0;this.healthy=0;}
  check(now=Date.now()){if(this.retryAt>now)throw limitedError(this.status,this.retryAt);}
  reserve(now=Date.now()){this.check(now);const at=Math.max(now,this.next);this.next=at+this.spacing;return at-now;}
  limited(status,value,now=Date.now()){
    this.status=status;this.failures++;this.healthy=0;this.spacing=Math.max(this.minimum,Math.min(5000,500*2**(this.failures-1)));this.retryAt=Math.max(this.retryAt,retryAfterTime(value,now)||now+Math.min(900000,60000*2**(this.failures-1)));
    return limitedError(status,this.retryAt);
  }
  success(){if(++this.healthy>=20){this.failures=0;this.spacing=Math.max(this.minimum,this.spacing/2);this.healthy=0;}}
}
const budgets=new Map();
export function requestBudget(url,username=''){
  const key=new URL(url).origin+'\n'+username;
  if(!budgets.has(key))budgets.set(key,new RequestBudget());
  return budgets.get(key);
}
