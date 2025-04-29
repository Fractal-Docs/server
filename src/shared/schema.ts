import {
  pgTable,
  text,
  serial,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const prds = pgTable("prds", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  businessContext: text("business_context").notNull(),
  repoId: text("repo_id").notNull(),
});

export const githubRepos = pgTable("github_repos", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  owner: text("owner").notNull(),
  repoId: text("repo_id").notNull(),
  accessToken: text("access_token").notNull(),
  fileFilterRegex: text("file_filter_regex"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const githubAuth = pgTable("github_auth", {
  id: serial("id").primaryKey(),
  accessToken: text("access_token").notNull(),
});

// New tables for repository analysis
export const repoFiles = pgTable(
  "repo_files",
  {
    id: serial("id"),
    repoId: text("repo_id").notNull(),
    filePath: text("file_path").notNull(),
    branch: text("branch").notNull(),
    content: text("content"), // Store the actual file content
    metadata: jsonb("metadata").notNull(), // Store file metadata like size, etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.filePath, table.branch] }),
  ]
);

export const repoDocs = pgTable(
  "repo_docs",
  {
    id: serial("id").primaryKey(),
    repoId: text("repo_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    docType: text("doc_type").notNull(), // e.g., 'overview', 'api', 'setup', 'cfg'
    branch: text("branch").notNull(),
    metadata: jsonb("metadata").notNull(), // Additional documentation metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoId, table.branch] })]
);

// Existing schemas
export const insertPrdSchema = createInsertSchema(prds)
  .pick({
    title: true,
    content: true,
    businessContext: true,
    repoId: true,
  })
  .extend({
    content: z.string().min(1, "Content is required"),
    businessContext: z.string().min(1, "Business context is required"),
    title: z.string().min(1, "Title is required"),
    repoId: z.string().min(1, "Please select a GitHub repository"),
  });

export const insertGithubRepoSchema = createInsertSchema(githubRepos).pick({
  name: true,
  fullName: true,
  owner: true,
  repoId: true,
  accessToken: true,
  fileFilterRegex: true,
});

export const insertGithubAuthSchema = createInsertSchema(githubAuth).pick({
  accessToken: true,
});

// New schemas for repository analysis
export const insertRepoFileSchema = createInsertSchema(repoFiles)
  .pick({
    repoId: true,
    filePath: true,
    branch: true,
    content: true,
    metadata: true,
    updatedAt: true,
  })
  .extend({
    metadata: z.object({
      size: z.number(),
      language: z.string(),
    }),
  });

export const insertRepoDocSchema = createInsertSchema(repoDocs)
  .pick({
    repoId: true,
    title: true,
    branch: true,
    content: true,
    docType: true,
    metadata: true,
    updatedAt: true,
  })
  .extend({
    docType: z.enum(["overview", "api", "setup", "architecture", "cfg"]),
    metadata: z.object({
      generatedFrom: z.array(z.string()), // List of files used to generate this doc
      aiModel: z.string(),
      timestamp: z.string(),
      prompts: z.record(z.string(), z.string()).optional(),
    }),
  });

// Existing types
export type InsertPrd = z.infer<typeof insertPrdSchema>;
export type Prd = typeof prds.$inferSelect;
export type InsertGithubRepo = z.infer<typeof insertGithubRepoSchema>;
export type GithubRepo = typeof githubRepos.$inferSelect;
export type InsertGithubAuth = z.infer<typeof insertGithubAuthSchema>;
export type GithubAuth = typeof githubAuth.$inferSelect;

// New types for repository analysis
export type InsertRepoFile = z.infer<typeof insertRepoFileSchema>;
export type RepoFile = typeof repoFiles.$inferSelect;
export type InsertRepoDoc = z.infer<typeof insertRepoDocSchema>;
export type RepoDoc = typeof repoDocs.$inferSelect;
