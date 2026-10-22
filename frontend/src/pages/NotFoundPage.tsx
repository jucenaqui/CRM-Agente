import { Link } from 'react-router-dom';
import { EmptyState } from '../components/States';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Página no encontrada"
      description="La ruta que buscas no existe."
      action={
        <Link to="/" className="btn btn-primary btn-sm">
          Volver al inicio
        </Link>
      }
    />
  );
}
