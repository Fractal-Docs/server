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
} from "./shared/schema"
import { db } from "./db"
import { eq, like, inArray, and } from "drizzle-orm"

type UserRole = "owner" | "admin" | "member"

interface OrganizationMember extends Omit<User, "themePreferences"> {
  role: UserRole
}

export interface IStorage {
  // PRD operations
  getPrds(organizationId: number): Promise<Prd[]>
  getPrd(id: number): Promise<Prd | undefined>
  createPrd(prd: InsertPrd): Promise<Prd>
  updatePrd(id: number, prd: InsertPrd): Promise<Prd>
  deletePrd(id: number): Promise<void>
  searchPrds(organizationId: number, query: string): Promise<Prd[]>

  // GitHub repo operations
  getRepos(organizationId: number): Promise<GithubRepo[]>
  getRepo(id: string): Promise<GithubRepo | undefined>
  createRepo(repo: InsertGithubRepo): Promise<GithubRepo>
  deleteRepo(id: string): Promise<void[]>

  // GitHub auth operations
  getUser(user_sub: string): Promise<User | undefined>
  createUser(user: InsertUser): Promise<User>
  updateUser(user: InsertUser): Promise<User>

  // Repository file analysis operations
  getRepoFiles(repoId: string, branchName: string): Promise<RepoFile[]>
  createRepoFile(file: InsertRepoFile): Promise<RepoFile>
  getRepoFile(
    repoId: string,
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
  getOrganizationDocs(orgId: number): Promise<RepoDoc[]>
  getRepoDocs(repoId: string): Promise<RepoDoc[]>
  getRepoDocsByBranch(repoId: string, branchName: string): Promise<RepoDoc[]>
  createRepoDoc(doc: InsertRepoDoc): Promise<RepoDoc>
  getRepoDoc(
    repoId: string,
    branchName: string,
    docType: InsertRepoDoc["docType"]
  ): Promise<RepoDoc | undefined>
  updateRepoDoc(id: number, doc: Partial<InsertRepoDoc>): Promise<RepoDoc>
  deleteRepoDoc(id: number): Promise<void>

  // Release operations
  getOrganizationReleases(orgId: number): Promise<Release[]>
  getReleases(repoId: string): Promise<Release[]>
  getRelease(releaseId: string): Promise<Release | undefined>
  createRelease(release: InsertRelease): Promise<Release>
  updateRelease(
    releaseId: string,
    release: Partial<InsertRelease>
  ): Promise<Release>
  deleteRelease(releaseId: string): Promise<void>

  // Role management operations
  createRole(role: InsertRole): Promise<RoleRecord>
  getRole(id: string): Promise<RoleRecord | undefined>
  getRoleByOrgAndType(
    organizationId: number,
    roleType: Role
  ): Promise<RoleRecord | undefined>
  getRolesByOrganization(organizationId: number): Promise<RoleRecord[]>
  updateRole(id: string, role: Partial<InsertRole>): Promise<RoleRecord>
  deleteRole(id: string): Promise<void>

  // Role document operations
  createRoleDoc(role: InsertRoleDocument): Promise<RoleDocument>
  upsertRoleDoc(role: InsertRoleDocument): Promise<RoleDocument>
  getRoleDocsForRelease(releaseId: string): Promise<RoleDocument[]>
  deleteRoleDocsForRelease(releaseId: string): Promise<void>

  getOrganization(id: number): Promise<Organization | undefined>
  getOrganizationsByUserId(userId: number): Promise<Organization[]>
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>
  createOrganization(org: InsertOrganization): Promise<Organization>
  updateOrganization(
    orgSlug: string,
    org: Partial<InsertOrganization>
  ): Promise<Organization>
  deleteOrganization(id: number): Promise<void>
  getUsersInOrganization(id: number): Promise<OrganizationMember[]>
  addUserToOrganization(
    userOrg: InsertUserOrganization
  ): Promise<UserOrganization>
  removeUserFromOrganization(
    userId: number,
    organizationId: number
  ): Promise<void>
  updateUserOrganizationRole(
    userId: number,
    organizationId: number,
    role: string
  ): Promise<UserOrganization>
  getJob(jobId: string): Promise<EnqueuedTask | null>
  addJob(job: InsertEnqueuedTask): Promise<EnqueuedTask>
  updateJob(
    jobId: string,
    job: Partial<InsertEnqueuedTask>
  ): Promise<EnqueuedTask>
  removeJob(jobId: string): Promise<void>
  getJobsByBranch(repoId: string, branch: string): Promise<EnqueuedTask[]>
  removeErrorJobsByBranchAndType(
    repoId: string,
    branch: string,
    type: JobType
  ): Promise<void>
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

  async getPrds(organizationId: number): Promise<Prd[]> {
    return this.handleDatabaseOperation(async () => {
      const repos = await db
        .select({ repoId: githubRepos.repoId })
        .from(githubRepos)
        .where(eq(githubRepos.organizationId, organizationId))

      const repoIds = repos.map((r) => r.repoId)
      if (repoIds.length === 0) return []

      return db
        .select()
        .from(prds)
        .where(inArray(prds.repoId, repoIds))
        .orderBy(prds.id)
    })
  }

  async getPrd(id: number): Promise<Prd | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db.select().from(prds).where(eq(prds.id, id))
      return prd
    })
  }

  async getPrdForBranch(
    repoId: string,
    branchName: string
  ): Promise<Prd | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db
        .select()
        .from(prds)
        .where(and(eq(prds.repoId, repoId), eq(prds.branch, branchName)))
      return prd
    })
  }

  async createPrd(insertPrd: InsertPrd): Promise<Prd> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db.insert(prds).values(insertPrd).returning()
      return prd
    })
  }

  async updatePrd(id: number, insertPrd: InsertPrd): Promise<Prd> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db
        .update(prds)
        .set(insertPrd)
        .where(eq(prds.id, id))
        .returning()
      if (!prd) throw new Error("PRD not found")
      return prd
    })
  }

  async deletePrd(id: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db.delete(prds).where(eq(prds.id, id)).returning()
      if (!prd) throw new Error("PRD not found")
    })
  }

  async searchPrds(organizationId: number, query: string): Promise<Prd[]> {
    return this.handleDatabaseOperation(async () => {
      if (!query) return this.getPrds(organizationId)

      const repos = await db
        .select({ repoId: githubRepos.repoId })
        .from(githubRepos)
        .where(eq(githubRepos.organizationId, organizationId))

      const repoIds = repos.map((r) => r.repoId)
      if (repoIds.length === 0) return []

      return db
        .select()
        .from(prds)
        .where(
          and(inArray(prds.repoId, repoIds), like(prds.title, `%${query}%`))
        )
        .orderBy(prds.id)
    })
  }

  async getRepos(organizationId: number): Promise<GithubRepo[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select()
        .from(githubRepos)
        .where(eq(githubRepos.organizationId, organizationId))
    )
  }

  async getRepo(id: string): Promise<GithubRepo | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .select()
        .from(githubRepos)
        .where(eq(githubRepos.repoId, id))
      return repo
    })
  }

  async createRepo(insertRepo: InsertGithubRepo): Promise<GithubRepo> {
    return this.handleDatabaseOperation(async () => {
      const [repo] = await db.insert(githubRepos).values(insertRepo).returning()
      return repo
    })
  }

  async updateRepo(
    id: string,
    updateRepo: Partial<InsertGithubRepo>
  ): Promise<GithubRepo> {
    return this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .update(githubRepos)
        .set(updateRepo)
        .where(eq(githubRepos.repoId, id))
        .returning()
      if (!repo) throw new Error("Repository not found")
      return repo
    })
  }

  async deleteRepo(id: string): Promise<void[]> {
    const deleteRepo = this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .delete(githubRepos)
        .where(eq(githubRepos.repoId, id))
        .returning()
      if (!repo) throw new Error("Repository not found")
    })
    const deleteRepoDocs = this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .delete(repoDocs)
        .where(eq(repoDocs.repoId, id))
        .returning()
      if (!repo) throw new Error("Repository not found")
    })
    const deleteRepoFiles = this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .delete(repoFiles)
        .where(eq(repoFiles.repoId, id))
        .returning()
      if (!repo) throw new Error("Repository not found")
    })
    return Promise.all([deleteRepo, deleteRepoDocs, deleteRepoFiles])
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

  async createUser(insertUser: InsertUser): Promise<User> {
    return this.handleDatabaseOperation(async () => {
      const [user] = await db.insert(users).values(insertUser).returning()
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
  async getRepoFiles(repoId: string, branchName?: string): Promise<RepoFile[]> {
    const whereClause = branchName
      ? and(eq(repoFiles.repoId, repoId), eq(repoFiles.branch, branchName))
      : eq(repoFiles.repoId, repoId)
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
    repoId: string,
    filePath: string,
    branchName: string
  ): Promise<RepoFile | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db
        .select()
        .from(repoFiles)
        .where(
          and(
            eq(repoFiles.repoId, repoId),
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
  async getOrganizationDocs(orgId: number): Promise<RepoDoc[]> {
    const repos = await this.getRepos(orgId)
    const docs = await Promise.all(
      repos.map((repo) => this.getRepoDocs(repo.repoId))
    )
    return docs.flat()
  }

  async getRepoDocs(repoId: string): Promise<RepoDoc[]> {
    return this.handleDatabaseOperation(() =>
      db.select().from(repoDocs).where(eq(repoDocs.repoId, repoId))
    )
  }

  async getRepoDocsByBranch(
    repoId: string,
    branch: string
  ): Promise<RepoDoc[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select()
        .from(repoDocs)
        .where(and(eq(repoDocs.repoId, repoId), eq(repoDocs.branch, branch)))
    )
  }

  async createRepoDoc(insertDoc: InsertRepoDoc): Promise<RepoDoc> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db.insert(repoDocs).values(insertDoc).returning()
      return doc
    })
  }

  async getRepoDoc(
    repoId: string,
    branch: string,
    docType: InsertRepoDoc["docType"]
  ): Promise<RepoDoc | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .select()
        .from(repoDocs)
        .where(
          and(
            eq(repoDocs.repoId, repoId),
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

  async getOrganizationReleases(orgId: number): Promise<Release[]> {
    const repos = await this.getRepos(orgId)
    const docs = await Promise.all(
      repos.map((repo) => this.getReleases(repo.repoId))
    )
    return docs.flat()
  }

  async getReleases(repoId: string): Promise<Release[]> {
    return this.handleDatabaseOperation(() =>
      db.select().from(releases).where(eq(releases.repoId, repoId))
    )
  }

  async createRelease(insertRelease: InsertRelease): Promise<Release> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db.insert(releases).values(insertRelease).returning()
      return doc
    })
  }

  async getRelease(releaseId: string): Promise<Release | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .select()
        .from(releases)
        .where(eq(releases.releaseId, releaseId))
      return doc
    })
  }

  async updateRelease(
    releaseId: string,
    updateDoc: Partial<InsertRelease>
  ): Promise<Release> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .update(releases)
        .set(updateDoc)
        .where(eq(releases.releaseId, releaseId))

        .returning()
      if (!doc) throw new Error("Release documentation not found")
      return doc
    })
  }

  async deleteRelease(releaseId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .delete(releases)
        .where(eq(releases.releaseId, releaseId))

        .returning()
      if (!doc) throw new Error("Repository documentation not found")
    })
  }

  // Role management operations
  async createRole(role: InsertRole): Promise<RoleRecord> {
    return this.handleDatabaseOperation(async () => {
      const [newRole] = await db.insert(roles).values(role).returning()
      if (!newRole) throw new Error("Failed to create role")
      return newRole
    })
  }

  async getRole(id: string): Promise<RoleRecord | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [role] = await db.select().from(roles).where(eq(roles.id, id))
      return role
    })
  }

  async getRoleByOrgAndType(
    organizationId: number,
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

  async getRolesByOrganization(organizationId: number): Promise<RoleRecord[]> {
    return this.handleDatabaseOperation(async () => {
      const orgRoles = await db
        .select()
        .from(roles)
        .where(eq(roles.organizationId, organizationId))
      return orgRoles
    })
  }

  async updateRole(id: string, role: Partial<InsertRole>): Promise<RoleRecord> {
    return this.handleDatabaseOperation(async () => {
      const [updatedRole] = await db
        .update(roles)
        .set({ ...role, updatedAt: new Date() })
        .where(eq(roles.id, id))
        .returning()
      if (!updatedRole) throw new Error("Role not found")
      return updatedRole
    })
  }

  async deleteRole(id: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db.delete(roles).where(eq(roles.id, id))
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

  async upsertRoleDoc(role: InsertRoleDocument): Promise<RoleDocument> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .update(roleDocs)
        .set(role)
        .where(
          and(
            eq(roleDocs.releaseId, role.releaseId),
            eq(roleDocs.repoId, role.repoId),
            eq(roleDocs.roleId, role.roleId)
          )
        )
        .returning()
      if (!doc) throw new Error("Role documentation not found")
      return doc
    })
  }

  async getRoleDocsForRelease(releaseId: string): Promise<RoleDocument[]> {
    return this.handleDatabaseOperation(async () => {
      const docs = await db
        .select()
        .from(roleDocs)
        .where(eq(roleDocs.releaseId, releaseId))
      return docs
    })
  }

  async deleteRoleDocsForRelease(releaseId: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db.delete(roleDocs).where(eq(roleDocs.releaseId, releaseId))
    })
  }

  async getOrganizationsByUserId(userId: number): Promise<Organization[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select({
          id: organizations.id,
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
          eq(organizations.id, userOrganizations.organizationId)
        )
        .where(eq(userOrganizations.userId, userId))
    )
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, id))
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
      const [organization] = await db
        .insert(organizations)
        .values(org)
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

  async deleteOrganization(id: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [org] = await db
        .delete(organizations)
        .where(eq(organizations.id, id))
        .returning()
      if (!org) throw new Error("Organization not found")
    })
  }

  async getUsersInOrganization(id: number): Promise<OrganizationMember[]> {
    return this.handleDatabaseOperation(async () => {
      const members = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: userOrganizations.role,
          userSub: users.userSub,
        })
        .from(users)
        .innerJoin(userOrganizations, eq(users.id, userOrganizations.userId))
        .where(eq(userOrganizations.organizationId, id))
      return members.map((member) => ({
        id: member.id,
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

  async removeAllUsersFromOrganization(organizationId: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db
        .delete(userOrganizations)
        .where(eq(userOrganizations.organizationId, organizationId))
    })
  }

  async removeUserFromOrganization(
    userId: number,
    organizationId: number
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
    userId: number,
    organizationId: number,
    role: string
  ): Promise<UserOrganization> {
    return this.handleDatabaseOperation(async () => {
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

  async getJob(jobId: string): Promise<EnqueuedTask | null> {
    return this.handleDatabaseOperation(async () => {
      const [job] = await db
        .select()
        .from(enqueuedTasks)
        .where(eq(enqueuedTasks.jobId, jobId))
      return job || null
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
    repoId: string,
    branch: string
  ): Promise<EnqueuedTask[]> {
    return this.handleDatabaseOperation(async () => {
      const jobs = await db
        .select()
        .from(enqueuedTasks)
        .where(
          and(
            eq(enqueuedTasks.repoId, repoId),
            eq(enqueuedTasks.branch, branch)
          )
        )
      return jobs
    })
  }

  async removeErrorJobsByBranchAndType(
    repoId: string,
    branch: string,
    type: JobType
  ): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      await db
        .delete(enqueuedTasks)
        .where(
          and(
            eq(enqueuedTasks.repoId, repoId),
            eq(enqueuedTasks.branch, branch),
            eq(enqueuedTasks.type, type),
            eq(enqueuedTasks.status, "error")
          )
        )
    })
  }
}

// Export a singleton instance
export const storage = new DatabaseStorage()
