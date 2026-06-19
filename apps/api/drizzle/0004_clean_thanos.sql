CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_id" text;--> statement-breakpoint
INSERT INTO "users" ("id", "username", "role", "created_at") VALUES ('user_admin', 'admin', 'admin', now());--> statement-breakpoint
UPDATE "saves" SET "owner_user_id" = 'user_admin' WHERE "owner_user_id" IS NULL;--> statement-breakpoint
UPDATE "sessions" SET "user_id" = 'user_admin' WHERE "user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");
