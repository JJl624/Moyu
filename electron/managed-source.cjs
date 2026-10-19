const {maskedSource}=require('./clang-source.cjs');
function javaSource(code,{autoMain=true}={}){
  const masked=maskedSource(code),declaration=/\bpublic\s+(?:(?:final|abstract|sealed)\s+)*(?:class|interface|enum|record)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u.exec(masked)||/\b(?:class|interface|enum|record)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u.exec(masked),pkg=/\bpackage\s+([\w.]+)\s*;/.exec(masked)?.[1];
  if(declaration)return {path:(pkg?pkg.replaceAll('.','/')+'/':'')+declaration[1]+'.java',code};
  if(!autoMain)return {path:'Main.java',code};
  const imports=[],ranges=[...masked.matchAll(/^\s*import\s+(?:static\s+)?[\w.*]+\s*;/gm)];let body=code;
  for(const match of ranges)imports.push(code.slice(match.index,match.index+match[0].length).trim());
  for(const match of ranges.reverse())body=body.slice(0,match.index)+body.slice(match.index+match[0].length);
  return {path:'Main.java',code:imports.join('\n')+'\npublic class Main { public static void main(String[] args) throws Exception {\n'+body+'\n}}'};
}
module.exports={javaSource};
