import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AuthCard, { AuthLink } from '../components/auth/AuthCard.jsx';
import FormField from '../components/common/FormField.jsx';
import Button from '../components/common/Button.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { ROUTES } from '../constants/routes.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDetails({});
    try {
      await login(form.email.trim(), form.password);
      navigate(location.state?.from?.pathname ?? ROUTES.dashboard, { replace: true });
    } catch (err) {
      setError(err.message);
      setDetails(err.details ?? {});
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Inicia sesión"
      subtitle="Accede para publicar ofertas y operar USDC."
      footer={<>¿No tienes cuenta? <AuthLink to={ROUTES.register}>Regístrate</AuthLink></>}
    >
      <ErrorBanner>{error}</ErrorBanner>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label="Email" name="email" type="email" autoComplete="email" required value={form.email} onChange={onChange} error={details.email} />
        <FormField label="Contraseña" name="password" type="password" autoComplete="current-password" required value={form.password} onChange={onChange} error={details.password} />
        <Button type="submit" loading={loading} loadingText="Entrando…" className="mt-2 py-2.5">
          Entrar
        </Button>
      </form>
    </AuthCard>
  );
}
