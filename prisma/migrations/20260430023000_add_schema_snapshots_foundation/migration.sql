-- CreateTable
CREATE TABLE `schema_snapshots` (
    `snapshot_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `data_source_id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(3) NULL,
    `next_retry_at` DATETIME(3) NULL,
    `captured_at` DATETIME(3) NULL,
    `status` ENUM('queued', 'running', 'ready', 'error') NOT NULL DEFAULT 'queued',
    `error_code` VARCHAR(191) NULL,
    `error_message` VARCHAR(1024) NULL,
    `payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `schema_snapshots_tenant_data_source_version_desc_idx`(`tenant_id`, `data_source_id`, `version` DESC),
    INDEX `schema_snapshots_status_idx`(`status`),
    INDEX `schema_snapshots_claim_lookup_idx`(`status`, `next_retry_at`, `created_at`),
    INDEX `schema_snapshots_data_source_captured_idx`(`data_source_id`, `captured_at`),
    UNIQUE INDEX `schema_snapshots_tenant_data_source_version_key`(`tenant_id`, `data_source_id`, `version`),
    PRIMARY KEY (`snapshot_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `schema_snapshots` ADD CONSTRAINT `schema_snapshots_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schema_snapshots` ADD CONSTRAINT `schema_snapshots_data_source_id_fkey` FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`data_source_id`) ON DELETE CASCADE ON UPDATE CASCADE;
