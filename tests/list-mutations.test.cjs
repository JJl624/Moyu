const {test}=require('node:test'),assert=require('node:assert/strict');
const editorModule=require('./helpers/editor-module.cjs');

const modules=Promise.all([
  import('@milkdown/kit/prose/model'),import('@milkdown/kit/prose/state'),
  import('@milkdown/kit/prose/schema-list'),import('@milkdown/kit/prose/commands'),
  import('@milkdown/kit/prose/history'),editorModule('listNormalization.ts'),
  editorModule('listContinuation.ts'),
]);
async function fixture(first=1,depth=0,kind='ordered_list',blocks=false){
  const [{Schema},{EditorState,TextSelection},commands,keys,history,normalization,blocksCommands]=await modules;
  const schema=new Schema({nodes:{
    doc:{content:'block+'},text:{group:'inline'},paragraph:{group:'block',content:'inline*'},
    heading:{group:'block',content:'inline*'},blockquote:{group:'block',content:'block+'},
    code_block:{group:'block',content:'text*',marks:'',code:true},
    ordered_list:{group:'block',content:'list_item+',attrs:{order:{default:1},spread:{default:false}}},
    bullet_list:{group:'block',content:'list_item+',attrs:{spread:{default:false}}},
    list_item:{content:'paragraph block*',defining:true,attrs:{label:{default:'•'},listType:{default:'bullet'},checked:{default:null},spread:{default:true}}},
    table:{group:'block',content:'table_row+'},table_row:{content:'table_cell+'},table_cell:{content:'paragraph+'},
  }});
  const p=text=>schema.nodes.paragraph.create(null,text?schema.text(text):undefined);
  const item=(text,extra=[])=>schema.nodes.list_item.create(kind==='task'?{checked:text==='beta'}:null,[p(text),...extra]);
  const table=()=>schema.nodes.table.create(null,schema.nodes.table_row.create(null,schema.nodes.table_cell.create(null,p('cell'))));
  const extras=blocks?[schema.nodes.code_block.create(null,schema.text('code')),table(),schema.nodes.blockquote.create(null,p('quote'))]:[];
  let list=schema.nodes[kind==='task'?'bullet_list':kind].create(kind==='ordered_list'?{order:first}:null,['alpha','beta','gamma','delta'].map((text,i)=>item(text,i===1?extras:[])));
  for(let i=0;i<depth;i++)list=schema.nodes.bullet_list.create(null,schema.nodes.list_item.create(null,[p('outer'+i),list]));
  let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,list),plugins:[history.history(),normalization.listNormalizationPlugin()]});
  const initial=state.tr;normalization.normalizeLists(initial);state=state.apply(initial.setMeta('addToHistory',false));
  const dispatch=tr=>{state=state.applyTransaction(tr).state;check();};
  function find(text,type='paragraph'){
    let result;state.doc.descendants((node,pos)=>{if(!result&&node.type.name===type&&node.textContent===text)result={node,pos};});assert.ok(result,'Missing '+type+': '+text);return result;
  }
  function select(text,offset=0){const {pos}=find(text);dispatch(state.tr.setSelection(TextSelection.create(state.doc,pos+1+offset)));}
  function check(){
    state.doc.check();
    state.doc.descendants(node=>{
      if(['ordered_list','bullet_list'].includes(node.type.name))node.forEach((item,_offset,index)=>{
        assert.equal(item.attrs.listType,node.type.name==='ordered_list'?'ordered':'bullet');
        assert.equal(item.attrs.label,node.type.name==='ordered_list'?`${node.attrs.order+index}.`:'•');
      });
      let previous;node.forEach(child=>{assert.ok(!previous||!['ordered_list','bullet_list'].includes(child.type.name)||child.type!==previous.type,'Adjacent lists remained split');previous=child;});
      return !node.isTextblock;
    });
  }
  function run(command){
    dispatch(history.closeHistory(state.tr));const before=state.doc.toJSON(),text=state.doc.textContent;
    const applied=command(state,dispatch);if(!applied)return false;
    const after=state.doc.toJSON();if(JSON.stringify(before)===JSON.stringify(after))return true;
    assert.equal(history.undo(state,dispatch),true);assert.deepEqual(state.doc.toJSON(),before,'Undo must restore the complete original list structure');
    assert.equal(history.redo(state,dispatch),true);assert.deepEqual(state.doc.toJSON(),after,'Redo must restore the complete edited list structure');
    return {text};
  }
  const lists=()=>{const result=[];state.doc.descendants(node=>{if(node.type.name==='ordered_list')result.push({start:node.attrs.order,items:Array.from({length:node.childCount},(_,i)=>node.child(i).attrs.label)});});return result;};
  check();return{schema,p,item,table,commands,keys,blocksCommands,select,find,run,lists,dispatch,check,get state(){return state;}};
}

