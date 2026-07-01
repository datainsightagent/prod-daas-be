-- CreateTable
CREATE TABLE `glossary_terms` (
    `term_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `term` VARCHAR(191) NOT NULL,
    `term_normalized` VARCHAR(191) NOT NULL,
    `definition` VARCHAR(2000) NOT NULL,
    `source` ENUM('user', 'agent', 'user_onboarding') NOT NULL DEFAULT 'user_onboarding',
    `confidence` DECIMAL(4, 3) NOT NULL DEFAULT 1.000,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `glossary_terms_tenant_term_normalized_key`(`tenant_id`, `term_normalized`),
    INDEX `glossary_terms_tenant_deleted_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`term_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_rules` (
    `rule_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `expression` TEXT NOT NULL,
    `description` VARCHAR(2000) NULL,
    `source` ENUM('user', 'agent', 'user_onboarding') NOT NULL DEFAULT 'user_onboarding',
    `confidence` DECIMAL(4, 3) NOT NULL DEFAULT 1.000,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `business_rules_tenant_name_key`(`tenant_id`, `name`),
    INDEX `business_rules_tenant_deleted_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`rule_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_answers` (
    `answer_id` VARCHAR(191) NOT NULL,
    `session_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `question_text` TEXT NOT NULL,
    `answer_text` TEXT NOT NULL,
    `is_unknown` BOOLEAN NOT NULL DEFAULT false,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `onboarding_answers_tenant_session_created_idx`(`tenant_id`, `session_id`, `created_at`),
    INDEX `onboarding_answers_tenant_question_idx`(`tenant_id`, `question_id`),
    PRIMARY KEY (`answer_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entity_descriptions` (
    `entity_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `entity_type` ENUM('table', 'column') NOT NULL,
    `entity_name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(2000) NOT NULL,
    `source` ENUM('user', 'agent', 'user_onboarding') NOT NULL DEFAULT 'agent',
    `confidence` DECIMAL(4, 3) NOT NULL DEFAULT 1.000,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `entity_descriptions_tenant_entity_lookup_idx`(`tenant_id`, `entity_type`, `entity_name`),
    PRIMARY KEY (`entity_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `glossary_terms` ADD CONSTRAINT `glossary_terms_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_rules` ADD CONSTRAINT `business_rules_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_answers` ADD CONSTRAINT `onboarding_answers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entity_descriptions` ADD CONSTRAINT `entity_descriptions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
