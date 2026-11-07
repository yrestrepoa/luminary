import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthCard, { AuthLink } from '../components/auth/AuthCard.jsx';
import FormField from '../components/common/FormField.jsx';
import Button from '../components/common/Button.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { ROUTES } from '../constants/routes.js';

/** Validación local (el servidor vuelve a validar todo). */
function validateForm({ displayName, email, password, confirm }) {
  const e = {};
  if (displayName.trim().length < 2) e.displayName = 'Mínimo 2 caracteres';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Email inválido';
  if (password.length < 8) e.password = 'Mínimo 8 caracteres';
  else if (new TextEncoder().encode(password).length > 72) e.password = 'Máximo 72 bytes';
  if (confirm !== password) e.confirm = 'Las contraseñas no coinciden';
  return e;
}

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const local = validateForm(form);
    setDetails(local);
    if (Object.keys(local).length) return;

    setLoading(true);
    try {
      await register({ displayName: form.displayName.trim(), email: form.email.trim(), password: form.password });
      navigate(ROUTES.profile, { replace: true, state: { welcome: true } });
    } catch (err) {
      setError(err.message);
      setDetails(err.details ?? {});
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Crea tu cuenta"
      subtitle="Compra y vende USDC con tu moneda local."
      footer={<>¿Ya tienes cuenta? <AuthLink to={ROUTES.login}>Inicia sesión</AuthLink></>}
    >
      <ErrorBanner>{error}</ErrorBanner>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label="Nombre visible" name="displayName" autoComplete="nickname" maxLength={60} value={form.displayName} onChange={onChange} error={details.displayName} hint="Así te verán otros usuarios en el mercado." />
        <FormField label="Email" name="email" type="email" autoComplete="email" value={form.email} onChange={onChange} error={details.email} />
        <FormField label="Contraseña" name="password" type="password" autoComplete="new-password" value={form.password} onChange={onChange} error={details.password} hint="Mínimo 8 caracteres." />
        <FormField label="Confirmar contraseña" name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={onChange} error={details.confirm} />
        <Button type="submit" loading={loading} loadingText="Creando cuenta…" className="mt-2 py-2.5">
          Crear cuenta
        </Button>
      </form>
    </AuthCard>
  );
}
