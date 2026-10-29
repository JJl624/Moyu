const {eligible}=require('./files.cjs');
const {attachmentView,attachmentViews}=require('../shared/attachment-view-state.mjs');
const {localPath,link}=require('../shared/reference-links.mjs');
function context(services,input){
  const vault=services.vault,documents=services.attachments.documents;
  if(input.root&&input.root!==vault.root)throw Error('知识库已切换，请重新打开文档。');
  if(!eligible(input.document)||!/\.(md|markdown)$/i.test(input.document))throw Error('附件视图需要 Markdown 文档。');
  return {vault,documents};
}
async function readAttachmentViews(services,input){
  const {documents}=context(services,input),record=(await documents.read(input.document)).documents[input.document];
  return {views:attachmentViews(record?.attachmentViews),directory:record?.directory||documents.root(input.document)};
}
async function updateAttachmentViews(services,input){
  const {vault,documents}=context(services,input);
  if(typeof input.key!=='string'||!input.key||input.key.length>16384||['__proto__','constructor','prototype'].includes(input.key))throw Error('附件视图标识无效。');
  const patch=attachmentView(input.patch);
  if(!Object.keys(patch).length)return readAttachmentViews(services,input);
  return vault.mutate(async()=>{
    if(services.vault!==vault)throw Error('知识库已切换，请重新打开文档。');
    context(services,input);await vault.resolve(input.document);
    let map=await documents.read(input.document),record=map.documents[input.document];
    const current=attachmentViews(record?.attachmentViews),next=attachmentView({...current[input.key],...patch});
    if(JSON.stringify(current[input.key]||{})===JSON.stringify(next))return {views:current,directory:record?.directory||documents.root(input.document)};
    await documents.ensureUnlocked(input.document);map=await documents.read(input.document);record=map.documents[input.document];
    const rows=record.attachmentViews&&typeof record.attachmentViews==='object'&&!Array.isArray(record.attachmentViews)?record.attachmentViews:{};
    record.attachmentViews={...rows,[input.key]:{...rows[input.key],...patch}};
    await documents.write(map,[input.document]);return {views:attachmentViews(record.attachmentViews),directory:record.directory};
  });
}
function renameAttachmentViews(views,document,nextDocument,moves){
  if(!views||typeof views!=='object'||Array.isArray(views))return views;
  const remap=value=>{const move=moves.find(move=>value===move.from||value.startsWith(move.from+'/'));return move?move.to+value.slice(move.from.length):value;};
  return Object.fromEntries(Object.entries(views).map(([key,value])=>{
    const original=localPath(document,key);if(!original)return [key,value];
    const target=remap(original);return [target===original&&document===nextDocument?key:link(nextDocument,target)+(key.match(/[?#].*$/)?.[0]||''),value];
  }));
}
module.exports={readAttachmentViews,updateAttachmentViews,renameAttachmentViews};
