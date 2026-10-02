import { fromA } from './a.js';
export function fromB() { return 'b' + fromA().length; }