for(const first of [0,1,5,99])for(const depth of [0,1,2])for(const kind of ['ordered_list','bullet_list','task']){
  test(`List insert/delete/split and complete history: start ${first}, depth ${depth}, ${kind}`,async()=>{
    const f=await fixture(first,depth,kind,true);
    for(const at of ['alpha','beta','gamma','delta']){
      f.select(at,2);const oldText=f.state.doc.textContent;
      assert.ok(f.run(f.commands.splitListItem(f.schema.nodes.list_item)));assert.equal(f.state.doc.textContent,oldText);
    }
    // Delete an entire item containing several resource blocks, then insert a
    // new item at the beginning and middle of the surviving list.
    f.select('be'); // beta was split after its second character.
    assert.ok(f.run((state,dispatch)=>{const at=state.selection.$from,position=at.before(at.depth-1),node=at.node(-1);dispatch(state.tr.delete(position,position+node.nodeSize));return true;}));
    for(const text of ['new first','new middle']){
      f.select(text==='new first'?'al':'ga');
      assert.ok(f.run((state,dispatch)=>{const at=state.selection.$from;dispatch(state.tr.insert(at.before(at.depth-1),f.item(text)));return true;}));
    }
    f.check();
  });
}

for(const first of [1,5,99])for(const depth of [0,1,2])for(const target of ['alpha','beta','delta']){
  test(`Lifting ${target} restarts a split suffix, including history: ${first}, depth ${depth}`,async()=>{
    const f=await fixture(first,depth);f.select(target);assert.ok(f.run(f.commands.liftListItem(f.schema.nodes.list_item)));
    const lists=f.lists();if(target!=='delta')assert.equal(lists.at(-1).start,1);
    if(target==='beta')assert.equal(lists[0].start,first);
  });
}

for(const first of [0,1,5])for(const kind of ['ordered_list','bullet_list','task'])for(const key of ['joinBackward','joinForward']){
  test(`Boundary deletion ${key} immediately renumbers and undoes: ${first}, ${kind}`,async()=>{
    const f=await fixture(first,0,kind);f.select(key==='joinBackward'?'beta':'alpha',key==='joinBackward'?0:5);
    assert.ok(f.run(f.keys[key]));
    const text=f.state.doc.textContent;assert.ok(text.includes('alphabeta'));f.check();
  });
}

for(const type of ['paragraph','code_block','table','blockquote'])for(const nested of [false,true]){
  test(`Removing a ${type} separator joins lists and undo restores the separator (${nested?'nested':'root'})`,async()=>{
    const f=await fixture(5),s=f.schema;
    const separator=type==='table'?f.table():type==='blockquote'?s.nodes.blockquote.create(null,f.p('separator')):type==='code_block'?s.nodes.code_block.create(null,s.text('separator')):f.p('separator');
    const upper=s.nodes.ordered_list.create({order:5},[f.item('a'),f.item('b')]),lower=s.nodes.ordered_list.create({order:20},[f.item('c'),f.item('d')]);
    let nodes=[upper,separator,lower];if(nested)nodes=[s.nodes.bullet_list.create(null,s.nodes.list_item.create(null,[f.p('outer'),...nodes]))];
    f.dispatch(f.state.tr.replaceWith(0,f.state.doc.content.size,nodes).setMeta('addToHistory',false));
    let position;f.state.doc.descendants((node,pos)=>{if(node===separator)position=pos;});assert.notEqual(position,undefined);
    assert.ok(f.run((state,dispatch)=>{dispatch(state.tr.delete(position,position+separator.nodeSize));return true;}));
    assert.deepEqual(f.lists(),[{start:5,items:['5.','6.','7.','8.']}]);
  });
}

