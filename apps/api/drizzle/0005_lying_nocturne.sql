CREATE TABLE "player_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"save_id" text NOT NULL,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "save_collaborators" (
	"id" text PRIMARY KEY NOT NULL,
	"save_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"character_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "save_collaborators_save_user_unique" ON "save_collaborators" USING btree ("save_id","user_id");