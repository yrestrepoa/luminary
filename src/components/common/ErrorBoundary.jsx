import { Component } from 'react';

/**
 * Captura errores de render (y fallos al cargar un chunk perezoso) para no dejar la pantalla
 * en blanco. `resetKey`: al cambiar (p.ej. la ruta) se vuelve a intentar renderizar.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error, info) {
    // Sin servicio de reporte configurado: queda en la consola del navegador.
    console.error('[ui] error de render', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Tras un despliegue, los chunks antiguos dejan de existir: recargar trae los nuevos.
    const chunkFailed = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(
      error?.message ?? ''
    );
    return (
      <div
        role="alert"
        className="mx-auto max-w-lg rounded-2xl border border-rose-400/20 bg-rose-400/10 p-6 text-center"
      >
        <h1 className="mb-2 text-lg font-semibold text-rose-100">Algo salió mal</h1>
        <p className="mb-4 text-sm text-rose-200/80">
          {chunkFailed
            ? 'Hay una nueva versión de la aplicación. Recarga la página para continuar.'
            : 'Ocurrió un error inesperado al mostrar esta página.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl bg-rose-300 px-4 py-2 text-sm font-semibold text-slate-950"
        >
          Recargar
        </button>
      </div>
    );
  }
}
