import {
  prds,
  githubRepos,
  users,
  repoFiles,
  repoDocs,
  type Prd,
  type InsertPrd,
  type GithubRepo,
  type InsertGithubRepo,
  type User,
  type InsertUser,
  type RepoFile,
  type InsertRepoFile,
  type RepoDoc,
  type InsertRepoDoc,
  Release,
  InsertRelease,
  releases,
  organizations,
  userOrganizations,
  type Organization,
  type InsertOrganization,
  type UserOrganization,
  type InsertUserOrganization,
  EnqueuedTask,
  InsertEnqueuedTask,
  enqueuedTasks,
  JobType,
  InsertRoleDocument,
  roleDocs,
  RoleDocument,
  roles,
  InsertRole,
  RoleRecord,
  Role,
  JobStatusType,
  Invitation,
  invitations,
  DocType,
} from "./shared/schema"
import { db } from "./db"
import { eq, like, inArray, and, lt } from "drizzle-orm"
import { publicIdGenerators } from "./lib/public-ids"

type UserRole = "owner" | "admin" | "member"

export interface OrganizationMember
  extends Omit<User, "themePreferences" | "createdAt" | "updatedAt"> {
  role: UserRole
}

export interface IStorage {
  // PRD operations
  getPrds(organizationId: string): Promise<Prd[]>
  getPrdByPublicId(publicId: string): Promise<Prd | undefined>
  createPrd(prd: InsertPrd): Promise<Prd>
  updatePrdByPublicId(publicId: string, prd: InsertPrd): Promise<Prd>
  deletePrdByPublicId(publicId: string): Promise<void>
  searchPrds(organizationId: string, query: string): Promise<Prd[]>

  // GitHub repo operations
  getRepos(organizationId: string): Promise<GithubRepo[]>
  getRepoByPublicId(publicId: string): Promise<GithubRepo | undefined>
  createRepo(repo: InsertGithubRepo): Promise<GithubRepo>
  updateRepoByPublicId(
    publicId: string,
    repo: Partial<InsertGithubRepo>
  ): Promise<GithubRepo>
  deleteRepoByPublicId(publicId: string): Promise<void[]>

  // GitHub auth operations
  getUser(user_sub: string): Promise<User | undefined>
  getUserByPublicId(publicId: string): Promise<User | undefined>
  createUser(user: InsertUser): Promise<User>
  updateUser(user: InsertUser): Promise<User>

  // Repository file analysis operations
  getRepoFiles(repoPublicId: string, branchName: string): Promise<RepoFile[]>
  createRepoFile(file: InsertRepoFile): Promise<RepoFile>
  getRepoFile(
    repoPublicId: string,
    filePath: string,
    branchName: string
  ): Promise<RepoFile | undefined>
  updateRepoFile(
    id: number,
    branch: string,
    file: Partial<InsertRepoFile>
  ): Promise<RepoFile>
  deleteRepoFile(id: number): Promise<void>

  // Repository documentation operations
  getOrganizationDocs(orgId: string): Promise<RepoDoc[]>
  getRepoDocs(repoPublicId: string): Promise<RepoDoc[]>
  getRepoDocsByBranch(
    repoPublicId: string,
    branchName: string
  ): Promise<RepoDoc[]>
  createRepoDoc(doc: InsertRepoDoc): Promise<RepoDoc>
  getRepoDoc(
    repoPublicId: string,
    branchName: string,
    docType: DocType
  ): Promise<RepoDoc | undefined>
  updateRepoDoc(id: number, doc: Partial<InsertRepoDoc>): Promise<RepoDoc>
  deleteRepoDoc(id: number): Promise<void>

  // Release operations
  getOrganizationReleases(orgId: string): Promise<Release[]>
  getReleases(repoPublicId: string): Promise<Release[]>
  getRelease(publicId: string): Promise<Release | undefined>
  getReleaseByBranch(
    repoPublicId: string,
    branch: string
  ): Promise<Release | undefined>
  createRelease(release: Omit<InsertRelease, "publicId">): Promise<Release>
  updateRelease(
    publicId: string,
    release: Partial<InsertRelease>
  ): Promise<Release>
  deleteRelease(publicId: string): Promise<void>

