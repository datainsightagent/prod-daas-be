-- CreateTable
CREATE TABLE `ask_sessions` (
    `session_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `data_source_id` VARCHAR(191) NOT NULL,
    `question` VARCHAR(2000) NOT NULL,
    `title` VARCHAR(200) NULL,
    `status` ENUM('processing', 'complete', 'failed') NOT NULL DEFAULT 'processing',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ask_sessions_tenant_user_updated_idx`(`tenant_id`, `user_id`, `updated_at` DESC),
    INDEX `ask_sessions_tenant_data_source_idx`(`tenant_id`, `data_source_id`),
    PRIMARY KEY (`session_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ask_sessions` ADD CONSTRAINT `ask_sessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ask_sessions` ADD CONSTRAINT `ask_sessions_data_source_id_fkey` FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`data_source_id`) ON DELETE CASCADE ON UPDATE CASCADE;