for(let seed=1;seed<=20;seed++)test(`Reproducible mixed list edit sequence with complete undo/redo (seed ${seed})`,async()=>{
  const f=await fixture(seed%2?1:5,seed%3,seed%4===0?'task':'ordered_list',true);let random=seed;
  const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random;};
  for(let step=0;step<50;step++){
    const paragraphs=[];f.state.doc.descendants((node,pos)=>{if(node.type.name==='paragraph'&&f.state.doc.resolve(pos).parent.type.name==='list_item')paragraphs.push({node,pos});});
    if(!paragraphs.length)break;
    const chosen=paragraphs[next()%paragraphs.length],{TextSelection}=await import('@milkdown/kit/prose/state');
    f.dispatch(f.state.tr.setSelection(TextSelection.create(f.state.doc,chosen.pos+1+Math.min(chosen.node.content.size,next()%4))));
    const actions=[f.commands.splitListItem(f.schema.nodes.list_item),f.commands.sinkListItem(f.schema.nodes.list_item),f.commands.liftListItem(f.schema.nodes.list_item),
      (state,dispatch)=>{dispatch(state.tr.insertText('x'));return true;},
      (state,dispatch)=>{const at=state.selection.$from;if(at.depth<2||at.node(-1).type.name!=='list_item'||at.node(-2).childCount<2)return false;const pos=at.before(at.depth-1);dispatch(state.tr.delete(pos,pos+at.node(-1).nodeSize));return true;}];
    f.run(actions[next()%actions.length]);f.check();
  }
});

test('Parser normalization shares list boundaries with reading and retains empty paragraphs',async()=>{
  const {unified}=await import('unified'),{default:parse}=await import('remark-parse'),{default:lists}=await import('../shared/remark-lists.mjs'),{default:empty}=await import('../shared/remark-document-structure.mjs');
  const processor=unified().use(parse).use(empty).use(lists);
  for(const source of ['1. 33\n\n3) <br />\n\n   <br />','- outer\n\n  5. a\n\n  20) b','> 1. a\n>\n> 9) b']){
    const tree=processor.runSync(processor.parse(source));let count=0;
    const walk=node=>{if(node.type==='list'&&node.ordered){count++;assert.equal(node.children.length,2);assert.deepEqual(node.children.map(item=>item.label),[node.start,node.start+1]);}node.children?.forEach(walk);};walk(tree);assert.equal(count,1);
    assert.deepEqual(processor.runSync(structuredClone(tree)),tree,'Parser normalization must be idempotent');
  }
});

test('Rapid repeated block controls each remain a single undoable action',async()=>{
  const f=await fixture(5,0,'ordered_list',true),history=(await modules)[4];
  for(let repeat=0;repeat<3;repeat++){
    const before=f.state.doc.toJSON();
    assert.ok(f.blocksCommands.outdentBlockFromList(f.state,f.find('code','code_block').pos,f.dispatch));
    const after=f.state.doc.toJSON();
    assert.ok(history.undo(f.state,f.dispatch));assert.deepEqual(f.state.doc.toJSON(),before,'Undo outdent, round '+repeat);
    assert.ok(history.redo(f.state,f.dispatch));assert.deepEqual(f.state.doc.toJSON(),after);
    assert.ok(f.blocksCommands.indentBlockIntoList(f.state,f.find('code','code_block').pos,f.dispatch));
  }
});

test('Converting list kinds immediately changes every label and preserves task states through history',async()=>{
  const f=await fixture(1,0,'task');
  assert.ok(f.run((state,dispatch)=>{dispatch(state.tr.setNodeMarkup(0,f.schema.nodes.ordered_list,{order:7}));return true;}));
  assert.deepEqual(f.lists(),[{start:7,items:['7.','8.','9.','10.']}]);assert.equal(f.state.doc.firstChild.child(1).attrs.checked,true);
  assert.ok(f.run((state,dispatch)=>{dispatch(state.tr.setNodeMarkup(0,f.schema.nodes.bullet_list));return true;}));
  assert.equal(f.state.doc.firstChild.child(1).attrs.checked,true);
});

test('Selection and ordinary text edits do not append list repair transactions; metadata edits still repair labels',async()=>{
  const f=await fixture(5),{TextSelection}=(await modules)[1],history=(await modules)[4];
  const point=f.find('beta').pos+2;
  const selected=f.state.applyTransaction(f.state.tr.setSelection(TextSelection.create(f.state.doc,point)));
  assert.equal(selected.transactions.length,1);assert.equal(selected.state.doc,f.state.doc);
  const typed=selected.state.applyTransaction(selected.state.tr.insertText('x'));
  assert.equal(typed.transactions.length,1);
  const item=f.state.doc.firstChild.firstChild;
  f.dispatch(f.state.tr.setNodeMarkup(1,undefined,{...item.attrs,label:'99.',listType:'bullet'}).setMeta('custom','label').setMeta('addToHistory',false));
  assert.equal(f.state.doc.firstChild.firstChild.attrs.label,'5.');assert.equal(history.undoDepth(f.state),0);
});

