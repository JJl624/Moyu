import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {seedRuntimeCache} from './helpers/runtime-cache';
const project = path.resolve(import.meta.dirname, '..'), base = path.resolve(project, '../../work/e2e');
async function fixture(policy?: string, installed = false) {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'file-viewers-'));
  if(installed)await seedRuntimeCache(data);
  if (policy) {
    await fs.writeFile(
      path.join(data, 'settings.json'),
      JSON.stringify({ version: 1, values: { 'moyu-save-policy': policy } }),
    );
  }
  const env = {
    ...process.env,
    MOYU_USER_DATA: data,
    MOYU_TEST: '1',
    MOYU_DEMO: '1',
    MOYU_TEST_OFFSCREEN: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
      process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
        : { args: [project], env },
    ),
    page = await app.firstWindow(),
    errors: string[] = [];
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach(w => w.webContents.setBackgroundThrottling(false))
  );
  page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.ProseMirror h1').first()).toBeVisible();
  return { app, page, data, root: path.join(data, '示例知识库'), errors };
}
async function open(page: any, name: string) {
  await expect(page.locator(`.tree-item[title="${name}"]`)).toBeVisible();
  await page.locator(`.tree-item[title="${name}"]`).dblclick();
}
function pdfFixture() {
  const stream = (text: string) => `BT /F1 24 Tf 40 100 Td (${text}) Tj ET`,
    objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${stream('First page').length} >>\nstream\n${stream('First page')}\nendstream`,
      `<< /Length ${stream('Second page').length} >>\nstream\n${stream('Second page')}\nendstream`,
    ];
  let s = '%PDF-1.4\n', offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = s.length;
  s += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF`;
  return s;
}
test('CodeMirror edits supported text filenames, preserves line endings, preview tabs and Markdown mode', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    for (
      const [name, content] of [
        ['程序.cpp', '\ufeff#include <stdio.h>\r\nint main() { return 0; }\r\n'],
        ['脚本.py', 'print("中文")\n'],
        ['Dockerfile', 'FROM alpine\n'],
        ['查询.sql', 'SELECT 1;\n'],
      ]
    ) await fs.writeFile(path.join(root, name), content);
    await open(page, '程序.cpp');
    await expect(page.locator('.text-file-editor .cm-content')).toContainText('int main');
    await expect(page.locator('.document-actions')).toHaveCount(0);
    await expect(page.locator('.formatbar')).toHaveCount(0);
    await expect(page.locator('.right-sidebar')).toHaveCount(0);
    await page.locator('.text-file-editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('// 编辑');
    await page.keyboard.press('Control+s');
    await expect.poll(() => fs.readFile(path.join(root, '程序.cpp'), 'utf8')).toBe(
      '\ufeff#include <stdio.h>\r\nint main() { return 0; }\r\n// 编辑',
    );
    await page.evaluate(() => window.moyu!.feature('clipboard.write', { text: '\n粘贴一\n粘贴二' }));
    await page.keyboard.press('Control+v');
    await expect(page.locator('.text-file-editor .cm-line')).toHaveCount(5);
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('尾行');
    await page.locator('.save-status').click();
    await expect.poll(() => fs.readFile(path.join(root, '程序.cpp'), 'utf8')).toBe(
      '\ufeff#include <stdio.h>\r\nint main() { return 0; }\r\n// 编辑\r\n粘贴一\r\n粘贴二\r\n尾行',
    );
    await page.locator('.text-file-editor .cm-content').click();
    await page.keyboard.press('Control+a');
    await page.locator('.text-file-editor .cm-content').click({ button: 'right' });
    for (const name of ['复制', '剪切', '粘贴', '全选']) {
      await expect(page.locator('.element-menu').getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    await page.locator('.element-menu').getByRole('menuitem', { name: '复制', exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('尾行');
    for (const name of ['脚本.py', 'Dockerfile', '查询.sql']) {
      await open(page, name);
      await expect(page.locator('.text-file-editor .cm-content')).toBeVisible();
      await expect(page.locator('.mode-switch')).toHaveCount(0);
    }
    await open(page, '开始使用.md');
    await expect(page.locator('.reading-view')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('EmbedPDF renders PDF pages, supports navigation and zoom in a unified tab', async () => {
  const {app,page,root,errors}=await fixture();try {
    await fs.writeFile(path.join(root,'两页.pdf'),pdfFixture());await open(page,'两页.pdf');
    const image=page.locator('.embedpdf-host img').first();await expect(image).toBeVisible({timeout:30000});
    await expect.poll(()=>image.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(100);
    await expect(page.locator('.mode-switch')).toHaveCount(0);
    await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.embedpdf-host input:not([type=file])').last()).toHaveValue('2');
    await page.getByRole('button',{name:'上一页',exact:true}).click();await expect(page.locator('.embedpdf-host input:not([type=file])').last()).toHaveValue('1');
    const zoom=page.getByRole('textbox',{name:'Set zoom'});const before=await zoom.inputValue();await page.getByRole('button',{name:'放大',exact:true}).click();await expect(zoom).not.toHaveValue(before);
    expect(await fs.readFile(path.join(root,'两页.pdf'),'utf8')).toBe(pdfFixture());expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
});
test('SQLite viewer lists objects, paginates queries, prevents writes and leaves database bytes unchanged', async () => {
  const { app, page, root, errors } = await fixture(undefined,true);
  try {
    const SQL = await createRequire(import.meta.url)('sql.js')(), db = new SQL.Database();
    db.run(
      `CREATE TABLE items(id INTEGER PRIMARY KEY,name);CREATE VIEW my_view AS SELECT * FROM items;CREATE INDEX my_index ON items(name);CREATE TRIGGER my_trigger AFTER INSERT ON items BEGIN SELECT 1; END;CREATE VIRTUAL TABLE search USING fts3(content);PRAGMA user_version=42;WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<205) INSERT INTO items SELECT x,'item-'||x FROM n;`,
    );
    const original = Buffer.from(db.export());
    db.close();
    await fs.writeFile(path.join(root, '数据.sqlite'), original);
    await open(page, '数据.sqlite');
    const viewer = page.getByLabel('SQLite 查看器');
    await expect(viewer.getByRole('button', { name: 'items', exact: true })).toBeEnabled();
    for (const text of ['虚拟表', '影子表', '系统对象', 'my_view', 'my_index', 'my_trigger']) {
      await expect(viewer.locator('.sqlite-objects')).toContainText(text);
    }
    await viewer.getByRole('button', { name: 'items', exact: true }).click();
    await expect(viewer.locator('tbody tr')).toHaveCount(100);
    await viewer.getByLabel('查询下一页').click();
    await expect(viewer.locator('tbody tr').first()).toContainText('101');
    await viewer.getByLabel('查询下一页').click();
    await expect(viewer.locator('tbody tr')).toHaveCount(5);
    await viewer.getByLabel('只读 SQL 查询').fill('PRAGMA query_only=OFF');
    await viewer.getByRole('button', { name: '查询', exact: true }).click();
    await expect(viewer.getByRole('alert')).toContainText('只读');
    await viewer.getByLabel('只读 SQL 查询').fill('WITH n AS (SELECT 1) DELETE FROM items');
    await viewer.getByRole('button', { name: '查询', exact: true }).click();
    await expect(viewer.getByRole('alert')).toContainText('readonly');
    await viewer.getByLabel('只读 SQL 查询').fill('SELECT count(*) FROM items');
    await viewer.getByRole('button', { name: '查询', exact: true }).click();
    await expect(viewer.locator('tbody')).toHaveText('205');
    await viewer.locator('summary').filter({ hasText: '系统元数据' }).click();
    await expect(viewer.locator('.sqlite-metadata')).toContainText(['42']);
    await page.screenshot({ path: path.join(base, 'sqlite-viewer-v1711.png') });
    expect(await fs.readFile(path.join(root, '数据.sqlite'))).toEqual(original);
    expect(errors).toEqual([]);
    await viewer.getByLabel('只读 SQL 查询').fill(
      'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n',
    );
    await viewer.getByRole('button', { name: '查询', exact: true }).click();
    await viewer.getByRole('button', { name: '取消', exact: true }).click();
    await expect(viewer.getByRole('alert')).toContainText('已取消');
    await viewer.getByRole('button', { name: '重新打开' }).click();
    await expect(viewer.getByRole('button', { name: 'items', exact: true })).toBeEnabled();
    await viewer.getByRole('button', { name: 'items', exact: true }).click();
    await expect(viewer.locator('tbody tr')).toHaveCount(100);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Text files obey manual-save cancellation, conflict resolution and discard on close', async () => {
  const { app, page, root, errors } = await fixture('manual');
  try {
    const file = path.join(root, '保存测试.py');
    await fs.writeFile(file, 'print(1)\n');
    await open(page, '保存测试.py');
    await page.locator('.text-file-editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('# 未保存');
    await expect(page.locator('.save-status')).toContainText('未保存');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    });
    await page.getByRole('button', { name: '关闭 保存测试', exact: true }).click();
    await expect(page.locator('.text-file-editor')).toBeVisible();
    expect(await fs.readFile(file, 'utf8')).toBe('print(1)\n');
    await fs.writeFile(file, 'print(2)\n');
    await page.locator('.save-status').click();
    await expect(page.getByRole('button', { name: '使用磁盘版本', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '使用磁盘版本', exact: true }).click();
    await expect(page.locator('.text-file-editor .cm-content')).toContainText('print(2)');
    await page.locator('.text-file-editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('# 丢弃');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.getByRole('button', { name: '关闭 保存测试', exact: true }).click();
    await expect(page.locator('.text-file-editor')).toHaveCount(0);
    expect(await fs.readFile(file, 'utf8')).toBe('print(2)\n');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test('Chromium handles extra image extensions and rejects corrupt/binary inputs without editing them', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    const png = await fs.readFile(path.join(project, 'resources/icon.png'));
    const ico = Buffer.alloc(22 + png.length);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(1, 4);
    ico[6] = 0;
    ico[7] = 0;
    ico.writeUInt16LE(1, 10);
    ico.writeUInt16LE(32, 12);
    ico.writeUInt32LE(png.length, 14);
    ico.writeUInt32LE(22, 18);
    png.copy(ico, 22);
    await fs.writeFile(path.join(root, '图标.ico'), ico);
    const cur = Buffer.from(ico);
    cur.writeUInt16LE(2, 2);
    cur.writeUInt16LE(0, 10);
    cur.writeUInt16LE(0, 12);
    await fs.writeFile(path.join(root, '光标.cur'), cur);
    await fs.writeFile(path.join(root, '静态.apng'), png);
    for (const name of ['图标.ico', '光标.cur', '静态.apng']) {
      await open(page, name);
      await expect.poll(() =>
        page.locator('.image-viewer img').evaluate((i: HTMLImageElement) => i.naturalWidth)
      ).toBeGreaterThan(0);
      await expect(page.locator('.mode-switch')).toHaveCount(0);
    }
    await fs.writeFile(path.join(root, '损坏.pdf'), 'not a pdf');
    await open(page, '损坏.pdf');
    await expect(page.locator('.pdf-viewer').getByRole('heading',{name:'文件加载出错'})).toBeVisible();
    await fs.writeFile(path.join(root, '二进制.bin'), Buffer.from([0, 1, 2]));
    await open(page, '二进制.bin');
    await expect(page.getByRole('status')).toContainText('二进制');
    expect(await fs.readFile(path.join(root, '二进制.bin'))).toEqual(Buffer.from([0, 1, 2]));
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
