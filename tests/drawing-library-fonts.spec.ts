import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..'), base = path.resolve(project, '../../work/e2e');
async function launch(data: string) {
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1', MOYU_TEST_OFFSCREEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env } : { args: [project], env });
  const page = await app.firstWindow(), errors: string[] = [];
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.webContents.setBackgroundThrottling(false)));
  page.on('pageerror', e => errors.push(e.message));
  await expect(page.locator('.tree-item').first()).toBeVisible();
  return { app, page, errors };
}
async function fixture(name: string) {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'drawing-library-' + name + '-'));
  return { ...await launch(data), data };
}
async function drawing(page: any, name = '字体与素材.excalidraw') {
  const result = await page.evaluate((path: string) => window.moyu!.feature('drawing.create', { path }), name);
  expect(result.ok).toBe(true);
  await page.locator('.tree-item[title="' + name + '"]').dblclick();
  await expect(page.locator('.excalidraw')).toBeVisible();
  return name;
}
test('Font management lists exact faces and can add a Chinese face whose collection exceeds 20 MB', async () => {
  test.setTimeout(120000);
  const { app, page, data, errors } = await fixture('fonts');
  try {
    await drawing(page);
    await page.getByRole('button', { name: '字体管理', exact: true }).click();
    await page.getByRole('combobox', { name: '添加绘图字体' }).fill('Microsoft JhengHei');
    const normal = page.getByRole('option', { name: 'Microsoft JhengHei（Regular）', exact: true });
    await expect(normal).toBeVisible();
    await expect(page.getByRole('option', { name: /Microsoft JhengHei.*Bold/ }).first()).toBeVisible();
    await normal.click();
    const manager = page.locator('.drawing-font-manager');
    await manager.getByRole('button', { name: '添加', exact: true }).click();
    await expect(manager.getByRole('button', { name: '移除', exact: true })).toBeVisible();
    await expect(manager.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.drawing-error')).toHaveCount(0);
    const settings = JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'));
    const fonts = JSON.parse(settings.values['moyu-drawing-fonts']);
    expect(fonts).toHaveLength(1); expect(fonts[0].face).toBe('MicrosoftJhengHeiRegular');
    await manager.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByTestId('toolbar-text').locator('..').click();
    const box = (await page.locator('canvas.excalidraw__canvas.interactive').boundingBox())!;
    await page.mouse.click(box.x + 350, box.y + 200);
    await page.keyboard.insertText('精确字体'); await page.keyboard.press('Escape');
    await page.getByTestId('font-family-show-fonts').click();
    await page.locator('.excalidraw').getByText('Microsoft JhengHei', { exact: true }).click();
    const file = path.join(data, '示例知识库/字体与素材.excalidraw');
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).elements.find((e: any) => e.type === 'text')?.fontFamily).toBe(fonts[0].id);
    await page.getByRole('button', { name: '字体管理', exact: true }).click();
    await manager.getByRole('button', { name: '移除', exact: true }).click();
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).elements.find((e: any) => e.type === 'text')?.fontFamily).toBe(5);
    await expect(manager.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(base, 'drawing-font-faces-v1710.png') });
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('The library Open action uses a native picker and persists imported items across canvases and restart', async () => {
  test.setTimeout(120000);
  const first = await fixture('persistent'), { app, page, data, errors } = first;
  const root = path.join(data, '示例知识库'), file = path.join(root, '.data/excalidraw_library.excalidrawlib');
  try {
    await drawing(page);
    const scene = JSON.parse(await fs.readFile(path.join(project, 'resources/workspace-guide/公式和代码示例.assets/attachments/示例绘图.excalidraw'), 'utf8'));
    const imported = path.join(data, '导入.excalidrawlib');
    await fs.writeFile(imported, '\uFEFF' + JSON.stringify({ type: 'excalidrawlib', version: 2, libraryItems: [{ id: 'local-example', status: 'unpublished', created: 1, elements: scene.elements }] }));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, imported);
    const drawingFile = path.join(root, '字体与素材.excalidraw'), originalDrawing = await fs.readFile(drawingFile, 'utf8');
    await page.getByTitle('素材库', { exact: true }).click();
    await page.locator('.library-menu-dropdown-container .dropdown-menu-button').first().click();
    await page.getByTestId('lib-dropdown--load').click();
    await expect(page.locator('.library-unit__active')).toHaveCount(1);
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}')).libraryItems?.length).toBe(1);
    expect(await fs.readFile(drawingFile, 'utf8')).toBe(originalDrawing);
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.locator('.library-menu-dropdown-container .dropdown-menu-button').first().click();
    await page.getByTestId('lib-dropdown--load').click();
    await expect(page.locator('.library-unit__active')).toHaveCount(1);
    await expect(page.locator('.excalidraw .Modal')).toHaveCount(0);
    await page.getByRole('button', { name: '字体管理', exact: true }).click();
    await page.locator('.drawing-font-manager').getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByTitle('素材库', { exact: true }).click();
    await expect(page.locator('.library-unit__active')).toHaveCount(1);
    const before = await fs.readFile(file, 'utf8');
    await page.getByRole('button', { name: '关闭画布', exact: true }).click();
    await drawing(page, '另一张图.excalidraw');
    await page.getByTitle('素材库', { exact: true }).click();
    await expect(page.locator('.library-unit__active')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭画布', exact: true }).click();
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
  const restarted = await launch(data);
  try {
    await restarted.page.locator('.tree-item[title="字体与素材.excalidraw"]').dblclick();
    await expect(restarted.page.locator('.excalidraw')).toBeVisible();
    await restarted.page.getByTitle('素材库', { exact: true }).click();
    await expect(restarted.page.locator('.library-unit__active')).toHaveCount(1);
    expect(restarted.errors).toEqual([]);
    await restarted.page.screenshot({ path: path.join(base, 'drawing-library-v1710.png') });
  } finally { await restarted.app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});

test('A corrupted library is preserved on canvas open and replaced only by an explicit valid import', async () => {
  const { app, page, data, errors } = await fixture('corrupt');
  try {
    const file = path.join(data, '示例知识库/.data/excalidraw_library.excalidrawlib');
    await fs.writeFile(file, 'broken library');
    await drawing(page);
    await expect(page.locator('.drawing-error')).toContainText('素材库格式无效');
    await page.getByTitle('素材库', { exact: true }).click();
    await expect(page.locator('.library-menu-items__no-items')).toBeVisible();
    expect(await fs.readFile(file, 'utf8')).toBe('broken library');
    const scene = JSON.parse(await fs.readFile(path.join(project, 'resources/workspace-guide/公式和代码示例.assets/attachments/示例绘图.excalidraw'), 'utf8'));
    const imported = path.join(data, '修复.excalidrawlib');
    await fs.writeFile(imported, JSON.stringify({type:'excalidrawlib',version:2,libraryItems:[{id:'restored',status:'unpublished',created:1,elements:scene.elements}]}));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[file]}); }, imported);
    await page.locator('.library-menu-dropdown-container .dropdown-menu-button').first().click();
    await page.getByTestId('lib-dropdown--load').click();
    await expect(page.locator('.library-unit__active')).toHaveCount(1);
    await expect(page.locator('.drawing-error')).toHaveCount(0);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).libraryItems).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
