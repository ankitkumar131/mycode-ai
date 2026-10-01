export async function request(send) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await send();
    } catch (err) {
      lastError = err;
      const status = err?.status ?? err?.statusCode;
      if (typeof status === 'number' && status >= 400 && status < 500) throw err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 10 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}