test('Serialization retains an intentional empty paragraph between independent lists',async()=>{
  const {inlineMarkdownHandlers,emptyParagraphJoin}=await editorModule('inlineSerialization.ts'),{toMarkdown}=await import('mdast-util-to-markdown');
  const {unified}=await import('unified'),{default:parse}=await import('remark-parse'),{default:lists}=await import('../shared/remark-lists.mjs'),{default:empty}=await import('../shared/remark-document-structure.mjs');
  const processor=unified().use(parse).use(empty).use(lists),p=value=>({type:'paragraph',children:value?[{type:'text',value}]:[]});
  for(const ordered of [true,false])for(const count of [1,2,3]){
    const list=value=>({type:'list',ordered,start:ordered?1:undefined,spread:false,children:[{type:'listItem',spread:false,children:[p(value)]}]});
    const tree={type:'root',children:[list('left'),...Array.from({length:count},(_,index)=>index? p(''):{type:'paragraph'}),list('right')]};
    const source=toMarkdown(tree,{handlers:inlineMarkdownHandlers(),join:[emptyParagraphJoin]});assert.equal((source.match(/<br\s*\/>/g)||[]).length,count);
    const parsed=processor.runSync(processor.parse(source));assert.equal(parsed.children.filter(n=>n.type==='list').length,2);assert.equal(parsed.children.filter(n=>n.type==='paragraph').length,count);
  }
});

test('Empty paragraph HTML cannot absorb the following code fence in tight or nested lists',async()=>{
  const {inlineMarkdownHandlers,emptyParagraphJoin}=await editorModule('inlineSerialization.ts'),{toMarkdown}=await import('mdast-util-to-markdown');
  const {unified}=await import('unified'),{default:parse}=await import('remark-parse'),{default:empty}=await import('../shared/remark-document-structure.mjs');
  const processor=unified().use(parse).use(empty),p=value=>({type:'paragraph',children:[{type:'text',value}]}),gap=()=>({type:'paragraph',children:[{type:'html',value:'<br />'}]});
  for(const ordered of [true,false])for(const nested of [false,true])for(const lang of ['text','html','tabs'])for(const value of ['','11']){
    const list=children=>({type:'list',ordered,start:ordered?1:undefined,spread:false,children:[{type:'listItem',spread:false,children}]});
    const item=list([gap(),{type:'code',lang,meta:'{id=0003}',value},gap(),p('tail')]);
    const tree={type:'root',children:[nested?list([p('outer'),item]):item]};
    const source=toMarkdown(tree,{handlers:inlineMarkdownHandlers(),join:[emptyParagraphJoin]});
    const parsed=processor.runSync(processor.parse(source)),codes=[],paragraphs=[];
    const walk=node=>{if(node.type==='code')codes.push(node);if(node.type==='paragraph')paragraphs.push(node);node.children?.forEach(walk);};walk(parsed);
    assert.equal(codes.length,1,source);assert.equal(codes[0].value,value);assert.equal(codes[0].lang,lang);assert.equal(codes[0].meta,'{id=0003}');
    assert.equal(paragraphs.filter(node=>!node.children.length).length,2,source);assert.ok(paragraphs.some(node=>node.children[0]?.value==='tail'),source);
  }
});

test('Legacy empty fences recover only the app marker and retain original source positions',async()=>{
  const {unified}=await import('unified'),{default:parse}=await import('remark-parse'),{default:empty}=await import('../shared/remark-document-structure.mjs');
  const processor=unified().use(parse).use(empty);
  for(const prefix of ['','3. ','> ','- outer\n\n  - '])for(const eol of ['\n','\r\n']){
    const continuation=prefix==='3. '?'   ':prefix==='> '?'> ':prefix.startsWith('- outer')?'    ':'';
    const source=prefix+'<br />'+eol+continuation+'```text {id=0003}'+eol+continuation+'```'+eol+continuation+'<br />';
    const parsed=processor.runSync(processor.parse(source),{value:source}),codes=[];const walk=node=>{if(node.type==='code')codes.push(node);node.children?.forEach(walk);};walk(parsed);
    assert.equal(codes.length,1,source);assert.equal(codes[0].value,'');assert.equal(codes[0].meta,'{id=0003}');
    assert.equal(source.slice(codes[0].position.start.offset,codes[0].position.end.offset),'```text {id=0003}'+eol+continuation+'```');
  }
  for(const source of ['<br />\n```text\n```','<br />\n```text {id=0003}\n11\n```','<div>\n<br />\n```text {id=0003}\n```\n</div>','<br />\n```text {id=0003}\n```\nother HTML content']){
    assert.deepEqual(processor.runSync(processor.parse(source),{value:source}),processor.parse(source));
  }
});
