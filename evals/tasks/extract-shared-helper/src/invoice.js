export function invoiceTotal(cents) {
  const rounded = Math.round(cents) / 100;
  return rounded;
}
