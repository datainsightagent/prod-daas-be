-- Widen widget titles so AI-provided labels are stored without truncation.
ALTER TABLE `widgets` MODIFY `title` VARCHAR(500) NOT NULL;
