import {
  pgTable,
  text,
  serial,
  timestamp,
  jsonb,
  primaryKey,
  boolean,
  integer,
  uuid,
  index,
} from "drizzle-orm/pg-core"
import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"

const DOC_TYPES = ["overview", "cfg", "delta", "release", "role"] as const
export type DocType = (typeof DOC_TYPES)[number]

const JOB_TYPES = ["generate", "analyze", "release", "role"] as const
export type JobType = (typeof JOB_TYPES)[number]

const JOB_STATUS_TYPES = ["pending", "completed", "error"] as const
export type JobStatusType = (typeof JOB_STATUS_TYPES)[number]

const INVITATION_STATUS_TYPES = ["pending", "accepted", "rejected"] as const
export type InvitationStatusType = (typeof INVITATION_STATUS_TYPES)[number]

export const ROLES = [
  "sales",
  "marketing",
  "csm",
  "revops",
  "ps",
  "executive",
] as const
export type Role = (typeof ROLES)[number]

// Define the type for metadata
export type RepoDocMetadata = {
  generatedFrom: string[]
  aiModel: string
  timestamp: string
  prompts?: Record<string, string>
}

export const prds = pgTable("prds", {
  id: serial("id"),
  publicId: text("public_id").primaryKey().unique(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  businessContext: text("business_context").notNull(),
  repoPublicId: text("repo_public_id")
    .notNull()
    .references(() => githubRepos.publicId, { onDelete: "cascade" }),
  branch: text("branch"),
})

export const githubRepos = pgTable("github_repos", {
  id: serial("id"),
  publicId: text("public_id").primaryKey().unique(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  owner: text("owner").notNull(),
  repoId: text("repo_id").notNull().unique(), // External GitHub repo ID - keep for GitHub API integration
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.publicId, { onDelete: "cascade" }),
  fileFilterRegex: text("file_filter_regex"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const organizations = pgTable("organizations", {
  id: serial("id"),
  publicId: text("public_id").primaryKey().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isPersonal: boolean("is_personal").notNull().default(true),
  slug: text("slug").notNull().unique(),
  profileImageUrl: text("profile_image_url"),
  installationId: integer("installation_id"),
  accessToken: text("access_token"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const userOrganizations = pgTable(
  "user_organizations",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.publicId, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.publicId, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner, admin, member
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })]
)

export const users = pgTable("users", {
  id: serial("id"),
  publicId: text("public_id").primaryKey().unique(),
  userSub: text("user_sub").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  themePreferences: jsonb("theme_preferences"),
})

// New tables for repository analysis
export const repoFiles = pgTable(
  "repo_files",
  {
    id: serial("id"),
    repoPublicId: text("repo_public_id")
      .notNull()
      .references(() => githubRepos.publicId, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    branch: text("branch").notNull(),
    content: text("content"), // Store the actual file content
    metadata: jsonb("metadata").notNull(), // Store file metadata like size, etc.
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repoPublicId, table.filePath, table.branch] }),
  ]
)

export const repoDocs = pgTable(
  "repo_docs",
  {
    id: serial("id"),
    repoPublicId: text("repo_public_id")
      .notNull()
      .references(() => githubRepos.publicId, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    docType: text("doc_type").$type<DocType>().notNull(),
    branch: text("branch").notNull(),
    metadata: jsonb("metadata").$type<RepoDocMetadata>().notNull(), // Typed metadata
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repoPublicId, table.docType, table.branch] }),
  ]
)

