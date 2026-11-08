import { Link } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState.jsx';
import { ROUTES } from '../constants/routes.js';

export default function NotFound() {
  return (
    <EmptyState title="Página no encontrada" text="La dirección que buscas no existe.">
      <Link to={ROUTES.market} className="text-sm font-medium text-stellar-yellow hover:text-stellar-yellow-hover">
        Volver al mercado
      </Link>
    </EmptyState>
  );
}
