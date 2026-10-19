// An open document owns its asynchronous work until it is closed or replaced.
// Paths alone cannot distinguish a newly reopened document from its old buffer.
export class DocumentLifetimes {
  #opened = new Map();
  open(path) {
    const token = {};
    this.#opened.set(path, token);
    return token;
  }
  token(path) {
    return this.#opened.get(path);
  }
  owns(path, token) {
    return !!token && this.#opened.get(path) === token;
  }
  close(path) {
    this.#opened.delete(path);
  }
  clear() {
    this.#opened.clear();
  }
  rename(remap) {
    this.#opened = new Map([...this.#opened].map(([path, token]) => [remap(path), token]));
  }
}
