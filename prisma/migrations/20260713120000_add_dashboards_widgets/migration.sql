-- CreateTable
CREATE TABLE `dashboards` (
    `dashboard_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(2000) NULL,
    `layout_version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('active', 'archived') NOT NULL DEFAULT 'active',
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dashboards_tenant_status_updated_idx`(`tenant_id`, `status`, `updated_at` DESC),
    INDEX `dashboards_tenant_created_by_idx`(`tenant_id`, `created_by`),
    PRIMARY KEY (`dashboard_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `query_definitions` (
    `query_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `data_source_id` VARCHAR(191) NOT NULL,
    `sql` TEXT NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` ENUM('active', 'archived') NOT NULL DEFAULT 'active',
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `query_definitions_tenant_status_updated_idx`(`tenant_id`, `status`, `updated_at` DESC),
    INDEX `query_definitions_tenant_data_source_idx`(`tenant_id`, `data_source_id`),
    PRIMARY KEY (`query_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `widgets` (
    `widget_id` VARCHAR(191) NOT NULL,
    `dashboard_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `query_id` VARCHAR(191) NOT NULL,
    `component_spec` JSON NOT NULL,
    `layout` JSON NOT NULL,
    `status` ENUM('active', 'archived') NOT NULL DEFAULT 'active',
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `widgets_tenant_dashboard_status_idx`(`tenant_id`, `dashboard_id`, `status`),
    INDEX `widgets_tenant_query_idx`(`tenant_id`, `query_id`),
    PRIMARY KEY (`widget_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dashboards` ADD CONSTRAINT `dashboards_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `query_definitions` ADD CONSTRAINT `query_definitions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `query_definitions` ADD CONSTRAINT `query_definitions_data_source_id_fkey` FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`data_source_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `widgets` ADD CONSTRAINT `widgets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `widgets` ADD CONSTRAINT `widgets_dashboard_id_fkey` FOREIGN KEY (`dashboard_id`) REFERENCES `dashboards`(`dashboard_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `widgets` ADD CONSTRAINT `widgets_query_id_fkey` FOREIGN KEY (`query_id`) REFERENCES `query_definitions`(`query_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
