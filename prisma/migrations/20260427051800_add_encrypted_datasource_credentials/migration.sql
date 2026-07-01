-- Add encrypted credential payload for datasource passwords.
-- This keeps secret_ref for backward compatibility during rollout.
ALTER TABLE `data_sources`
ADD COLUMN `encrypted_secret_payload` JSON NULL;
