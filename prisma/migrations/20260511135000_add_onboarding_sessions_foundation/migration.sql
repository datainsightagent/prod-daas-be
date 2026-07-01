-- AlterTable
ALTER TABLE `data_sources`
ADD COLUMN `onboarded` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `onboarding_sessions` (
    `session_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `data_source_id` VARCHAR(191) NOT NULL,
    `snapshot_id` VARCHAR(191) NOT NULL,
    `status` ENUM('active', 'waiting_for_answers', 'complete', 'abandoned') NOT NULL DEFAULT 'active',
    `round_number` INTEGER NOT NULL DEFAULT 0,
    `question_count` INTEGER NOT NULL DEFAULT 0,
    `confidence` DECIMAL(4, 3) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `onboarding_sessions_tenant_data_source_created_idx`(`tenant_id`, `data_source_id`, `created_at`),
    INDEX `onboarding_sessions_tenant_status_updated_idx`(`tenant_id`, `status`, `updated_at`),
    PRIMARY KEY (`session_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `onboarding_answers`
ADD CONSTRAINT `onboarding_answers_session_id_fkey`
FOREIGN KEY (`session_id`) REFERENCES `onboarding_sessions`(`session_id`)
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_sessions`
ADD CONSTRAINT `onboarding_sessions_tenant_id_fkey`
FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`)
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_sessions`
ADD CONSTRAINT `onboarding_sessions_data_source_id_fkey`
FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`data_source_id`)
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_sessions`
ADD CONSTRAINT `onboarding_sessions_snapshot_id_fkey`
FOREIGN KEY (`snapshot_id`) REFERENCES `schema_snapshots`(`snapshot_id`)
ON DELETE RESTRICT ON UPDATE CASCADE;
