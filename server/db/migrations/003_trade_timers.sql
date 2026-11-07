-- 003 · Temporizadores de trades (auditoría L1 / I1)
--
-- funded_at:     cuándo se registró el depósito en escrow. Sin verificación on-chain se usa para
--                replicar el plazo del contrato antes de que el VENDEDOR pueda reembolsarse en disputa.
-- cancel_reason: por qué se canceló ('expired' = trade `pending` nunca fondeado, cancelado por el
--                barrido automático; NULL = cancelado por una de las partes).
-- Índice parcial para que el barrido de trades `pending` caducados no recorra la tabla entera.

ALTER TABLE trades ADD COLUMN IF NOT EXISTS funded_at timestamptz;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS cancel_reason varchar(16);

-- Trades ya fondeados antes de esta migración: mejor aproximación disponible.
UPDATE trades SET funded_at = updated_at
 WHERE funded_at IS NULL AND escrow_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS trades_pending_created_idx ON trades (created_at) WHERE status = 'pending';
