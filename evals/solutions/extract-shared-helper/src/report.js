import { roundMoney } from './money.js';

export function reportTotal(cents) {
  return '$' + roundMoney(cents).toFixed(2);
}
