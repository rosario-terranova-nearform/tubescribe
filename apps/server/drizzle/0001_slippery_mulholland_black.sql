CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chunks_video_id_idx` ON `chunks` (`video_id`);--> statement-breakpoint
CREATE INDEX `chunks_source_id_idx` ON `chunks` (`source_id`);--> statement-breakpoint
CREATE TABLE `embed_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
