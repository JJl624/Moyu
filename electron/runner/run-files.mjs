export const nameOf = value => {
  const name = String(value).replace(/^\/data\//, '');
  if (!name || name.split('/').some(p => !p || p === '..' || p.startsWith('.') || /[<>:"\\|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw new Error('数据文件名无效。');
  return name;
};
export const decode = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const encode = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
};
