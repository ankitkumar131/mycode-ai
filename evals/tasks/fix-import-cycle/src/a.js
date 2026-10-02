import { fromB } from './b.js';
export function fromA() { return 'a'; }
export function combined() { return fromA() + fromB(); }
