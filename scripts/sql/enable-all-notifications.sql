-- ENABLE-ALL-NOTIFICATIONS.SQL
-- Запустить на проде ПОСЛЕ того как убедились, что:
--   1) ENV переменные RESEND_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT_ID
--      выставлены в /etc/levelchannel/env (или wherever loaded).
--   2) systemd timers активны:
--        systemctl list-timers | grep -E "(learner-reminder|teacher-daily-digest)"
--
-- Что включает:
--   - Email-напоминания ученикам о занятиях   (default ON, фиксируем явно)
--   - Telegram-напоминания ученикам           (default OFF → ON)
--   - Daily digest учителю по email           (default OFF → ON)
--   - Daily digest учителю в Telegram         (default OFF → ON)
--   - Telegram-алерты оператору (auth/webhook/calendar/conflict probes)

BEGIN;

INSERT INTO operator_settings (key, value, description, updated_at) VALUES
  ('LEARNER_REMINDERS_EMAIL_ENABLED',    '1', 'Email-напоминания ученикам о ближайших уроках', NOW()),
  ('LEARNER_REMINDERS_TELEGRAM_ENABLED', '1', 'Telegram-напоминания ученикам о ближайших уроках', NOW()),
  ('TEACHER_DIGEST_MASTER_SWITCH',       '1', 'Daily 08:00 digest учителю по email', NOW()),
  ('TEACHER_DIGEST_TELEGRAM_ENABLED',    '1', 'Daily 08:00 digest учителю в Telegram', NOW()),
  ('TELEGRAM_ALERTS_MASTER_SWITCH',      '1', 'Operator probes (auth/webhook/calendar/conflict) в Telegram', NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = NOW();

-- Verify
SELECT key, value, updated_at FROM operator_settings
WHERE key IN (
  'LEARNER_REMINDERS_EMAIL_ENABLED',
  'LEARNER_REMINDERS_TELEGRAM_ENABLED',
  'TEACHER_DIGEST_MASTER_SWITCH',
  'TEACHER_DIGEST_TELEGRAM_ENABLED',
  'TELEGRAM_ALERTS_MASTER_SWITCH'
)
ORDER BY key;

COMMIT;
