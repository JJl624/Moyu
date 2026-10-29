import legacyEmptyCode from './remark-legacy-empty-code.mjs';
import emptyParagraphs from './remark-empty-paragraphs.mjs';
import emptyTasks from './remark-empty-tasks.mjs';
import lists from './remark-lists.mjs';

/** Shared by editing, reading and source-position mapping. Run before inline syntax. */
export default function remarkDocumentStructure() {
  const stages = [legacyEmptyCode(), emptyParagraphs(), emptyTasks.call(this), lists()];
  return (tree, file) => { for (const transform of stages) transform(tree, file); };
}
