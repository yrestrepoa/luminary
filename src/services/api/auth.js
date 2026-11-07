import { api } from './client.js';

/** @returns {Promise<import('../../types/index.js').User>} */
export const register = (data) => api.post('/auth/register', data).then((r) => r.user);
export const login = (email, password) => api.post('/auth/login', { email, password }).then((r) => r.user);
export const logout = () => api.post('/auth/logout');
export const getMe = () => api.get('/auth/me').then((r) => r.user);
