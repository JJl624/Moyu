import {editPreviewReference} from './attachment-helper';
import { _electron as electron, expect, type Page, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editAttachment } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/e2e');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'v16-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? {
        executablePath: process.env.MOYU_E2E_EXECUTABLE,
        args: ['--disable-backgrounding-occluded-windows'],
      }
      : { args: [project, '--disable-backgrounding-occluded-windows'] }),
    env,
  });
  const page = await app.firstWindow(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return { app, page, root: path.join(data, '示例知识库'), errors };
}
async function open(page: Page, name: string, content: string) {
  await page.evaluate(async ({ name, content }) => window.moyu!.create(name, 'file', content), {
    name,
    content,
  });
  await page.locator('.tree-item[title="' + name + '"]').dblclick();
  await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', name);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}
async function save(app: Awaited<ReturnType<typeof fixture>>['app']) {
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
      x.label === '保存'
    )!.click()
  );
}
async function caret(page: Page, selector: string, text: string, offset: number) {
  await page.locator(selector).evaluate((el, { text, offset }) => {
    (el.closest('[contenteditable=true]') as HTMLElement)?.focus();
    const wanted = el.textContent!.indexOf(text) + offset;
    if (wanted < offset) throw Error('caret text missing: ' + el.textContent);
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let total = 0;
    while (walk.nextNode()) {
      const n = walk.currentNode, length = n.textContent!.length;
      if (total + length >= wanted) {
        const r = document.createRange();
        r.setStart(n, wanted - total);
        r.collapse(true);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return;
      }
      total += length;
    }
    throw Error('caret offset missing');
  }, { text, offset });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
}
test('Repeated empty-height clicks and resets never create NaN; dragging replaces height in its original attribute position', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(
      page,
      '高度.md',
      '```text\na\nb\n```\n\n```text {.before height=NaN height=NaN size=50% .after}\nx\n```\n\n末尾',
    );
    const block = page.locator('.milkdown-code-block').first(),
      field = block.getByLabel('代码块自定义属性');
    await expect(field).toHaveValue('');
    await expect(field).not.toHaveAttribute('placeholder', '{}');
    for (let i = 0; i < 5; i++) {
      await block.locator('.code-resize').dblclick();
      await expect(field).toHaveValue('');
    }
    await field.fill('{.before height=160 size=50% .after}');
    await expect(block.locator('.cm-editor')).toHaveCSS('height', '160px');
    const handle = block.locator('.code-resize');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 8 });
    await page.mouse.up();
    await expect(field).toHaveValue('{.before height=240 size=50% .after}');
    const second = page.locator('.milkdown-code-block').nth(1);
    await second.locator('.code-resize').dblclick();
    await expect(second.getByLabel('代码块自定义属性')).toHaveValue('{.before size=50% .after}');
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '高度.md'), 'utf8')).not.toContain('NaN');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Visual previews live outside contenteditable; context commands focus their source link, source caret stays text-height and dimensions remain live', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await fs.writeFile(
      path.join(root, '图.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="blue"/></svg>',
    );
    await open(page, '媒体.md', '上方文字\n\n![图|160](图.svg)\n\n下方文字');
    const preview = page.locator('.attachment-overlay');
    await expect(preview.locator('img')).toHaveCSS('width', '160px');
    expect(await preview.evaluate(el => el.closest('[contenteditable=true]'))).toBe(null);
    await caret(page, '.ProseMirror p:first-child', '上方', 1);
    await editPreviewReference(page,preview);
    await expect(page.locator('.visual-attachment .syntax-raw')).toBeVisible();
    await expect(preview).toBeHidden();
    expect(
      await page.evaluate(() => {
        const selection = getSelection()!,
          source = document.querySelector('.visual-attachment .syntax-raw')!;
        const range = document.createRange();
        range.setStart(source, 0);
        range.setEnd(selection.focusNode!, selection.focusOffset);
        return { text: source.textContent, offset: range.toString().length };
      }),
    ).toEqual({ text: '![图|160](图.svg)', offset: 0 });
    await caret(page, '.visual-attachment .syntax-raw', '图|160', 2);
    const height = await page.evaluate(() =>
      getSelection()!.getRangeAt(0).getBoundingClientRect().height
    );
    expect(height).toBeLessThan(40);
    await page.keyboard.press('Delete');
    await page.keyboard.insertText('2');
    await expect(preview).toBeHidden();
    await page.locator('.ProseMirror p').last().click();
    await expect(preview).toBeVisible();
    await expect(preview.locator('img')).toHaveCSS('width', '260px');
    const box = (await preview.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 70, { steps: 10 });
    await page.mouse.up();
    expect(
      await page.evaluate(() =>
        getSelection()?.focusNode?.parentElement?.closest('.attachment-overlay')
      ),
    ).toBe(null);
    await editAttachment(page, page.locator('.visual-attachment'));
    await page.locator('.visual-attachment .syntax-raw').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '重命名附件', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Real clipboard PNG is copied once to attachments in both modes, replaces selected text and survives reopening', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '粘贴.md', '左替换右\n\n末尾');
    await caret(page, '.ProseMirror p:first-child', '左替换右', 1);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const copies = [];
      for (const item of await clipboard.read()) {
        const entries = [];
        for (const type of item.types) entries.push([type, await item.getType(type)]);
        copies.push(new ClipboardItem(Object.fromEntries(entries)));
      }
      (globalThis as any).moyuClipboardSnapshot = copies;
    });
    try {
      await app.evaluate(async ({ clipboard, ClipboardItem }, png) => {
        await clipboard.write([
          new ClipboardItem({
            'image/png': new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }),
            'text/html': '<img src="file:///unavailable.png">',
          }),
        ]);
      }, (await fs.readFile(path.join(project, 'resources/icon.png'))).toString('base64'));
      await page.evaluate(() => window.moyu!.feature('editing.command', { command: 'paste' }));
      await expect(page.locator('.ProseMirror .attachment-link')).toHaveCount(1);
      await expect(page.locator('.attachment-overlay img')).toHaveCount(0);
      await expect.poll(async () => {
        const names = await fs.readdir(path.join(root, '粘贴.assets/attachments'));
        return names.filter(n => /\.png$/.test(n)).length;
      }).toBe(1);
      await save(app);
      await expect.poll(() => fs.readFile(path.join(root, '粘贴.md'), 'utf8')).toMatch(
        /左!\[.*\]\(粘贴\.assets\/attachments\/.*\.png\)右/,
      );
      const md = await fs.readFile(path.join(root, '粘贴.md'), 'utf8');
      expect(md).toMatch(/左!\[.*\]\(粘贴\.assets\/attachments\/.*\.png\)右/);
      expect(md).not.toMatch(/blob:|data:image|unavailable/);
      await page.getByRole('button', { name: '源码', exact: true }).click();
      await page.locator('.source-editor .cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.evaluate(() => window.moyu!.feature('editing.command', { command: 'paste' }));
      await expect(page.locator('.source-editor .cm-content')).toContainText('-1.png');
      await save(app);
      await expect.poll(() => fs.readFile(path.join(root, '粘贴.md'), 'utf8')).toContain('-1.png');
      await page.getByRole('button', { name: '预览编辑', exact: true }).click();
      await caret(page,'.ProseMirror p:first-child','左',0);
      await expect(page.locator('.attachment-overlay img')).toHaveCount(0);
      await expect(page.locator('.ProseMirror .attachment-link')).toHaveCount(2);
      await expect(page.locator('.ProseMirror p:first-child a')).toHaveCount(1);
      expect(errors).toEqual([]);
    } finally {
      await app.evaluate(async ({ clipboard }) => {
        const items = (globalThis as any).moyuClipboardSnapshot;
        if (items.length) await clipboard.write(items);
        else clipboard.clear();
        delete (globalThis as any).moyuClipboardSnapshot;
      });
    }
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Actual insertion caret returns to plain text, inline source and code across document and mode switches', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '其他.md', '别的文档');
    await open(
      page,
      '光标.md',
      '正文abc尾\n\n左**样式xyz**右\n\n```python\nalpha = 10\nbeta = 20\n```\n\n末尾',
    );
    for (
      const [selector, text, offset] of [['.ProseMirror p:first-child', '正文abc尾', 4], [
        '.inline-syntax .syntax-raw',
        '**样式xyz**',
        5,
      ], ['.milkdown-code-block .cm-line:nth-child(2)', 'beta = 20', 5]] as const
    ) {
      if (selector.includes('inline')) await page.locator('.inline-syntax .syntax-preview').click();
      await caret(page, selector, text, offset);
      await page.locator('.tab-name[title="其他.md"]').click();
      await page.locator('.tab-name[title="光标.md"]').click();
      await expect(page.locator('.ProseMirror')).toContainText('正文abc尾');
      await expect.poll(() =>
        page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))
      ).toBe(true);
      await page.keyboard.insertText('Q');
      await save(app);
      await expect.poll(() => fs.readFile(path.join(root, '光标.md'), 'utf8')).toContain(
        text.slice(0, offset) + 'Q' + text.slice(offset),
      );
      await page.keyboard.press('Control+Z');
      await page.getByRole('button', { name: '源码', exact: true }).click();
      await expect(page.locator('.source-editor .cm-content')).toBeFocused();
      await page.keyboard.insertText('R');
      await save(app);
      await expect.poll(() => fs.readFile(path.join(root, '光标.md'), 'utf8')).toContain(
        text.slice(0, offset) + 'R' + text.slice(offset),
      );
      await page.keyboard.press('Control+Z');
      await page.getByRole('button', { name: '预览编辑', exact: true }).click();
      await expect.poll(() =>
        page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Wheel remains monotonic with many virtual code blocks and external previews, even after delayed teardown', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    test.setTimeout(100000);
    await fs.writeFile(
      path.join(root, '图.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120"/></svg>',
    );
    await open(
      page,
      '滚动.md',
      Array.from(
        { length: 30 },
        (_, i) =>
          `第${i}段\n\n![图|160](图.svg)\n\n\`\`\`text {height=160}\n${
            Array.from({ length: 12 }, (_, j) => 'line ' + j).join('\n')
          }\n\`\`\``,
      ).join('\n\n'),
    );
    await expect(page.locator('.attachment-overlay')).toHaveCount(30);
    const scroll = page.locator('.document-scroll'), box = (await scroll.boundingBox())!;
    await page.mouse.move(box.x + box.width - 15, box.y + 100);
    let last = 0;
    for (let i = 0; i < 15; i++) {
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(100);
      const current = await scroll.evaluate(el => el.scrollTop);
      expect(current).toBeGreaterThanOrEqual(last);
      last = current;
    }
    await page.waitForTimeout(5600);
    const stable = await scroll.evaluate(el => el.scrollTop);
    await page.waitForTimeout(300);
    expect(await scroll.evaluate(el => el.scrollTop)).toBeCloseTo(stable, 0);
    last = stable;
    for (let i = 0; i < 15; i++) {
      await page.mouse.wheel(0, -260);
      await page.waitForTimeout(100);
      const current = await scroll.evaluate(el => el.scrollTop);
      expect(current).toBeLessThanOrEqual(last + 1);
      last = current;
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('HTML clipboard images and file drops share the same link editor; reopening never restores an atom image', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '导入.md', '开始\n\n末尾');
    const png = (await fs.readFile(path.join(project, 'resources/icon.png'))).toString('base64');
    await caret(page, '.ProseMirror p:first-child', '开始', 2);
    await page.locator('.ProseMirror').evaluate((el, png) => {
      const data = new DataTransfer();
      data.setData('text/html', '<img src="data:image/png;base64,' + png + '">');
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, png);
    await expect(page.locator('.ProseMirror .attachment-link')).toHaveCount(1);
    await expect(page.locator('.attachment-overlay img')).toHaveCount(0);
    const drop = async (selector: string, name: string) => {
      await page.locator(selector).evaluate((el, { png, name }) => {
        const data = new DataTransfer();
        data.items.add(
          new File([Uint8Array.from(atob(png), char => char.charCodeAt(0))], name, {
            type: 'image/png',
          }),
        );
        const box = el.getBoundingClientRect();
        el.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: data,
            clientX: box.left + 20,
            clientY: box.top + 10,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, { png, name });
    };
    await drop('.ProseMirror p:last-child', '中文图片.png');
    await expect(page.locator('.ProseMirror .attachment-link')).toHaveCount(2);
    await expect(page.locator('.attachment-overlay img')).toHaveCount(0);
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await page.locator('.source-editor .cm-content').click();
    await page.evaluate(() =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    );
    await drop('.source-editor .cm-line:last-child', '源码图片.png');
    await expect(page.locator('.source-editor .cm-content')).toContainText('源码图片.png');
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '导入.md'), 'utf8')).toContain(
      '源码图片.png',
    );
    const md = await fs.readFile(path.join(root, '导入.md'), 'utf8');
    expect(md).not.toMatch(/blob:|data:image|%E/);
    await page.locator('.tab.active .tab-close').click();
    await page.locator('.tree-item[title="导入.md"]').dblclick();
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await caret(page,'.ProseMirror p:first-child','开始',0);
    await expect(page.locator('.ProseMirror .attachment-link')).toHaveCount(3);
    await expect(page.locator('.attachment-overlay img')).toHaveCount(0);
    await expect(page.locator('.ProseMirror img,.ProseMirror-selectednode')).toHaveCount(0);
    for (let i = 0; i < 3; i++) {
      await editAttachment(page, page.locator('.attachment-link').nth(i));
      await expect(page.locator('.attachment-link').nth(i).locator('.syntax-raw')).toBeVisible();
      await page.locator('.ProseMirror p').first().click({ position: { x: 3, y: 5 } });
    }
    expect((await fs.readdir(path.join(root, '导入.assets/attachments'))).filter(name => name.endsWith('.png')))
      .toHaveLength(3);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Long code retains its inner scroll and reversed selection; export reads the complete Markdown independently of viewport and mode', async () => {
  test.setTimeout(120000);
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, '其他.md', '另一文档');
    const code = Array.from(
      { length: 100 },
      (_, i) => 'line_' + String(i).padStart(3, '0') + ' = ' + i,
    ).join('\n');
    await fs.writeFile(
      path.join(root, '图片.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>',
    );
    await fs.mkdir(path.join(root, 'attachments'), { recursive: true });
    await fs.writeFile(path.join(root, 'attachments/中文 输入.csv'), 'a,b\n1,2');
    await page.evaluate(() => window.moyu!.feature('drawing.create', { path: '绘图.excalidraw' }));
    await open(
      page,
      '完整.md',
      '开始\n\n![图片|50%](图片.svg)\n\n![绘图|160](绘图.excalidraw)\n\n'
        + '[输入](<attachments/中文 输入.csv>)\n\n![引用|50%][ref]\n\n[ref]: 图片.svg\n\n'
        + '[网址](https://example.com/%E4%B8%AD%E6%96%87?q=%23%26%2F)\n\n'
        + String.fromCharCode(96).repeat(3) + 'python {height=160}\n' + code + '\n'
        + String.fromCharCode(96).repeat(3) + '\n\n结束',
    );
    const scroller = page.locator('.milkdown-code-block .cm-scroller');
    await page.locator('.milkdown-code-block .cm-line').first().click({
      position: { x: 20, y: 8 },
    });
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.evaluate(() =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    );
    const selected = await page.evaluate(() => getSelection()?.toString());
    expect(selected).toBe('= 40');
    const top = await scroller.evaluate(el => el.scrollTop);
    expect(top).toBeGreaterThan(0);
    await page.locator('.tab-name[title="其他.md"]').click();
    await page.locator('.tab-name[title="完整.md"]').click();
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(selected);
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeCloseTo(top, 0);
    await page.keyboard.insertText('REPLACED');
    await save(app);
    await expect.poll(() => fs.readFile(path.join(root, '完整.md'), 'utf8')).toContain(
      'line_040 REPLACED',
    );
    await page.keyboard.press('Control+Z');
    const html = path.join(root, '完整.html');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, html);
    await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
    await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
    await expect.poll(() => fs.readFile(html, 'utf8').catch(() => '')).toContain('line_099');
    const exported = await fs.readFile(html, 'utf8');
    const complete = await page.evaluate(html => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      return {
        code: parsed.querySelector('pre code')?.textContent,
        width: parsed.querySelector('img')?.style.width,
        referenceWidth: parsed.querySelectorAll('img')[1]?.style.width,
        fileHref: parsed.querySelector('a[href$=".csv"]')?.getAttribute('href'),
        remoteHref: parsed.querySelector('a[href^="https://example.com/"]')?.getAttribute('href'),
        vector: !!parsed.querySelector('.resource-preview svg'),
        editor: !!parsed.querySelector('.cm-editor,.attachment-space,.syntax-raw'),
      };
    }, exported);
    expect(complete).toEqual({
      code,
      width: '40px',
      referenceWidth: '40px',
      fileHref: 'attachments/中文 输入.csv',
      remoteHref: 'https://example.com/中文?q=%23%26%2F',
      vector: true,
      editor: false,
    });
    await page.getByRole('button', { name: '源码', exact: true }).click();
    const pdf = path.join(root, '完整.pdf');
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, pdf);
    await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
    await expect.poll(
      () => fs.readFile(pdf).then(b => b.subarray(0, 5).toString()).catch(() => ''),
      { timeout: 30000 },
    ).toBe('%PDF-');
    await expect(page.locator('.source-editor')).toBeVisible();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
      windows,
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
