-- CreateTable
CREATE TABLE `db_engine` (
    `code` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `query_type` VARCHAR(191) NOT NULL,
    `connection_params_schema` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_sources` (
    `data_source_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `host` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL,
    `database_name` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `connection_mode` ENUM('secret_ref', 'inline_dev') NOT NULL DEFAULT 'secret_ref',
    `secret_ref` VARCHAR(191) NULL,
    `status` ENUM('pending', 'connecting', 'connected', 'error', 'deleted') NOT NULL DEFAULT 'pending',
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `data_sources_tenant_id_idx`(`tenant_id`),
    INDEX `data_sources_type_idx`(`type`),
    INDEX `data_sources_status_idx`(`status`),
    PRIMARY KEY (`data_source_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `connection_status` (
    `status_id` VARCHAR(191) NOT NULL,
    `data_source_id` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'connecting', 'connected', 'error', 'deleted') NOT NULL,
    `last_checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `error_code` VARCHAR(191) NULL,
    `error_message` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `connection_status_data_source_created_idx`(`data_source_id`, `created_at`),
    PRIMARY KEY (`status_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `data_sources` ADD CONSTRAINT `data_sources_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_sources` ADD CONSTRAINT `data_sources_type_fkey` FOREIGN KEY (`type`) REFERENCES `db_engine`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `connection_status` ADD CONSTRAINT `connection_status_data_source_id_fkey` FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`data_source_id`) ON DELETE CASCADE ON UPDATE CASCADE;
