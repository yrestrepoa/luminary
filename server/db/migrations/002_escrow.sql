-- 002 · Escrow on-chain (contrato Soroban luminary-escrow)
-- Idempotente; migrate.js lo aplica después de schema.sql, en la misma transacción.
--
-- Flujo nuevo: pending → funded (vendedor depositó el USDC en el contrato)
--              → paid (comprador pagó fiat) → released (contrato envió el USDC al comprador)
--              funded/paid/disputed → refunded (contrato devolvió el USDC al vendedor)
--              pending → cancelled · paid → disputed

ALTER TABLE trades ADD COLUMN IF NOT EXISTS escrow_contract_id char(56);
-- Hash de la transacción `create` (depósito en escrow). stellar_tx_hash guarda la de cierre (release/refund).
ALTER TABLE trades ADD COLUMN IF NOT EXISTS escrow_tx_hash char(64);
-- Direcciones con las que se creó el escrow (clave on-chain = (seller, trade_id)); no cambian
-- aunque el usuario cambie su dirección en el perfil después.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS escrow_seller char(56);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS escrow_buyer char(56);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS escrow_refund_after_ledger integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_escrow_tx_hash_key') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_escrow_tx_hash_key UNIQUE (escrow_tx_hash);
  END IF;
END $$;

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_status_check;
ALTER TABLE trades ADD CONSTRAINT trades_status_check
  CHECK (status IN ('pending', 'funded', 'paid', 'released', 'refunded', 'cancelled', 'disputed'));
