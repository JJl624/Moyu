// Validators are opaque server tokens. Never invent quotes around a bare token.
function validator(value) {
  if (typeof value !== 'string') return null;
  value = value.trim();
  if (!value || value === '*' || /^W\//i.test(value)) return null;
  if (/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)) return value;
  return /^[\x21\x23-\x2b\x2d-\x7e]+$/.test(value) ? value : null;
}
const strong = value => !!value && value.startsWith('"');
const opaque = value => strong(value) ? value.slice(1,-1) : value;
const sameToken = (a,b) => !!a && !!b && opaque(a) === opaque(b);
module.exports = { validator, strong, sameToken };
