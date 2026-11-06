import { getUser } from './api.js';
export const first = () => getUser(1).name;
