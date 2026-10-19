# Markdown 语法指南

墨屿使用 Milkdown / Crepe 进行预览编辑编辑。这篇文档展示常用的 Markdown 排版。

## 文字与引用

**加粗文字**、*斜体文字*、~~删除线~~，以及 `行内代码`。

> 把复杂的事情说明白，就是一种好的写作。

## 列表与任务

1. 有序列表的第一项
2. 有序列表的第二项

- 无序列表
  - 支持嵌套

- [x] 已完成的任务
- [ ] 下一件要做的事

## 表格

| 功能 | 用法 |
| --- | --- |
| 表格 | 输入 `/` 选择表格 |
| 图片 | 插入菜单添加，或粘贴、拖入图片 |
| 公式 | 行内 `$...$` 或公式块 |

## 代码块

```typescript
interface Thought {
  title: string
  content: string
}

const write = (thought: Thought) => {
  return `# ${thought.title}\n\n${thought.content}`
}
```

## 数学公式

行内公式：$E = mc^2$。

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## 链接与文件

[返回开始使用](../开始使用.md)。文档之间使用标准 Markdown 相对链接，图片上传到当前文档旁的 `assets` 文件夹。

源码模式支持完整 Markdown 文本编辑与搜索。预览编辑模式支持 CommonMark / GFM；切换并编辑复杂扩展语法时，Milkdown 会按它的语法能力重新序列化文档。
