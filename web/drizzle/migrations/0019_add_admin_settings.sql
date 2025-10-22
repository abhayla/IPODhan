-- Migration: Add admin_settings table for notification configuration
-- Created: 2025-10-22
-- Purpose: Store admin panel configuration including email/Telegram notification settings

CREATE TABLE IF NOT EXISTS admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX idx_admin_settings_key ON admin_settings(setting_key);

-- Insert default notification settings
INSERT INTO admin_settings (setting_key, setting_value) VALUES
('notifications_config', '{"email":{"enabled":false,"smtpHost":"","smtpPort":587,"smtpUser":"","smtpPassword":"","fromEmail":""},"telegram":{"enabled":false,"botToken":"","chatId":""},"triggers":{"ipoLocked":true,"ipoUnlocked":true,"fieldProtectionEnabled":true,"fieldProtectionDisabled":true,"scraperUpdateBlocked":true,"bulkOperationCompleted":true}}')
ON CONFLICT (setting_key) DO NOTHING;

-- Add comment
COMMENT ON TABLE admin_settings IS 'Admin panel configuration settings including notification preferences';
