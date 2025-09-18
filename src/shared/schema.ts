import {
  pgTable,
  text,
  serial,
  timestamp,
  jsonb,
  primaryKey,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const DOC_TYPES = ["overview", "cfg", "delta"] as const;
type DocType = (typeof DOC_TYPES)[number];

export const prds = pgTable("prds", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  businessContext: text("business_context").notNull(),
  repoId: text("repo_id").notNull(),
  branch: text("branch"),
});

export const githubRepos = pgTable("github_repos", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  owner: text("owner").notNull(),
  repoId: text("repo_id").notNull(),
  organizationId: serial("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fileFilterRegex: text("file_filter_regex"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isPersonal: boolean("is_personal").notNull().default(true),
  slug: text("slug").notNull().unique(),
  profileImageUrl: text("profile_image_url"),
  installationId: integer("installation_id"),
  accessToken: text("access_token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userOrganizations = pgTable(
  "user_organizations",
  {
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: serial("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner, admin, member
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })]
);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  userSub: text("user_sub").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  themePreferences: jsonb("theme_preferences"),
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
    docType: text("doc_type").$type<DocType>().notNull(),
    branch: text("branch").notNull(),
    metadata: jsonb("metadata").notNull(), // Additional documentation metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.docType, table.branch] }),
  ]
);

// Existing schemas
export const insertPrdSchema = createInsertSchema(prds)
  .pick({
    title: true,
    content: true,
    businessContext: true,
    repoId: true,
    branch: true,
  })
  .extend({
    content: z.string().min(1, "Content is required"),
    businessContext: z.string().min(1, "Business context is required"),
    title: z.string().min(1, "Title is required"),
    repoId: z.string().min(1, "Please select a GitHub repository"),
  });

export const insertOrganizationSchema = createInsertSchema(organizations).pick({
  name: true,
  slug: true,
  description: true,
  accessToken: true,
  profileImageUrl: true,
  installationId: true,
  isPersonal: true,
});

export const insertUserOrganizationSchema = createInsertSchema(
  userOrganizations
).pick({
  userId: true,
  organizationId: true,
  role: true,
});

export const insertGithubRepoSchema = createInsertSchema(githubRepos).pick({
  name: true,
  fullName: true,
  owner: true,
  repoId: true,
  organizationId: true,
  fileFilterRegex: true,
});

export const themePreferencesSchema = z.object({
  accentColor: z.string().optional(),
  grayColor: z.string().optional(),
  mode: z.enum(["light", "dark", "system"]).optional(),
});

export const insertUserSchema = createInsertSchema(users)
  .pick({
    userSub: true,
    themePreferences: true,
    name: true,
    email: true,
  })
  .extend({
    themePreferences: themePreferencesSchema.optional(),
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
    docType: z.enum(DOC_TYPES),
    metadata: z.object({
      generatedFrom: z.array(z.string()), // List of files used to generate this doc
      aiModel: z.string(),
      timestamp: z.string(),
      prompts: z.record(z.string(), z.string()).optional(),
    }),
  });

export const releases = pgTable("releases", {
  id: serial("id").notNull(),
  releaseId: text("release_id").primaryKey(),
  title: text("title").notNull(),
  prd: text("prd").notNull(),
  repoId: text("repo_id").notNull(),
  branch: text("branch").notNull(),
  diffAnalysis: text("diff_analysis").notNull(),
  releaseDocument: text("release_document").notNull(),
  salesDocument: text("sales_document"),
  marketingDocument: text("marketing_document"),
  customerSuccessDocument: text("customer_success_document"),
  csmDocument: text("csm_document"),
  revopsDocument: text("revops_document"),
  psDocument: text("ps_document"),
  roleDocuments: jsonb("role_documents"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertReleaseSchema = createInsertSchema(releases)
  .pick({
    releaseId: true,
    title: true,
    prd: true,
    repoId: true,
    branch: true,
    diffAnalysis: true,
    releaseDocument: true,
    salesDocument: true,
    marketingDocument: true,
    customerSuccessDocument: true,
    csmDocument: true,
    revopsDocument: true,
    psDocument: true,
    roleDocuments: true,
  })
  .extend({
    title: z.string().min(1, "Title is required"),
    prd: z.string().min(1, "PRD content is required"),
    repoId: z.string().min(1, "Repository is required"),
    branch: z.string().min(1, "Branch is required"),
  });

// Organization types
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;
export type InsertUserOrganization = z.infer<
  typeof insertUserOrganizationSchema
>;
export type UserOrganization = typeof userOrganizations.$inferSelect;

// Existing types
export type InsertPrd = z.infer<typeof insertPrdSchema>;
export type Prd = typeof prds.$inferSelect;
export type InsertGithubRepo = z.infer<typeof insertGithubRepoSchema>;
export type GithubRepo = typeof githubRepos.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// New types for repository analysis
export type InsertRepoFile = z.infer<typeof insertRepoFileSchema>;
export type RepoFile = typeof repoFiles.$inferSelect;
export type InsertRepoDoc = z.infer<typeof insertRepoDocSchema>;
export type RepoDoc = typeof repoDocs.$inferSelect;
export type InsertRelease = z.infer<typeof insertReleaseSchema>;
export type Release = typeof releases.$inferSelect;
export type ThemePreferences = z.infer<typeof themePreferencesSchema>;
