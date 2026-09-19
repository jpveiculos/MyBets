CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  cash_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  reserved_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus_wager_progress NUMERIC(12,2) NOT NULL DEFAULT 0,
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
  rejected_by INTEGER REFERENCES admins(id),
  rejected_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  result INTEGER NOT NULL,
  multiplier NUMERIC(8,2) NOT NULL,
  bet_amount NUMERIC(12,2) NOT NULL,
  payout_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_status_created ON deposits(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_created ON withdrawals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spins_user_created ON spins(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

INSERT INTO site_settings(setting_key, setting_value) VALUES
('pix_enabled','true'),
('pix_key',''),
('pix_key_type','aleatoria'),
('pix_receiver_name',''),
('pix_city',''),
('pix_description','MyBets'),
('pix_instructions','Após realizar o Pix, clique em JÁ FIZ O PIX. O crédito será liberado somente após a conferência do administrador.'),
('bonus_wager_requirement','0')
ON CONFLICT (setting_key) DO NOTHING;
