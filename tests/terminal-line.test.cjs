const {test}=require('node:test'),assert=require('node:assert/strict'),{TerminalLine}=require('../electron/terminal-line.cjs');
test('Interpreter input supports Unicode deletion, arrows, history, line breaks and exit without a PTY',async()=>{
 const commands=[],output=[],exits=[];const line=new TerminalLine({write:value=>output.push(value),execute:async code=>commands.push(code),exit:code=>exits.push(code),interrupt:()=>exits.push(130)});line.start();line.push('echo 中文😀\x7f\x1b[D!\r');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(commands,['echo 中!文']);line.push('\x1b[A\r');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(commands,['echo 中!文','echo 中!文']);line.push('exit 3\r');assert.deepEqual(exits,[3]);assert.equal(line.closed,true);assert(output.join('').includes('$ '));
});
test('Pasted input batches redraw and Ctrl-C clears a draft or interrupts an executing session',async()=>{
 const output=[];let stopped=0,done;const line=new TerminalLine({write:value=>output.push(value),execute:()=>new Promise(resolve=>{done=resolve;}),exit:()=>{},interrupt:()=>stopped++});line.push('a'.repeat(10000));assert.equal(output.length,1);line.push('\x03');assert.equal(line.line.length,0);line.push('loop\r');assert.equal(line.busy,true);line.push('\x03');assert.equal(stopped,1);done();await new Promise(resolve=>setImmediate(resolve));
});
