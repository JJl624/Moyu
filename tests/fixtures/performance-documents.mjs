export const performanceDocuments = [
  {
    name: '长文章',
    markdown: '# 长文章\n\n'
      + Array.from(
        { length: 220 },
        (_, i) => `第 ${i + 1} 段：` + '文档编辑需要保持输入、选择和滚动流畅。'.repeat(18),
      ).join('\n\n'),
  },
  {
    name: '密集代码',
    markdown: '# 密集代码\n\n'
      + Array.from({ length: 80 }, (_, i) =>
        `段落 ${i}\n\n\`\`\`js {id=${i.toString(16).padStart(4, '0')}}\n`
        + Array.from({ length: 8 }, (_, j) => `const value${j} = ${i + j};`).join('\n') + '\n```').join(
          '\n\n',
        )
      + '\n\n末尾',
  },
  {
    name: '大量图片',
    markdown: '# 大量图片\n\n'
      + Array.from({ length: 100 }, (_, i) => `第 ${i + 1} 张图片\n\n![示例|220](性能图片.svg)`).join('\n\n'),
  },
];
