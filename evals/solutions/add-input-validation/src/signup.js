export function signup({ email, password } = {}) {
  if (!email) throw new TypeError('email is required');
  if (!String(email).includes('@')) throw new TypeError('email must contain @');
  if (!password || String(password).length < 8) throw new TypeError('password must be at least 8 characters');
  return { email, password, ok: true };
}
