import fs from 'node:fs/promises';
import path from 'node:path';
export const guideRoot=path.resolve(import.meta.dirname,'../../resources/workspace-guide');
export async function guideCorpus(){
  const files:Record<string,{content:string;base64?:string;updated:number}>={},folders:string[]=[];
  async function visit(directory:string,prefix=''){for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(entry.name.startsWith('.')||entry.name==='node_modules')continue;const relative=prefix+entry.name,absolute=path.join(directory,entry.name);if(entry.isDirectory()){folders.push(relative);await visit(absolute,relative+'/');}else if(entry.isFile()){const bytes=await fs.readFile(absolute),content=bytes.toString('utf8');files[relative]={content,updated:1700000000000,...(!Buffer.from(content).equals(bytes)?{base64:bytes.toString('base64')}:{})};}}}
  await visit(guideRoot);return{files,folders};
}
