// Unsupported notes remain untouched. They must not prevent indexing and
// operating on other documents; path/security errors still fail closed.
async function readableNote(vault, name, skipped = () => {}) {
  try { return await vault.read(name); }
  catch (error) {
    if (!['TOO_LARGE', 'UNSUPPORTED_TEXT', 'ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    skipped(error.message);
    return null;
  }
}
module.exports = { readableNote };
