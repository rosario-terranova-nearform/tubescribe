-- bots.model → bots.model_override, now nullable (null = fall back to the
-- settings default chat model). SQLite cannot alter a column's nullability
-- in place, so the table is rebuilt.
--
-- Two SQLite gotchas handled here:
--  1. The drizzle migrator wraps all migrations in a single transaction,
--     which makes `PRAGMA foreign_keys=OFF` a no-op — `defer_foreign_keys`
--     instead delays FK checks (bot_sources/chats → bots) until COMMIT,
--     when the rebuilt bots table is back in place.
--  2. Dropping a table with FK enforcement active runs an implicit DELETE,
--     which cascades (bot_sources, chats, then messages). The child rows
--     are snapshotted into temp tables first and restored afterwards.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_bots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`system_prompt` text NOT NULL,
	`model_override` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_bots`(`id`, `name`, `system_prompt`, `model_override`, `created_at`, `updated_at`)
SELECT `id`, `name`, `system_prompt`, `model`, `created_at`, `updated_at` FROM `bots`;--> statement-breakpoint
CREATE TEMPORARY TABLE `__ts_bot_sources` AS SELECT `bot_id`, `source_id` FROM `bot_sources`;--> statement-breakpoint
CREATE TEMPORARY TABLE `__ts_chats` AS SELECT `id`, `bot_id`, `title`, `created_at`, `updated_at` FROM `chats`;--> statement-breakpoint
CREATE TEMPORARY TABLE `__ts_messages` AS SELECT `id`, `chat_id`, `role`, `content`, `citations`, `created_at` FROM `messages`;--> statement-breakpoint
DROP TABLE `bots`;--> statement-breakpoint
ALTER TABLE `__new_bots` RENAME TO `bots`;--> statement-breakpoint
INSERT INTO `bot_sources`(`bot_id`, `source_id`) SELECT `bot_id`, `source_id` FROM `__ts_bot_sources`;--> statement-breakpoint
INSERT INTO `chats`(`id`, `bot_id`, `title`, `created_at`, `updated_at`) SELECT `id`, `bot_id`, `title`, `created_at`, `updated_at` FROM `__ts_chats`;--> statement-breakpoint
INSERT INTO `messages`(`id`, `chat_id`, `role`, `content`, `citations`, `created_at`) SELECT `id`, `chat_id`, `role`, `content`, `citations`, `created_at` FROM `__ts_messages`;--> statement-breakpoint
DROP TABLE `__ts_bot_sources`;--> statement-breakpoint
DROP TABLE `__ts_chats`;--> statement-breakpoint
DROP TABLE `__ts_messages`;
