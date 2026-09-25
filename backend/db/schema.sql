CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  cpf VARCHAR(11),
  password_hash TEXT NOT NULL,
  cash_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  play_credits NUMERIC(12,2) NOT NULL DEFAULT 0,
  reserved_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  banned_at TIMESTAMP,
  banned_reason TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(128) PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2),
  reference_id INTEGER,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deposits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  approved_amount NUMERIC(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(30) NOT NULL DEFAULT 'pix',
  player_note TEXT,
  admin_note TEXT,
  approved_by INTEGER REFERENCES admins(id),
  approved_at TIMESTAMP,
  rejected_by INTEGER REFERENCES admins(id),
  rejected_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE deposits ADD COLUMN IF NOT EXISTS approved_amount NUMERIC(12,2);

CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  withdrawal_method VARCHAR(30) NOT NULL DEFAULT 'pix',
  pix_key TEXT,
  player_note TEXT,
  admin_note TEXT,
  rejection_reason TEXT,
  approved_by INTEGER REFERENCES admins(id),
  approved_at TIMESTAMP,
  paid_by INTEGER REFERENCES admins(id),
  paid_at TIMESTAMP,
  rejected_by INTEGER REFERENCES admins(id),
  rejected_at TIMESTAMP,
  refunded_by INTEGER REFERENCES admins(id),
  refunded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS paid_by INTEGER REFERENCES admins(id);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS refunded_by INTEGER REFERENCES admins(id);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_type VARCHAR(20) NOT NULL,
  actor_id INTEGER,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(40),
  target_id INTEGER,
  details JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spins (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id VARCHAR(40) NOT NULL DEFAULT 'roulette',
  result_code VARCHAR(80),
  result INTEGER NOT NULL DEFAULT 0,
  multiplier NUMERIC(8,2) NOT NULL,
  bet_amount NUMERIC(12,2) NOT NULL,
  payout_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_user_created ON deposits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_created ON withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_created ON audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_status_created ON deposits(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created ON withdrawals(status, created_at DESC);
ALTER TABLE spins ADD COLUMN IF NOT EXISTS game_id VARCHAR(40) NOT NULL DEFAULT 'roulette';
ALTER TABLE spins ADD COLUMN IF NOT EXISTS result_code VARCHAR(80);
CREATE INDEX IF NOT EXISTS idx_spins_user_game_created ON spins(user_id, game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spins_user_created ON spins(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_push_admin ON admin_push_subscriptions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

INSERT INTO site_settings(setting_key, setting_value) VALUES
('pix_enabled','true'),
('pix_key','6cb0b574-4fd1-40ad-bfd3-5065b6c6e897'),
('pix_key_type','aleatoria'),
('pix_receiver_name',''),
('pix_city',''),
('pix_description','MyBets'),
('pix_instructions','Após realizar o Pix, informe o valor enviado e solicite a conferência. O saldo será liberado somente após a conferência do administrador.'),
('signup_bonus_amount','50'),
('deposit_bonus_percent','10'),
('roulette_min_bet','0.50'),
('roulette_max_bet','100.00'),
('audit_log_retention_days','30')
ON CONFLICT (setting_key) DO NOTHING;

UPDATE site_settings SET setting_value='true',updated_at=CURRENT_TIMESTAMP
 WHERE setting_key='pix_enabled' AND NULLIF(TRIM(setting_value),'') IS NULL;
UPDATE site_settings SET setting_value='6cb0b574-4fd1-40ad-bfd3-5065b6c6e897',updated_at=CURRENT_TIMESTAMP
 WHERE setting_key='pix_key' AND NULLIF(TRIM(setting_value),'') IS NULL;
UPDATE site_settings SET setting_value='aleatoria',updated_at=CURRENT_TIMESTAMP
 WHERE setting_key='pix_key_type' AND NULLIF(TRIM(setting_value),'') IS NULL;


ALTER TABLE users ADD COLUMN IF NOT EXISTS play_credits NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf VARCHAR(11);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_cpf ON users(cpf) WHERE cpf IS NOT NULL;

CREATE TABLE IF NOT EXISTS signup_bonus_claims (
  id SERIAL PRIMARY KEY,
  cpf VARCHAR(11) NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bonus_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;


-- Mercado Pago / pagamentos automáticos
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(30) NOT NULL DEFAULT 'manual_pix';
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS mercadopago_order_id VARCHAR(80);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS mercadopago_checkout_url TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS mercadopago_status VARCHAR(40);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS mercadopago_status_detail VARCHAR(80);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS mercadopago_paid_amount NUMERIC(12,2);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS mercadopago_updated_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposits_mercadopago_order
  ON deposits(mercadopago_order_id)
  WHERE mercadopago_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deposits_payment_provider
  ON deposits(payment_provider, mercadopago_status, created_at DESC);
