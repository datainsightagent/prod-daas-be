-- AlterTable
ALTER TABLE `token_usage` ADD COLUMN `step` VARCHAR(100) NULL;

-- CreateIndex
CREATE INDEX `token_usage_tenant_step_idx` ON `token_usage`(`tenant_id`, `step`);
