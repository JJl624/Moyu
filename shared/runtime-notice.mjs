const messages = {
  select: '已切换',
  remove: '已删除',
  'remove-runtime': '已删除',
  'remove-package': '已卸载',
  install: '已安装',
  'install-runtime': '已安装',
  'install-package': '已安装',
  reset: '已重启',
};
export function runtimeNotice(action) {
  if (action.startsWith('refresh')) return '已刷新';
  if (action.startsWith('import')) return '已导入';
  return Object.hasOwn(messages, action) ? messages[action] : '';
}
