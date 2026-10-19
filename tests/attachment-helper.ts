import type { Locator, Page } from '@playwright/test';
export async function previewFor(page: Page, source: Locator) {
  const id = await source.getAttribute('data-attachment-preview');
  if (!id) throw Error('Missing preview association');
  return page.locator('#' + id);
}
export async function editAttachment(page: Page, source: Locator) {
  if (!(await source.locator('.syntax-raw').isVisible())) {
    await (await previewFor(page, source)).click();
  }
  await source.locator('.syntax-raw').click();
}
