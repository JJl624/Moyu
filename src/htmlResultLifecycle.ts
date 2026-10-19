// Returning to a hidden result must not execute its script or write files
// again. A deliberate reload starts a fresh page from the stored result.
import {flushSync} from 'react-dom';
const started=new Set<string>();
type Session={document:string;settle():Promise<void>;stop():void};
const sessions=new Map<string,Session>();
export const htmlWasStarted=(token:string)=>started.has(token);
export const markHTMLStarted=(token:string)=>started.add(token);
export function releaseHTMLState(tokens:string[]){for(const token of tokens)started.delete(token);}
export function registerHTMLSession(token:string,session:Session){sessions.set(token,session);return()=>{void session.settle().finally(()=>{if(sessions.get(token)===session)sessions.delete(token);});};}
export async function settleHTMLResults({tokens,documents,stop=false}:{tokens?:string[];documents?:string[];stop?:boolean}={}){
 const selected=[...sessions].filter(([token,session])=>(!tokens||tokens.includes(token))&&(!documents||documents.includes(session.document))).map(([,session])=>session);
 if(stop&&selected.length)flushSync(()=>{for(const session of selected)session.stop();});
 await Promise.all(selected.map(session=>session.settle()));
}
