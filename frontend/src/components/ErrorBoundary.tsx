import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Cuando cambia (p. ej. la ruta), se descarta el error y se vuelve a intentar dibujar. */
  resetKey?: string;
  /** true: ocupa toda la pantalla (error en la raíz de la aplicación). */
  fullPage?: boolean;
}

interface State {
  failed: boolean;
}

/**
 * Red de seguridad: si algo se rompe al dibujar una pantalla, se muestra un mensaje con opciones
 * en lugar de una página en blanco. No oculta el error: se registra en la consola.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error al dibujar la pantalla:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={this.props.fullPage ? 'state state-full state-error' : 'state state-error'} role="alert">
        <strong>Algo salió mal al mostrar esta pantalla</strong>
        <span>Tus datos no se han perdido. Puedes reintentar o recargar la página; si sigue fallando, avisa a quien administre el CRM.</span>
        <div className="settings-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState({ failed: false })}>
            Reintentar
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
            Recargar la página
          </button>
        </div>
      </div>
    );
  }
}
