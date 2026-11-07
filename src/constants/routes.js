/** Rutas de la aplicación. */
export const ROUTES = {
  market: '/',
  login: '/login',
  register: '/register',
  dashboard: '/dashboard',
  createOffer: '/offers/new',
  myOffers: '/my-offers',
  trade: (id = ':id') => `/trades/${id}`,
  profile: '/profile',
};
