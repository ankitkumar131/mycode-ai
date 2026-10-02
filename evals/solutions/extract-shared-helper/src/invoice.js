import { roundMoney } from './money.js';

export function invoiceTotal(cents) {
  return roundMoney(cents);
}
