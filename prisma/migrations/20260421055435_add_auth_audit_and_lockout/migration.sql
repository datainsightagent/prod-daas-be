-- CreateTable
CREATE TABLE `login_failure_attempts` (
    `login_failure_attempt_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `tenant_slug` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_failures_lookup_idx`(`email`, `tenant_slug`, `created_at`),
    PRIMARY KEY (`login_failure_attempt_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `audit_log_id` VARCHAR(191) NOT NULL,
    `event` ENUM('auth_login', 'auth_refresh', 'auth_logout') NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `tenant_id` VARCHAR(191) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_event_created_at_idx`(`event`, `created_at`),
    INDEX `audit_logs_user_id_idx`(`user_id`),
    INDEX `audit_logs_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`audit_log_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE SET NULL ON UPDATE CASCADE;
