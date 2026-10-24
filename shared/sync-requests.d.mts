export const automaticSyncGap:number;
export function retryAfterTime(value:unknown,now?:number):number;
export function limitedError(status:number,retryAt:number):Error&{status:number;code:string;retryAt:number};
export class RequestBudget{
  constructor(spacing?:number);
  retryAt:number;
  check(now?:number):void;
  reserve(now?:number):number;
  limited(status:number,value:unknown,now?:number):ReturnType<typeof limitedError>;
  success():void;
}
export function requestBudget(url:string,username?:string):RequestBudget;
