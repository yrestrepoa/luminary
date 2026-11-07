-- Luminary · esquema PostgreSQL (>= 13)
-- Idempotente (se escribió antes del registro schema_migrations; bases existentes lo re-aplican sin cambios).
-- migrate.js lo aplica en una transacción y lo registra en schema_migrations.

-- Mantiene updated_at al día en cada UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email            varchar(255) NOT NULL,
  password_hash    varchar(255) NOT NULL,
  display_name     varchar(60)  NOT NULL,
  stellar_address  char(56),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_stellar_address_key UNIQUE (stellar_address),
  CONSTRAINT users_stellar_address_format CHECK (stellar_address IS NULL OR stellar_address ~ '^G[A-Z2-7]{55}$')
);
-- Email único sin distinguir mayúsculas (sin depender de la extensión citext).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- offers
-- type 'sell' = el creador vende USDC (quien toma la oferta compra).
-- usdc_amount = USDC aún disponible; se descuenta al abrir un trade.
CREATE TABLE IF NOT EXISTS offers (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         bigint        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type            varchar(4)    NOT NULL CONSTRAINT offers_type_check CHECK (type IN ('buy', 'sell')),
  fiat_currency   char(3)       NOT NULL CONSTRAINT offers_currency_check CHECK (fiat_currency ~ '^[A-Z]{3}$'),
  fiat_price      numeric(20,4) NOT NULL CONSTRAINT offers_price_check CHECK (fiat_price > 0),
  usdc_amount     numeric(20,7) NOT NULL CONSTRAINT offers_amount_check CHECK (usdc_amount >= 0),
  min_fiat        numeric(20,2),
  max_fiat        numeric(20,2),
  payment_method  varchar(60)   NOT NULL,
  bank            varchar(60)   NOT NULL DEFAULT '',
  status          varchar(10)   NOT NULL DEFAULT 'active'
                  CONSTRAINT offers_status_check CHECK (status IN ('active', 'paused', 'closed')),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT offers_limits_check CHECK (min_fiat IS NULL OR max_fiat IS NULL OR min_fiat <= max_fiat)
);
CREATE INDEX IF NOT EXISTS offers_status_type_idx ON offers (status, type);
CREATE INDEX IF NOT EXISTS offers_user_idx ON offers (user_id);

DROP TRIGGER IF EXISTS offers_set_updated_at ON offers;
CREATE TRIGGER offers_set_updated_at BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- trades
-- Flujo: pending → paid (comprador pagó fiat) → released (vendedor envió USDC on-chain).
--        pending/paid → cancelled · paid → disputed
CREATE TABLE IF NOT EXISTS trades (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id         bigint        NOT NULL REFERENCES offers (id),
  buyer_id         bigint        NOT NULL REFERENCES users (id),
  seller_id        bigint        NOT NULL REFERENCES users (id),
  usdc_amount      numeric(20,7) NOT NULL CONSTRAINT trades_amount_check CHECK (usdc_amount > 0),
  fiat_price       numeric(20,4) NOT NULL,
  fiat_currency    char(3)       NOT NULL,
  status           varchar(10)   NOT NULL DEFAULT 'pending'
                   CONSTRAINT trades_status_check CHECK (status IN ('pending', 'paid', 'released', 'cancelled', 'disputed')),
  stellar_tx_hash  char(64),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT trades_stellar_tx_hash_key UNIQUE (stellar_tx_hash),
  CONSTRAINT trades_parties_check CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS trades_buyer_idx ON trades (buyer_id);
CREATE INDEX IF NOT EXISTS trades_seller_idx ON trades (seller_id);
CREATE INDEX IF NOT EXISTS trades_offer_idx ON trades (offer_id);

DROP TRIGGER IF EXISTS trades_set_updated_at ON trades;
CREATE TRIGGER trades_set_updated_at BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
