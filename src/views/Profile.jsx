import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import FormField from '../components/common/FormField.jsx';
import Button from '../components/common/Button.jsx';
import NoticeBanner from '../components/common/NoticeBanner.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useWallet } from '../hooks/useWallet.js';
import { EXPLORER_ACCOUNT_URL } from '../config/stellar.js';
import { fmtDate } from '../utils/format.js';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const { address, connect, connecting, error: walletError } = useWallet();
  const location = useLocation();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [nameError, setNameError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(
    location.state?.welcome
      ? { kind: 'ok', text: '¡Cuenta creada! Vincula tu wallet Stellar para empezar a operar.' }
      : null
  );

  const save = async (key, data, okText) => {
    setBusy(key);
    setNotice(null);
    setNameError(null);
    try {
      await updateProfile(data);
      setNotice({ kind: 'ok', text: okText });
    } catch (err) {
      if (err.details?.displayName) setNameError(err.details.displayName);
      setNotice({ kind: 'err', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const linked = user.stellarAddress;
  const canLink = address && address !== linked;

  return (
    <>
      <PageHeader title="Perfil y ajustes" subtitle={`Miembro desde ${fmtDate(user.createdAt)}`} />
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Cuenta">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save('name', { displayName: displayName.trim() }, 'Nombre actualizado');
            }}
            className="flex flex-col gap-4"
          >
            <FormField label="Email" name="email" value={user.email} disabled readOnly />
            <FormField
              label="Nombre visible"
              name="displayName"
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              error={nameError}
            />
            <div>
              <Button
                type="submit"
                loading={busy === 'name'}
                disabled={displayName.trim() === user.displayName || displayName.trim().length < 2}
              >
                Guardar
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Wallet Stellar">
          <p className="mb-4 text-sm text-stellar-gray-muted">
            La dirección vinculada es donde recibirás USDC y desde la que liberas tus ventas. Se toma de Freighter para
            evitar errores de copia.
          </p>

          <div className="mb-4 rounded-xl bg-stellar-dark/50 p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Dirección vinculada</p>
            {linked ? (
              <a
                href={EXPLORER_ACCOUNT_URL + linked}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all font-mono text-sm hover:text-stellar-yellow-hover"
              >
                {linked} ↗
              </a>
            ) : (
              <p className="mt-1 text-sm text-stellar-gray-muted">Ninguna</p>
            )}
          </div>

          {walletError && <p className="mb-3 text-sm text-stellar-danger">{walletError}</p>}

          <div className="flex flex-wrap gap-2">
            {!address ? (
              <Button onClick={connect} loading={connecting} loadingText="Conectando…">
                Conectar Freighter
              </Button>
            ) : canLink ? (
              <Button
                loading={busy === 'link'}
                onClick={() => save('link', { stellarAddress: address }, 'Dirección Stellar vinculada')}
              >
                {linked ? 'Reemplazar por' : 'Vincular'} {address.slice(0, 4)}…{address.slice(-4)}
              </Button>
            ) : (
              <p className="text-sm text-stellar-teal-hover">✓ Freighter coincide con tu dirección vinculada</p>
            )}
            {linked && (
              <Button
                variant="ghost"
                loading={busy === 'unlink'}
                onClick={() =>
                  window.confirm('¿Desvincular la dirección Stellar?') &&
                  save('unlink', { stellarAddress: null }, 'Dirección desvinculada')
                }
              >
                Desvincular
              </Button>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
