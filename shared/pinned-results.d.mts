export type PinnedResult = {index:number;file:string;code:string;language:string;name?:string;height?:number};
export function resultId(value:unknown):value is string;
export function pinnedItems(record:unknown):PinnedResult[];
export function resultGroups(record:unknown):Record<string,{items:PinnedResult[]}>;
