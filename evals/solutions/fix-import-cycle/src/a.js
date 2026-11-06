export function fromA() { return 'a'; }
import { fromB } from './b.js';
export function combined() { return fromA() + fromB(); }
