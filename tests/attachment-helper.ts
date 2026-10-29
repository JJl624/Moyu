import type { Locator, Page } from '@playwright/test';
export async function previewFor(page: Page, source: Locator) {
  const id = await source.getAttribute('data-attachment-preview');
  if (!id) throw Error('Missing preview association');
  return page.locator('#' + id);
}
export async function editAttachment(page: Page, source: Locator) {
  if (!(await source.locator('.syntax-raw').isVisible())) {
    const preview=await previewFor(page, source);
    if(await preview.evaluate(element=>element.classList.contains('attachment-overlay')))await editPreviewReference(page,preview);
    else await preview.click();
  }
  await source.locator('.syntax-raw').click();
}
export async function editPreviewReference(page:Page,preview:Locator){
  await preview.click({button:'right'});await page.getByRole('menuitem',{name:'编辑引用',exact:true}).click();
}

export async function stopScore(page:Page,card:Locator){const options=card.getByRole('dialog',{name:'播放选项',exact:true});if(!await options.isVisible())await card.getByRole('button',{name:'播放选项',exact:true}).click();await card.getByRole('button',{name:'停止播放',exact:true}).click();await page.keyboard.press('Escape');}
