/** Third-party controls in the trusted main UI use the browser Clipboard API.
 * Attachment/HTML frames never inherit this write permission. */
function canWriteUiClipboard(contents,owner,permission,details,uiUrl='moyu://app'){
  if(!owner||contents!==owner||permission!=='clipboard-sanitized-write'||details?.isMainFrame!==true)return false;
  try{
    const source=new URL(details.requestingUrl),trusted=new URL(uiUrl);
    return source.protocol===trusted.protocol&&source.host===trusted.host&&!source.username&&!source.password;
  }catch{return false;}
}
module.exports={canWriteUiClipboard};
