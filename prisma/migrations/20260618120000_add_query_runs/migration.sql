-- CreateTable
CREATE TABLE `query_runs` (
    `run_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `data_source_id` VARCHAR(191) NOT NULL,
    `sql` TEXT NOT NULL,
    `purpose` ENUM('probe', 'render') NOT NULL DEFAULT 'probe',
    `status` ENUM('running', 'completed', 'failed', 'timeout', 'cancelled') NOT NULL DEFAULT 'running',
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `truncated` BOOLEAN NOT NULL DEFAULT false,
    `error_code` VARCHAR(64) NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `query_runs_tenant_data_source_started_idx`(`tenant_id`, `data_source_id`, `started_at` DESC),
    INDEX `query_runs_tenant_status_started_idx`(`tenant_id`, `status`, `started_at` DESC),
    PRIMARY KEY (`run_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `query_results` (
    `result_id` VARCHAR(191) NOT NULL,
    `run_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `schema` JSON NOT NULL,
    `rows` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `query_results_run_id_key`(`run_id`),
    INDEX `query_results_tenant_created_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`result_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `query_runs` ADD CONSTRAINT `query_runs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `query_runs` ADD CONSTRAINT `query_runs_data_source_id_fkey` FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`data_source_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `query_results` ADD CONSTRAINT `query_results_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `query_runs`(`run_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `query_results` ADD CONSTRAINT `query_results_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
