import { getUser } from './api.js';
export function describe(id) {
  return getUser(id).name;
}
