// Each request owns its document scope and decision. A previous close only
// delays it; that request's result must never authorize another document.
export function createCloseQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (prepare: () => Promise<boolean>): Promise<boolean> => {
    const task = tail.then(prepare);
    tail = task.then(() => {}, () => {});
    return task;
  };
}
