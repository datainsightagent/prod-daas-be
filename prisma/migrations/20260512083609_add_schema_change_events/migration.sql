-- CreateTable
CREATE TABLE `schema_change_events` (
    `change_event_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `data_source_id` VARCHAR(191) NOT NULL,
    `snapshot_id` VARCHAR(191) NOT NULL,
    `previous_snapshot_id` VARCHAR(191) NULL,
    `change_type` ENUM('table_added', 'table_removed', 'column_added', 'column_removed', 'column_type_changed') NOT NULL,
    `table_name` VARCHAR(191) NULL,
    `column_name` VARCHAR(191) NULL,
    `old_value` JSON NULL,
    `new_value` JSON NULL,
    `severity` ENUM('info', 'warning', 'critical') NOT NULL,
    `acknowledged` BOOLEAN NOT NULL DEFAULT false,
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `schema_change_events_tenant_ack_created_idx`(`tenant_id`, `acknowledged`, `created_at`),
    INDEX `schema_change_events_data_source_snapshot_idx`(`data_source_id`, `snapshot_id`),
    INDEX `schema_change_events_snapshot_id_idx`(`snapshot_id`),
    INDEX `schema_change_events_prev_snapshot_id_idx`(`previous_snapshot_id`),
    PRIMARY KEY (`change_event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `schema_change_events` ADD CONSTRAINT `schema_change_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schema_change_events` ADD CONSTRAINT `schema_change_events_data_source_id_fkey` FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`data_source_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schema_change_events` ADD CONSTRAINT `schema_change_events_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `schema_snapshots`(`snapshot_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schema_change_events` ADD CONSTRAINT `schema_change_events_previous_snapshot_id_fkey` FOREIGN KEY (`previous_snapshot_id`) REFERENCES `schema_snapshots`(`snapshot_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schema_change_events` ADD CONSTRAINT `schema_change_events_acknowledged_by_fkey` FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;
