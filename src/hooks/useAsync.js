import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Ejecuta `fn` al montar (y cuando cambian `deps`) y expone { data, loading, error, reload, setData }.
 * Ignora respuestas que llegan después de desmontar o de una recarga posterior.
 */
export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const callId = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  const reload = useCallback(
    async ({ silent = false } = {}) => {
      const id = ++callId.current;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const result = await run();
        if (id === callId.current) setData(result);
        return result;
      } catch (err) {
        if (id === callId.current) setError(err);
      } finally {
        if (id === callId.current) setLoading(false);
      }
    },
    [run]
  );

  useEffect(() => {
    reload();
    return () => {
      // Contador (no un nodo DOM): invalidar el valor actual es justo lo que se busca.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      callId.current++;
    };
  }, [reload]);

  return { data, loading, error, reload, setData };
}
