// Line discipline for an interpreter, independent of xterm and the runtime.
// Native PTYs keep their own line discipline and never use this class.
const cells=text=>[...text].reduce((n,c)=>n+(/\p{Mark}/u.test(c)?0:c.codePointAt(0)>=0x1100?2:1),0);
class TerminalLine {
  constructor({write,execute,exit,interrupt}){Object.assign(this,{write,execute,exit,interrupt});this.line=[];this.cursor=0;this.history=[];this.index=0;this.escape='';this.input='';this.prompt='$ ';this.busy=false;this.closed=false;}
  redraw(){this.dirty=true;}
  flushLine(){if(!this.dirty)return;this.dirty=false;const text=this.line.join('').replaceAll('\n',' ↵ '),back=cells(this.line.slice(this.cursor).join('').replaceAll('\n',' ↵ '));this.write('\r\x1b[2K'+this.prompt+text+(back?'\x1b['+back+'D':''));}
  start(){this.write(this.prompt);}
  push(text){if(this.closed)return;for(const char of text){
    if(char==='\x03'){this.input='';this.line=[];this.cursor=0;this.continuation='';this.prompt='$ ';if(this.busy){this.interrupt();return;}this.write('^C\r\n');this.start();continue;}
    if(this.input.length>=65536)throw Error('终端输入过大。');this.input+=char;
  }if(!this.busy)void this.consume();}
  arrow(code){if(code==='A'||code==='B'){if(!this.history.length)return;this.index=Math.max(0,Math.min(this.history.length,this.index+(code==='A'?-1:1)));this.line=[...(this.history[this.index]||'')];this.cursor=this.line.length;}else if(code==='D')this.cursor=Math.max(0,this.cursor-1);else if(code==='C')this.cursor=Math.min(this.line.length,this.cursor+1);else if(code==='H')this.cursor=0;else if(code==='F')this.cursor=this.line.length;this.redraw();}
  async consume(){
    while(this.input&&!this.closed&&!this.busy){const char=String.fromCodePoint(this.input.codePointAt(0));this.input=this.input.slice(char.length);
      if(this.escape){this.escape+=char;if(/^[\x1b]\[[0-9;]*[A-Za-z~]$/.test(this.escape)){const sequence=this.escape;this.escape='';if(/^\x1b\[[ABCDHF]$/.test(sequence))this.arrow(char);else if(sequence==='\x1b[3~'){this.line.splice(this.cursor,1);this.redraw();}}else if(this.escape.length>20||this.escape.length===2&&char!=='[')this.escape='';continue;}
      if(char==='\x1b'){this.escape=char;continue;}
      if(char==='\x04'&&!this.line.length){this.closed=true;this.exit(0);return;}
      if(char==='\r'||char==='\n'){
        if(char==='\r'&&this.input.startsWith('\n'))this.input=this.input.slice(1);
        this.flushLine();const code=(this.continuation||'')+this.line.join('');this.line=[];this.cursor=0;this.write('\r\n');
        const exit=code.trim().match(/^exit(?:\s+(\d+))?\s*;?$/);if(exit){this.closed=true;this.exit(Number(exit[1]||0)%256);return;}
        if(code.trim()){this.busy=true;try{if(Buffer.byteLength(code)>200000)throw Error('终端命令超过 200000 字节。');const result=await this.execute(code);if(result?.incomplete){this.continuation=code+'\n';this.prompt='> ';}else{this.continuation='';this.prompt='$ ';if(this.history.at(-1)!==code)this.history.push(code);if(this.history.length>100)this.history.shift();this.index=this.history.length;}}catch(error){this.continuation='';this.prompt='$ ';this.write(error.message+'\r\n');}finally{this.busy=false;}}
        if(!this.closed)this.start();continue;
      }
      if(char==='\x7f'||char==='\b'){if(this.cursor)this.line.splice(--this.cursor,1);this.redraw();continue;}
      if(char==='\x01'){this.cursor=0;this.redraw();continue;}if(char==='\x05'){this.cursor=this.line.length;this.redraw();continue;}
      if(char==='\x15'){this.line.splice(0,this.cursor);this.cursor=0;this.redraw();continue;}
      if(char==='\t'){this.line.splice(this.cursor,0,' ',' ',' ',' ');this.cursor+=4;this.redraw();continue;}
      if(char>=' '&&this.line.length<20000){this.line.splice(this.cursor++,0,char);this.redraw();}
    }
    this.flushLine();
  }
}
module.exports={TerminalLine};
