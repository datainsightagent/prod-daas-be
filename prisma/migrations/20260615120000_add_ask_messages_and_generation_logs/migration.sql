-- CreateTable
CREATE TABLE `messages` (
    `message_id` VARCHAR(191) NOT NULL,
    `session_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `type` ENUM('user', 'assistant') NOT NULL,
    `content` TEXT NOT NULL,
    `sequence_order` INTEGER NOT NULL,
    `parent_message_id` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `messages_session_sequence_unique`(`session_id`, `sequence_order`),
    INDEX `messages_session_sequence_idx`(`session_id`, `sequence_order`),
    INDEX `messages_tenant_session_idx`(`tenant_id`, `session_id`),
    PRIMARY KEY (`message_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generation_logs` (
    `log_id` VARCHAR(191) NOT NULL,
    `session_id` VARCHAR(191) NOT NULL,
    `message_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `step` VARCHAR(100) NOT NULL,
    `level` ENUM('info', 'warn', 'error') NOT NULL DEFAULT 'info',
    `message` TEXT NOT NULL,
    `sequence_order` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `generation_logs_session_message_sequence_idx`(`session_id`, `message_id`, `sequence_order`),
    INDEX `generation_logs_tenant_session_idx`(`tenant_id`, `session_id`),
    PRIMARY KEY (`log_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `ask_sessions`(`session_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_parent_message_id_fkey` FOREIGN KEY (`parent_message_id`) REFERENCES `messages`(`message_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generation_logs` ADD CONSTRAINT `generation_logs_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `ask_sessions`(`session_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generation_logs` ADD CONSTRAINT `generation_logs_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`message_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generation_logs` ADD CONSTRAINT `generation_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