export const releases = pgTable("releases", {
  id: serial("id"),
  publicId: text("public_id").primaryKey().unique(),
  title: text("title").notNull(),
  repoPublicId: text("repo_public_id")
    .notNull()
    .references(() => githubRepos.publicId, { onDelete: "cascade" }),
  branch: text("branch").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const roles = pgTable("roles", {
  id: serial("id"),
  publicId: text("public_id").primaryKey().unique(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.publicId, { onDelete: "cascade" }),
  roleType: text("role_type").$type<Role>().notNull(),
  context: text("context").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const roleDocs = pgTable(
  "role_docs",
  {
    releasePublicId: text("release_public_id")
      .notNull()
      .references(() => releases.publicId, { onDelete: "cascade" }),
    repoPublicId: text("repo_public_id")
      .notNull()
      .references(() => githubRepos.publicId, { onDelete: "cascade" }),
    rolePublicId: text("role_public_id")
      .notNull()
      .references(() => roles.publicId, { onDelete: "cascade" }),
    document: text("doc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    primaryKey: primaryKey(
      table.releasePublicId,
      table.repoPublicId,
      table.rolePublicId
    ),
  })
)

// New table for tracking enqueued tasks
export const enqueuedTasks = pgTable("enqueued_tasks", {
  jobId: text("job_id").notNull().primaryKey(),
  branch: text("branch").notNull(),
  repoPublicId: text("repo_public_id")
    .notNull()
    .references(() => githubRepos.publicId, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.publicId),
  type: text("type").$type<JobType>().notNull(),
  status: text("status").$type<JobStatusType>().notNull(),
  message: text("message"),
  details: jsonb("details"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const invitations = pgTable(
  "invitations",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.publicId, { onDelete: "cascade" }),
    email: text("email").notNull(),
    token: uuid("token").primaryKey().defaultRandom(),
    status: text("status").$type<InvitationStatusType>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    emailIdx: index("invitations_email_idx").on(table.email),
  })
)

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
    repoPublicId: z.string().min(1, "Please select a GitHub repository"),
  })

export const insertOrganizationSchema = createInsertSchema(organizations).pick({
  name: true,
  slug: true,
  description: true,
  accessToken: true,
  profileImageUrl: true,
  installationId: true,
  isPersonal: true,
})

export const insertUserOrganizationSchema = createInsertSchema(
  userOrganizations
).pick({
  userId: true,
  organizationId: true,
  role: true,
})

export const insertGithubRepoSchema = createInsertSchema(githubRepos).pick({
  name: true,
  fullName: true,
  owner: true,
  repoId: true,
  publicId: true,
  organizationId: true,
  fileFilterRegex: true,
})

export const themePreferencesSchema = z.object({
  accentColor: z.string().optional(),
  grayColor: z.string().optional(),
  mode: z.enum(["light", "dark", "system"]).optional(),
})

export const insertUserSchema = createInsertSchema(users)
  .pick({
    userSub: true,
    themePreferences: true,
    name: true,
    email: true,
  })
  .extend({
    themePreferences: themePreferencesSchema.optional(),
  })

// New schemas for repository analysis
export const insertRepoFileSchema = createInsertSchema(repoFiles)
  .pick({
    repoPublicId: true,
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
  })

export const insertRepoDocSchema = createInsertSchema(repoDocs)
  .pick({
    repoPublicId: true,
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
  })

export const insertReleaseSchema = createInsertSchema(releases)
  .pick({
    publicId: true,
    title: true,
    repoPublicId: true,
    branch: true,
    content: true,
    updatedAt: true,
  })
  .extend({
    title: z.string().min(1, "Title is required"),
    repoPublicId: z.string().min(1, "Repository is required"),
    branch: z.string().min(1, "Branch is required"),
  })

export const insertRoleSchema = createInsertSchema(roles)
  .pick({
    publicId: true,
    organizationId: true,
    roleType: true,
    context: true,
  })
  .extend({
    publicId: z.string().min(1, "Role public ID is required"),
    organizationId: z.string().min(1, "Organization ID is required"),
    roleType: z.enum(ROLES),
    context: z.string().min(1, "Context is required"),
  })

export const insertRoleDocSchema = createInsertSchema(roleDocs)
  .pick({
    repoPublicId: true,
    releasePublicId: true,
    rolePublicId: true,
    document: true,
  })
  .extend({
    repoPublicId: z.string().min(1, "Repository is required"),
    releasePublicId: z.string().min(1, "Release public ID is required"),
    rolePublicId: z.string().min(1, "Role public ID is required"),
    document: z.string().min(1, "Document content is required"),
  })

export const insertEnqueuedTaskSchema = createInsertSchema(enqueuedTasks)
  .pick({
    jobId: true,
    branch: true,
    repoPublicId: true,
    organizationId: true,
    type: true,
    status: true,
    message: true,
    details: true,
    updatedAt: true,
  })
  .extend({
    jobId: z.string().min(1, "Job ID is required"),
    type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUS_TYPES),
    branch: z.string().min(1, "Branch is required"),
    repoPublicId: z.string().min(1, "Repository is required"),
  })

export const insertInvitationSchema = createInsertSchema(invitations)
  .pick({
    organizationId: true,
    token: true,
    email: true,
    status: true,
  })
  .extend({
    status: z.enum(INVITATION_STATUS_TYPES),
  })

// Organization types
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>
export type Organization = typeof organizations.$inferSelect
export type InsertUserOrganization = z.infer<
  typeof insertUserOrganizationSchema
>
export type UserOrganization = typeof userOrganizations.$inferSelect
export type InsertUser = z.infer<typeof insertUserSchema>
export type User = typeof users.$inferSelect
export type ThemePreferences = z.infer<typeof themePreferencesSchema>

export type InsertPrd = z.infer<typeof insertPrdSchema>
export type Prd = typeof prds.$inferSelect

export type InsertGithubRepo = z.infer<typeof insertGithubRepoSchema>
export type GithubRepo = typeof githubRepos.$inferSelect

export type InsertRepoFile = z.infer<typeof insertRepoFileSchema>
export type RepoFile = typeof repoFiles.$inferSelect
export type InsertRepoDoc = z.infer<typeof insertRepoDocSchema>
export type RepoDoc = typeof repoDocs.$inferSelect
export type InsertRelease = z.infer<typeof insertReleaseSchema>
export type Release = typeof releases.$inferSelect
export type InsertRole = z.infer<typeof insertRoleSchema>
export type RoleRecord = typeof roles.$inferSelect
export type InsertRoleDocument = z.infer<typeof insertRoleDocSchema>
export type RoleDocument = typeof roleDocs.$inferSelect

export type InsertEnqueuedTask = z.infer<typeof insertEnqueuedTaskSchema>
export type EnqueuedTask = typeof enqueuedTasks.$inferSelect
export type Invitation = typeof invitations.$inferSelect
export type InsertInvitation = z.infer<typeof insertInvitationSchema>
