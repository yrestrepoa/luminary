// Estado del proceso compartido entre el servidor HTTP y los health checks.
// Al recibir SIGTERM se marca `shuttingDown`: /api/health/ready responde 503 para que el
// balanceador deje de enviar tráfico mientras se drenan las peticiones en curso.
export const lifecycle = {
  shuttingDown: false,
};
