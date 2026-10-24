export interface SyncPolicy {
  onOpen:boolean;afterSave:boolean;interval:number;includeCodeData:boolean;excludes:string;
  deletion:'confirm'|'sync'|'keep';timeout:number;retries:number;concurrency:number;maxFileMB:number;
}
export const defaults:Readonly<SyncPolicy>;
export function policy(input?:Partial<SyncPolicy>):SyncPolicy;
export function excludedBy(settings:SyncPolicy):(path:string)=>boolean;
export function syncEligible(path:string):boolean;
