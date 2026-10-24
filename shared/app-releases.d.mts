export interface ReleaseInfo {version:string;url:string;downloadUrl?:string}
export const releases:string;
export function stableReleaseVersion(tag:unknown):string|null;
export function newerRelease(version:string,current:string):boolean;
export function releaseAssets(version:string,platform?:string,arch?:string):string[];
export function missingAsset(platform:string):string;
export function releaseInfo(value:unknown,platform?:string,arch?:string,currentVersion?:string):ReleaseInfo;
