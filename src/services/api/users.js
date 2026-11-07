import { api } from './client.js';

/** Actualiza el perfil propio. `stellarAddress: null` desvincula la dirección. */
export const updateProfile = (data) => api.patch('/users/me', data).then((r) => r.user);
