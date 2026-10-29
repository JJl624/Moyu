// Oldest at index zero; visiting a document moves its single entry to the top.
export const visitDocument=(stack,path)=>[...stack.filter(item=>item!==path),path];
