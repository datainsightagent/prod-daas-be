-- Extend audit event enum for schema snapshot retention audit entry.
ALTER TABLE `audit_logs`
MODIFY COLUMN `event` ENUM(
  'auth_login',
  'auth_refresh',
  'auth_logout',
  'schema_snapshot_pruned'
) NOT NULL;