  // Role management operations
  createRole(role: Omit<InsertRole, "publicId">): Promise<RoleRecord>
  getRole(publicId: string): Promise<RoleRecord | undefined>
  getRoleByOrgAndType(
    organizationId: string,
    roleType: Role
  ): Promise<RoleRecord | undefined>
  getRolesByOrganization(organizationId: string): Promise<RoleRecord[]>
  updateRole(publicId: string, role: Partial<InsertRole>): Promise<RoleRecord>
  deleteRole(publicId: string): Promise<void>

  // Role document operations
  createRoleDoc(role: InsertRoleDocument): Promise<RoleDocument>
  updateRoleDoc(role: InsertRoleDocument): Promise<RoleDocument>
  getRoleDocsForRelease(releasePublicId: string): Promise<RoleDocument[]>
  deleteRoleDocsForRelease(releasePublicId: string): Promise<void>

  getOrganization(publicId: string): Promise<Organization | undefined>
  getOrganizationByPublicId(publicId: string): Promise<Organization | undefined>
  getOrganizationsByUserId(userId: string): Promise<Organization[]>
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>
  createOrganization(org: InsertOrganization): Promise<Organization>
  updateOrganization(
    orgSlug: string,
    org: Partial<InsertOrganization>
  ): Promise<Organization>
  deleteOrganization(publicId: string): Promise<void>
  getUsersInOrganization(publicId: string): Promise<OrganizationMember[]>
  addUserToOrganization(
    userOrg: InsertUserOrganization
  ): Promise<UserOrganization>
  removeUserFromOrganization(
    userId: string,
    organizationId: string
  ): Promise<void>
  updateUserOrganizationRole(
    userId: string,
    organizationId: string,
    role: string
  ): Promise<UserOrganization>
  getUserOrganizationRole(
    userId: string,
    organizationId: string
  ): Promise<UserOrganization | undefined>
  removeAllUsersFromOrganization(organizationId: string): Promise<void>
  getJobs(organizationId: string, jobTypes: JobType[]): Promise<EnqueuedTask[]>
  getJob(jobId: string): Promise<EnqueuedTask | null>
  getPendingJobsOlderThan(cutoff: Date): Promise<EnqueuedTask[]>
  addJob(job: InsertEnqueuedTask): Promise<EnqueuedTask>
  updateJob(
    jobId: string,
    job: Partial<InsertEnqueuedTask>
  ): Promise<EnqueuedTask>
  removeJob(jobId: string): Promise<void>
  getJobsByBranch(repoPublicId: string, branch: string): Promise<EnqueuedTask[]>
  removeJobsByBranchAndType(
    repoPublicId: string,
    branch: string,
    type: JobType
  ): Promise<void>
  createInvitation(organizationId: string, email: string): Promise<Invitation>
  getInvitationByToken(token: string): Promise<Invitation | null>
  acceptInvitation(token: string): Promise<void>
}

