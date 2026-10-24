export class CoalescedWrites<T> {
  constructor(write:(value:T)=>Promise<unknown>,options?:{delay?:number;maxWait?:number;report?:(error:unknown)=>void});
  set(key:string,value:T):Promise<boolean>;
  flush():Promise<void>;
  discard(matches:(value:T)=>boolean):Promise<void>;
}
