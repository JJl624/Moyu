import initSqlJs from 'sql.js';
import {sqliteBrowser} from './sqlite-browser.mjs';
let db,browser;
self.onmessage=async({data})=>{try{
  if(data.action==='open'){
    const SQL=await initSqlJs({wasmBinary:new Uint8Array(data.wasm)});const limits=new SQL.Database();try{limits.run('PRAGMA hard_heap_limit=268435456');}finally{limits.close();}
    db?.close();db=new SQL.Database(data.bytes);browser=sqliteBrowser(db);self.postMessage({id:data.id,result:browser.catalog()});
  }else if(data.action==='query')self.postMessage({id:data.id,result:browser.query(data.sql,data.page)});
}catch(e){self.postMessage({id:data.id,error:String(e.message)});}};