export class DatabaseStorage implements IStorage {
  private async handleDatabaseOperation<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      console.error("Database operation failed:", error)
      throw new Error(
        error instanceof Error ? error.message : "Database operation failed"
      )
    }
  }

  private async getOrgRepoPublicIds(organizationId: string): Promise<string[]> {
    const repos = await db
      .select({ publicId: githubRepos.publicId })
      .from(githubRepos)
      .where(eq(githubRepos.organizationId, organizationId))
    return repos.map((r) => r.publicId)
  }

  async getPrds(organizationId: string): Promise<Prd[]> {
    return this.handleDatabaseOperation(async () => {
      const repoPublicIds = await this.getOrgRepoPublicIds(organizationId)
      if (repoPublicIds.length === 0) return []

      return db
        .select()
        .from(prds)
        .where(inArray(prds.repoPublicId, repoPublicIds))
        .orderBy(prds.publicId)
    })
  }

  async getPrdByPublicId(publicId: string): Promise<Prd | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db
        .select()
        .from(prds)
        .where(eq(prds.publicId, publicId))
      return prd
    })
  }

  async getPrdForBranch(
    repoPublicId: string,
    branchName: string
  ): Promise<Prd | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db
        .select()
        .from(prds)
        .where(
          and(eq(prds.repoPublicId, repoPublicId), eq(prds.branch, branchName))
        )
      return prd
    })
  }

  async createPrd(insertPrd: InsertPrd): Promise<Prd> {
    return this.handleDatabaseOperation(async () => {
      const publicId = publicIdGenerators.prd()
      const [prd] = await db
        .insert(prds)
        .values({ ...insertPrd, publicId })
        .returning()
      return prd
    })
  }

  async updatePrdByPublicId(
    publicId: string,
    updateData: InsertPrd
  ): Promise<Prd> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db
        .update(prds)
        .set(updateData)
        .where(eq(prds.publicId, publicId))
        .returning()
      if (!prd) throw new Error("PRD not found")
      return prd
    })
  }

  async deletePrdByPublicId(publicId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db
        .delete(prds)
        .where(eq(prds.publicId, publicId))
        .returning()
      if (!prd) throw new Error("PRD not found")
    })
  }

  async searchPrds(organizationId: string, query: string): Promise<Prd[]> {
    return this.handleDatabaseOperation(async () => {
      const repoPublicIds = await this.getOrgRepoPublicIds(organizationId)
      if (repoPublicIds.length === 0) return []

      return db
        .select()
        .from(prds)
        .where(
          and(
            inArray(prds.repoPublicId, repoPublicIds),
            like(prds.title, `%${query}%`)
          )
        )
        .orderBy(prds.publicId)
    })
  }

  async getRepos(organizationId: string): Promise<GithubRepo[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select()
        .from(githubRepos)
        .where(eq(githubRepos.organizationId, organizationId))
    )
  }

  async getRepoByPublicId(publicId: string): Promise<GithubRepo | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .select()
        .from(githubRepos)
        .where(eq(githubRepos.publicId, publicId))
      return repo
    })
  }

  async createRepo(insertRepo: InsertGithubRepo): Promise<GithubRepo> {
    return this.handleDatabaseOperation(async () => {
      const publicId = publicIdGenerators.repo()
      const [repo] = await db
        .insert(githubRepos)
        .values({ ...insertRepo, publicId })
        .returning()
      return repo
    })
  }

  async updateRepoByPublicId(
    publicId: string,
    updateRepo: Partial<InsertGithubRepo>
  ): Promise<GithubRepo> {
    return this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .update(githubRepos)
        .set(updateRepo)
        .where(eq(githubRepos.publicId, publicId))
        .returning()
      if (!repo) throw new Error("Repository not found")
      return repo
    })
  }

  async deleteRepoByPublicId(publicId: string): Promise<void[]> {
    const deleteRepoRecord = this.handleDatabaseOperation(async () => {
      await db.delete(githubRepos).where(eq(githubRepos.publicId, publicId))
    })
    const deleteRepoDocsRecord = this.handleDatabaseOperation(async () => {
      await db.delete(repoDocs).where(eq(repoDocs.repoPublicId, publicId))
    })
    const deleteRepoFilesRecord = this.handleDatabaseOperation(async () => {
      await db.delete(repoFiles).where(eq(repoFiles.repoPublicId, publicId))
    })
    return Promise.all([
      deleteRepoRecord,
      deleteRepoDocsRecord,
      deleteRepoFilesRecord,
    ])
  }

  async getUser(user_sub: string): Promise<User | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userSub, user_sub))
      return user
    })
  }

  async getUserByPublicId(publicId: string): Promise<User | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.publicId, publicId))
      return user
    })
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return this.handleDatabaseOperation(async () => {
      const publicId = publicIdGenerators.user()
      const [user] = await db
        .insert(users)
        .values({ ...insertUser, publicId })
        .returning()
      return user
    })
  }

  async updateUser(
    user: Partial<InsertUser> & { userSub: string }
  ): Promise<User> {
    return this.handleDatabaseOperation(async () => {
      const [updatedUser] = await db
        .update(users)
        .set(user)
        .where(eq(users.userSub, user.userSub))
        .returning()
      if (!updatedUser) throw new Error("User not found")
      return updatedUser
    })
  }

  // Repository file analysis operations
  async getRepoFiles(
    repoPublicId: string,
    branchName?: string
  ): Promise<RepoFile[]> {
    const whereClause = branchName
      ? and(
          eq(repoFiles.repoPublicId, repoPublicId),
          eq(repoFiles.branch, branchName)
        )
      : eq(repoFiles.repoPublicId, repoPublicId)
    return this.handleDatabaseOperation(() =>
      db.select().from(repoFiles).where(whereClause)
    )
  }

  async createRepoFile(insertFile: InsertRepoFile): Promise<RepoFile> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db.insert(repoFiles).values(insertFile).returning()
      return file
    })
  }

  async getRepoFile(
    repoPublicId: string,
    filePath: string,
    branchName: string
  ): Promise<RepoFile | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db
        .select()
        .from(repoFiles)
        .where(
          and(
            eq(repoFiles.repoPublicId, repoPublicId),
            eq(repoFiles.filePath, filePath),
            eq(repoFiles.branch, branchName)
          )
        )
      return file
    })
  }

  async updateRepoFile(
    id: number,
    branch: string,
    updateFile: Partial<InsertRepoFile>
  ): Promise<RepoFile> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db
        .update(repoFiles)
        .set(updateFile)
        .where(and(eq(repoFiles.id, id), eq(repoFiles.branch, branch)))
        .returning()
      if (!file) throw new Error("Repository file not found")
      return file
    })
  }

  async deleteRepoFile(id: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db
        .delete(repoFiles)
        .where(eq(repoFiles.id, id))
        .returning()
      if (!file) throw new Error("Repository file not found")
    })
  }

  // Repository documentation operations
  private async fanOutOverOrgRepos<T>(
    orgId: string,
    getter: (repoPublicId: string) => Promise<T[]>
  ): Promise<T[]> {
    const repos = await this.getRepos(orgId)
    const results = await Promise.all(
      repos.map((repo) => getter(repo.publicId))
    )
    return results.flat()
  }

  async getOrganizationDocs(orgId: string): Promise<RepoDoc[]> {
    return this.fanOutOverOrgRepos(orgId, (repoPublicId) =>
      this.getRepoDocs(repoPublicId)
    )
  }

  async getRepoDocs(repoPublicId: string): Promise<RepoDoc[]> {
    return this.handleDatabaseOperation(() =>
      db.select().from(repoDocs).where(eq(repoDocs.repoPublicId, repoPublicId))
    )
  }

  async getRepoDocsByBranch(
    repoPublicId: string,
    branch: string
  ): Promise<RepoDoc[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select()
        .from(repoDocs)
        .where(
          and(
            eq(repoDocs.repoPublicId, repoPublicId),
            eq(repoDocs.branch, branch)
          )
        )
    )
  }

  async createRepoDoc(insertDoc: InsertRepoDoc): Promise<RepoDoc> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db.insert(repoDocs).values(insertDoc).returning()
      return doc
    })
  }

  async getRepoDoc(
    repoPublicId: string,
    branch: string,
    docType: DocType
  ): Promise<RepoDoc | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .select()
        .from(repoDocs)
        .where(
          and(
            eq(repoDocs.repoPublicId, repoPublicId),
            eq(repoDocs.branch, branch),
            eq(repoDocs.docType, docType)
          )
        )
      return doc
    })
  }

  async updateRepoDoc(
    id: number,
    updateDoc: Partial<InsertRepoDoc>
  ): Promise<RepoDoc> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .update(repoDocs)
        .set(updateDoc)
        .where(eq(repoDocs.id, id))
        .returning()
      if (!doc) throw new Error("Repository documentation not found")
      return doc
    })
  }

  async deleteRepoDoc(id: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .delete(repoDocs)
        .where(eq(repoDocs.id, id))

        .returning()
      if (!doc) throw new Error("Repository documentation not found")
    })
  }

  async getOrganizationReleases(orgId: string): Promise<Release[]> {
    return this.fanOutOverOrgRepos(orgId, (repoPublicId) =>
      this.getReleases(repoPublicId)
    )
  }

  async getReleases(repoPublicId: string): Promise<Release[]> {
    return this.handleDatabaseOperation(() =>
      db.select().from(releases).where(eq(releases.repoPublicId, repoPublicId))
    )
  }

  async createRelease(
    insertRelease: Omit<InsertRelease, "publicId">
  ): Promise<Release> {
    return this.handleDatabaseOperation(async () => {
      const publicId = publicIdGenerators.release()
      const [doc] = await db
        .insert(releases)
        .values({ ...insertRelease, publicId })
        .returning()
      return doc
    })
  }

  async getRelease(publicId: string): Promise<Release | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .select()
        .from(releases)
        .where(eq(releases.publicId, publicId))
      return doc
    })
  }

  async getReleaseByBranch(
    repoPublicId: string,
    branch: string
  ): Promise<Release | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [release] = await db
        .select()
        .from(releases)
        .where(
          and(
            eq(releases.repoPublicId, repoPublicId),
            eq(releases.branch, branch)
          )
        )
      return release
    })
  }

  async updateRelease(
    publicId: string,
    updateDoc: Partial<InsertRelease>
  ): Promise<Release> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .update(releases)
        .set(updateDoc)
        .where(eq(releases.publicId, publicId))
        .returning()
      if (!doc) throw new Error("Release documentation not found")
      return doc
    })
  }

  async deleteRelease(publicId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .delete(releases)
        .where(eq(releases.publicId, publicId))
        .returning()
      if (!doc) throw new Error("Repository documentation not found")
    })
  }

  // Role management operations
  async createRole(role: Omit<InsertRole, "publicId">): Promise<RoleRecord> {
    return this.handleDatabaseOperation(async () => {
      const publicId = publicIdGenerators.role()
      const [newRole] = await db
        .insert(roles)
        .values({ ...role, publicId })
        .returning()
      if (!newRole) throw new Error("Failed to create role")
      return newRole
    })
  }

  async getRole(publicId: string): Promise<RoleRecord | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [role] = await db
        .select()
        .from(roles)
        .where(eq(roles.publicId, publicId))
      return role
    })
  }

  async getRoleByOrgAndType(
    organizationId: string,
    roleType: Role
  ): Promise<RoleRecord | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [role] = await db
        .select()
        .from(roles)
        .where(
          and(
            eq(roles.organizationId, organizationId),
            eq(roles.roleType, roleType)
          )
        )
      return role
    })
  }

  async getRolesByOrganization(organizationId: string): Promise<RoleRecord[]> {
    return this.handleDatabaseOperation(async () => {
      const orgRoles = await db
        .select()
        .from(roles)
        .where(eq(roles.organizationId, organizationId))
      return orgRoles
    })
  }

  async updateRole(
    publicId: string,
    role: Partial<InsertRole>
  ): Promise<RoleRecord> {
    return this.handleDatabaseOperation(async () => {
      const [updatedRole] = await db
        .update(roles)
        .set({ ...role, updatedAt: new Date() })
        .where(eq(roles.publicId, publicId))
        .returning()
      if (!updatedRole) throw new Error("Role not found")
      return updatedRole
    })
  }

  async deleteRole(publicId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db.delete(roles).where(eq(roles.publicId, publicId))
    })
  }

  // Role document operations
  async createRoleDoc(role: InsertRoleDocument): Promise<RoleDocument> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db.insert(roleDocs).values(role).returning()
      if (!doc) throw new Error("Role documentation not found")
      return doc
    })
  }

  async updateRoleDoc(role: InsertRoleDocument): Promise<RoleDocument> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .update(roleDocs)
        .set(role)
        .where(
          and(
            eq(roleDocs.releasePublicId, role.releasePublicId),
            eq(roleDocs.repoPublicId, role.repoPublicId),
            eq(roleDocs.rolePublicId, role.rolePublicId)
          )
        )
        .returning()
      if (!doc) throw new Error("Role documentation not found")
      return doc
    })
  }

  async getRoleDocsForRelease(
    releasePublicId: string
  ): Promise<RoleDocument[]> {
    return this.handleDatabaseOperation(async () => {
      const docs = await db
        .select()
        .from(roleDocs)
        .where(eq(roleDocs.releasePublicId, releasePublicId))
      return docs
    })
  }

  async deleteRoleDocsForRelease(releasePublicId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db
        .delete(roleDocs)
        .where(eq(roleDocs.releasePublicId, releasePublicId))
    })
  }

  async getOrganizationsByUserId(userId: string): Promise<Organization[]> {
    return this.handleDatabaseOperation(async () => {
      const results = await db
        .select({
          id: organizations.id,
          publicId: organizations.publicId,
          name: organizations.name,
          slug: organizations.slug,
          description: organizations.description,
          createdAt: organizations.createdAt,
          updatedAt: organizations.updatedAt,
          accessToken: organizations.accessToken,
          isPersonal: organizations.isPersonal,
          profileImageUrl: organizations.profileImageUrl,
          installationId: organizations.installationId,
        })
        .from(organizations)
        .innerJoin(
          userOrganizations,
          eq(organizations.publicId, userOrganizations.organizationId)
        )
        .where(eq(userOrganizations.userId, userId))
      return results
    })
  }

  // Legacy alias for getOrganizationByPublicId - kept for withOrganization() middleware
  async getOrganization(publicId: string): Promise<Organization | undefined> {
    return this.getOrganizationByPublicId(publicId)
  }

  async getOrganizationByPublicId(
    publicId: string
  ): Promise<Organization | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.publicId, publicId))
      return org
    })
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
      return org
    })
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    return this.handleDatabaseOperation(async () => {
      const publicId = publicIdGenerators.organization()
      const [organization] = await db
        .insert(organizations)
        .values({ ...org, publicId })
        .returning()
      return organization
    })
  }

  async updateOrganization(
    orgSlug: string,
    org: Partial<InsertOrganization>
  ): Promise<Organization> {
    return this.handleDatabaseOperation(async () => {
      const [organization] = await db
        .update(organizations)
        .set({ ...org, updatedAt: new Date() })
        .where(eq(organizations.slug, orgSlug))
        .returning()
      if (!organization) throw new Error("Organization not found")
      return organization
    })
  }

  async deleteOrganization(publicId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [org] = await db
        .delete(organizations)
        .where(eq(organizations.publicId, publicId))
        .returning()
      if (!org) throw new Error("Organization not found")
    })
  }

  async getUsersInOrganization(
    publicId: string
  ): Promise<OrganizationMember[]> {
    return this.handleDatabaseOperation(async () => {
      const members = await db
        .select({
          id: users.id,
          publicId: users.publicId,
          email: users.email,
          name: users.name,
          role: userOrganizations.role,
          userSub: users.userSub,
        })
        .from(users)
        .innerJoin(
          userOrganizations,
          eq(users.publicId, userOrganizations.userId)
        )
        .where(eq(userOrganizations.organizationId, publicId))
      return members.map((member) => ({
        id: member.id,
        publicId: member.publicId,
        email: member.email,
        name: member.name,
        role: member.role as UserRole,
        userSub: member.userSub,
      }))
    })
  }

  async addUserToOrganization(
    userOrg: InsertUserOrganization
  ): Promise<UserOrganization> {
    return this.handleDatabaseOperation(async () => {
      const [userOrganization] = await db
        .insert(userOrganizations)
        .values(userOrg)
        .returning()
      return userOrganization
    })
  }

  async removeAllUsersFromOrganization(organizationId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db
        .delete(userOrganizations)
        .where(eq(userOrganizations.organizationId, organizationId))
    })
  }

  async removeUserFromOrganization(
    userId: string,
    organizationId: string
  ): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [userOrg] = await db
        .delete(userOrganizations)
        .where(
          and(
            eq(userOrganizations.userId, userId),
            eq(userOrganizations.organizationId, organizationId)
          )
        )
        .returning()
      if (!userOrg) throw new Error("User organization relationship not found")
    })
  }

  async updateUserOrganizationRole(
    userId: string,
    organizationId: string,
    role: string
  ): Promise<UserOrganization> {
    return this.handleDatabaseOperation(async () => {
      // If promoting to owner, demote the current owner to admin first
      if (role === "owner") {
        const currentOwner = await db
          .select()
          .from(userOrganizations)
          .where(
            and(
              eq(userOrganizations.organizationId, organizationId),
              eq(userOrganizations.role, "owner")
            )
          )

        if (currentOwner.length > 0 && currentOwner[0].userId !== userId) {
          await db
            .update(userOrganizations)
            .set({ role: "admin" })
            .where(
              and(
                eq(userOrganizations.userId, currentOwner[0].userId),
                eq(userOrganizations.organizationId, organizationId)
              )
            )
        }
      }

      const [userOrg] = await db
        .update(userOrganizations)
        .set({ role })
        .where(
          and(
            eq(userOrganizations.userId, userId),
            eq(userOrganizations.organizationId, organizationId)
          )
        )
        .returning()
      if (!userOrg) throw new Error("User organization relationship not found")
      return userOrg
    })
  }

  async getUserOrganizationRole(
    userId: string,
    organizationId: string
  ): Promise<UserOrganization | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [userOrg] = await db
        .select()
        .from(userOrganizations)
        .where(
          and(
            eq(userOrganizations.userId, userId),
            eq(userOrganizations.organizationId, organizationId)
          )
        )
      return userOrg
    })
  }

  async getJobs(
    organizationId: string,
    jobTypes: JobType[]
  ): Promise<EnqueuedTask[]> {
    return this.handleDatabaseOperation(async () => {
      const pendingJobs = await db
        .select()
        .from(enqueuedTasks)
        .where(
          and(
            eq(enqueuedTasks.organizationId, organizationId),
            inArray(enqueuedTasks.type, jobTypes)
          )
        )
      return pendingJobs
    })
  }

  async getJob(jobId: string): Promise<EnqueuedTask | null> {
    return this.handleDatabaseOperation(async () => {
      const [job] = await db
        .select()
        .from(enqueuedTasks)
        .where(eq(enqueuedTasks.jobId, jobId))
      return job || null
    })
  }

  async getPendingJobsOlderThan(cutoff: Date): Promise<EnqueuedTask[]> {
    return this.handleDatabaseOperation(async () => {
      return db
        .select()
        .from(enqueuedTasks)
        .where(
          and(
            eq(enqueuedTasks.status, "pending"),
            lt(enqueuedTasks.updatedAt, cutoff)
          )
        )
    })
  }

  async addJob(job: InsertEnqueuedTask): Promise<EnqueuedTask> {
    return this.handleDatabaseOperation(async () => {
      const [enqueuedTask] = await db
        .insert(enqueuedTasks)
        .values(job)
        .returning()
      return enqueuedTask
    })
  }

  async updateJob(
    jobId: string,
    job: Partial<InsertEnqueuedTask>
  ): Promise<EnqueuedTask> {
    return this.handleDatabaseOperation(async () => {
      const [enqueuedTask] = await db
        .update(enqueuedTasks)
        .set({ ...job, updatedAt: new Date() })
        .where(eq(enqueuedTasks.jobId, jobId))
        .returning()
      return enqueuedTask
    })
  }

  async removeJob(jobId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db.delete(enqueuedTasks).where(eq(enqueuedTasks.jobId, jobId))
    })
  }

  async getJobsByBranch(
    repoPublicId: string,
    branch: string
  ): Promise<EnqueuedTask[]> {
    return this.handleDatabaseOperation(async () => {
      const jobs = await db
        .select()
        .from(enqueuedTasks)
        .where(
          and(
            eq(enqueuedTasks.repoPublicId, repoPublicId),
            eq(enqueuedTasks.branch, branch)
          )
        )
      return jobs
    })
  }

  async removeJobsByBranchAndType(
    repoPublicId: string,
    branch: string,
    type: JobType,
    status?: JobStatusType
  ): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db
        .delete(enqueuedTasks)
        .where(
          and(
            eq(enqueuedTasks.repoPublicId, repoPublicId),
            eq(enqueuedTasks.branch, branch),
            eq(enqueuedTasks.type, type),
            status ? eq(enqueuedTasks.status, status) : undefined
          )
        )
    })
  }

  async createInvitation(
    organizationId: string,
    email: string
  ): Promise<Invitation> {
    return this.handleDatabaseOperation(async () => {
      // Check if a pending invitation already exists
      const [existingInvitation] = await db
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            eq(invitations.email, email),
            eq(invitations.status, "pending")
          )
        )

      if (existingInvitation) {
        return existingInvitation
      }

      const [invitation] = await db
        .insert(invitations)
        .values({
          organizationId,
          email,
          status: "pending",
        })
        .returning()
      if (!invitation) throw new Error("Failed to create invitation")
      return invitation
    })
  }

  async getInvitationByToken(token: string): Promise<Invitation | null> {
    return this.handleDatabaseOperation(async () => {
      const [invitation] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.token, token))
      return invitation || null
    })
  }

  async acceptInvitation(token: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      // First check if invitation exists
      const existingInvitation = await this.getInvitationByToken(token)
      if (!existingInvitation) {
        throw new Error("Invitation not found")
      }

      if (existingInvitation.status !== "pending") {
        throw new Error(
          `Invitation cannot be accepted: current status is ${existingInvitation.status}`
        )
      }

      await db
        .update(invitations)
        .set({ status: "accepted" })
        .where(
          and(eq(invitations.token, token), eq(invitations.status, "pending"))
        )
    })
  }
}

// Export a singleton instance
export const storage = new DatabaseStorage()
