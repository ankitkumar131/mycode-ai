import { fetchUser } from './api.js';
export const first = () => fetchUser(1).name;
