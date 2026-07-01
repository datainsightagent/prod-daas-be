-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `provisioned_at` DATETIME(3) NULL,
    ADD COLUMN `provisioning_error` VARCHAR(1024) NULL,
    ADD COLUMN `provisioning_status` ENUM('pending', 'ready', 'failed') NOT NULL DEFAULT 'ready',
    ADD COLUMN `tenant_db_host` VARCHAR(191) NULL,
    ADD COLUMN `tenant_db_name` VARCHAR(191) NULL,
    ADD COLUMN `tenant_db_port` INTEGER NULL;
