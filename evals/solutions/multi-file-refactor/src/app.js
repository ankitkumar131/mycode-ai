import { fetchUser } from './api.js';
export function describe(id) {
  return fetchUser(id).name;
}
