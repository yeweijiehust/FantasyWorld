import { jsonb, pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const saves = pgTable("saves", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  schemaVersion: text("schema_version").notNull(),
  turnNumber: integer("turn_number").notNull(),
  saveSeed: text("save_seed").notNull(),
  settings: jsonb("settings").notNull(),
  worldMemory: jsonb("world_memory").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const characters = pgTable("characters", {
  id: text("id").primaryKey(),
  saveId: text("save_id").notNull(),
  data: jsonb("data").notNull()
});

export const locations = pgTable("locations", {
  id: text("id").primaryKey(),
  saveId: text("save_id").notNull(),
  data: jsonb("data").notNull()
});

export const relationships = pgTable("relationships", {
  id: text("id").primaryKey(),
  saveId: text("save_id").notNull(),
  data: jsonb("data").notNull()
});

export const turns = pgTable("turns", {
  id: text("id").primaryKey(),
  saveId: text("save_id").notNull(),
  turnNumber: integer("turn_number").notNull(),
  data: jsonb("data").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const turnJobs = pgTable("turn_jobs", {
  id: text("id").primaryKey(),
  saveId: text("save_id").notNull(),
  status: text("status").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const saveGenerationJobs = pgTable("save_generation_jobs", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const modelConfigs = pgTable("model_configs", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
});
