-- CreateTable
CREATE TABLE `token_usage` (
    `usage_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `session_type` ENUM('ask', 'onboarding') NOT NULL,
    `ask_session_id` VARCHAR(191) NULL,
    `onboarding_session_id` VARCHAR(191) NULL,
    `message_id` VARCHAR(191) NULL,
    `model` VARCHAR(120) NOT NULL,
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `total_tokens` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `token_usage_tenant_created_idx`(`tenant_id`, `created_at`),
    INDEX `token_usage_ask_session_created_idx`(`ask_session_id`, `created_at`),
    INDEX `token_usage_onboarding_session_created_idx`(`onboarding_session_id`, `created_at`),
    INDEX `token_usage_message_idx`(`message_id`),
    PRIMARY KEY (`usage_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `token_usage` ADD CONSTRAINT `token_usage_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `token_usage` ADD CONSTRAINT `token_usage_ask_session_id_fkey` FOREIGN KEY (`ask_session_id`) REFERENCES `ask_sessions`(`session_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `token_usage` ADD CONSTRAINT `token_usage_onboarding_session_id_fkey` FOREIGN KEY (`onboarding_session_id`) REFERENCES `onboarding_sessions`(`session_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `token_usage` ADD CONSTRAINT `token_usage_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`message_id`) ON DELETE SET NULL ON UPDATE CASCADE;
