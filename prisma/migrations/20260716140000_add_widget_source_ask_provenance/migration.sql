-- AlterTable
ALTER TABLE `widgets` ADD COLUMN `source_ask_session_id` VARCHAR(191) NULL,
    ADD COLUMN `source_message_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `widgets_source_ask_session_idx` ON `widgets`(`source_ask_session_id`);

-- CreateIndex
CREATE INDEX `widgets_source_message_idx` ON `widgets`(`source_message_id`);

-- AddForeignKey
ALTER TABLE `widgets` ADD CONSTRAINT `widgets_source_ask_session_id_fkey` FOREIGN KEY (`source_ask_session_id`) REFERENCES `ask_sessions`(`session_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `widgets` ADD CONSTRAINT `widgets_source_message_id_fkey` FOREIGN KEY (`source_message_id`) REFERENCES `messages`(`message_id`) ON DELETE SET NULL ON UPDATE CASCADE;
