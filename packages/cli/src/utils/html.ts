export function decodeEntities(text: string): string {
  if (!text || !text.includes('&#')) return text;
  return text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}
