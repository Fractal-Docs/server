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
} from "./shared/schema";
import { db } from "./db";
import { eq, like, inArray, and } from "drizzle-orm";

export interface IStorage {
  // PRD operations
  getPrds(organizationIds: number[]): Promise<Prd[]>;
  getPrd(id: number): Promise<Prd | undefined>;
  createPrd(prd: InsertPrd): Promise<Prd>;
  updatePrd(id: number, prd: InsertPrd): Promise<Prd>;
  deletePrd(id: number): Promise<void>;
  searchPrds(organizationIds: number[], query: string): Promise<Prd[]>;

  // GitHub repo operations
  getRepos(organizationIds: number[]): Promise<GithubRepo[]>;
  getRepo(id: string): Promise<GithubRepo | undefined>;
  createRepo(repo: InsertGithubRepo): Promise<GithubRepo>;
  deleteRepo(id: string): Promise<void[]>;

  // GitHub auth operations
  getUser(user_sub: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(user: InsertUser): Promise<User>;

  // Repository file analysis operations
  getRepoFiles(repoId: string, branchName: string): Promise<RepoFile[]>;
  createRepoFile(file: InsertRepoFile): Promise<RepoFile>;
  getRepoFile(
    repoId: string,
    filePath: string,
    branchName: string
  ): Promise<RepoFile | undefined>;
  updateRepoFile(
    id: number,
    branch: string,
    file: Partial<InsertRepoFile>
  ): Promise<RepoFile>;
  deleteRepoFile(id: number): Promise<void>;

  // Repository documentation operations
  getRepoDocs(repoId: string, branchName: string): Promise<RepoDoc[]>;
  createRepoDoc(doc: InsertRepoDoc): Promise<RepoDoc>;
  getRepoDoc(
    repoId: string,
    branchName: string,
    docType: string
  ): Promise<RepoDoc | undefined>;
  updateRepoDoc(id: number, doc: Partial<InsertRepoDoc>): Promise<RepoDoc>;
  deleteRepoDoc(id: number): Promise<void>;

  // Release operations
  getRelease(releaseId: string): Promise<Release | undefined>;
  createRelease(release: InsertRelease): Promise<Release>;
  updateRelease(
    releaseId: string,
    release: Partial<InsertRelease>
  ): Promise<Release>;
  deleteRelease(releaseId: string): Promise<void>;

  // Organization operations
  createUserWithOrganization(user: InsertUser, orgName: string): Promise<{ user: User; organization: Organization }>;
  getOrganizations(userId: number): Promise<Organization[]>;
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, org: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: number): Promise<void>;
  getUserOrganizations(userId: number): Promise<UserOrganization[]>;
  addUserToOrganization(userOrg: InsertUserOrganization): Promise<UserOrganization>;
  removeUserFromOrganization(userId: number, organizationId: number): Promise<void>;
  updateUserOrganizationRole(userId: number, organizationId: number, role: string): Promise<UserOrganization>;
}

export class DatabaseStorage implements IStorage {
  private async handleDatabaseOperation<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.error("Database operation failed:", error);
      throw new Error(
        error instanceof Error ? error.message : "Database operation failed"
      );
    }
  }

  async getPrds(organizationIds: number[]): Promise<Prd[]> {
    return this.handleDatabaseOperation(async () => {
      const repos = await db
        .select({ repoId: githubRepos.repoId })
        .from(githubRepos)
        .where(inArray(githubRepos.organizationId, organizationIds));

      const repoIds = repos.map(r => r.repoId);
      if (repoIds.length === 0) return [];

      return db
        .select()
        .from(prds)
        .where(inArray(prds.repoId, repoIds))
        .orderBy(prds.id);
    });
  }

  async getPrd(id: number): Promise<Prd | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db.select().from(prds).where(eq(prds.id, id));
      return prd;
    });
  }

  async getPrdForBranch(
    repoId: string,
    branchName: string
  ): Promise<Prd | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db
        .select()
        .from(prds)
        .where(and(eq(prds.repoId, repoId), eq(prds.branch, branchName)));
      return prd;
    });
  }

  async createPrd(insertPrd: InsertPrd): Promise<Prd> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db.insert(prds).values(insertPrd).returning();
      return prd;
    });
  }

  async updatePrd(id: number, insertPrd: InsertPrd): Promise<Prd> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db
        .update(prds)
        .set(insertPrd)
        .where(eq(prds.id, id))
        .returning();
      if (!prd) throw new Error("PRD not found");
      return prd;
    });
  }

  async deletePrd(id: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db.delete(prds).where(eq(prds.id, id)).returning();
      if (!prd) throw new Error("PRD not found");
    });
  }

  async searchPrds(organizationIds: number[], query: string): Promise<Prd[]> {
    return this.handleDatabaseOperation(async () => {
      if (!query) return this.getPrds(organizationIds);

      const repos = await db
        .select({ repoId: githubRepos.repoId })
        .from(githubRepos)
        .where(inArray(githubRepos.organizationId, organizationIds));

      const repoIds = repos.map(r => r.repoId);
      if (repoIds.length === 0) return [];

      return db
        .select()
        .from(prds)
        .where(and(inArray(prds.repoId, repoIds), like(prds.title, `%${query}%`)))
        .orderBy(prds.id);
    });
  }

  async getRepos(organizationIds: number[]): Promise<GithubRepo[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select()
        .from(githubRepos)
        .where(inArray(githubRepos.organizationId, organizationIds))
    );
  }

  async getRepo(id: string): Promise<GithubRepo | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .select()
        .from(githubRepos)
        .where(eq(githubRepos.repoId, id));
      return repo;
    });
  }

  async createRepo(insertRepo: InsertGithubRepo): Promise<GithubRepo> {
    return this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .insert(githubRepos)
        .values(insertRepo)
        .returning();
      return repo;
    });
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
        .returning();
      if (!repo) throw new Error("Repository not found");
      return repo;
    });
  }

  async deleteRepo(id: string): Promise<void[]> {
    const deleteRepo = this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .delete(githubRepos)
        .where(eq(githubRepos.repoId, id))
        .returning();
      if (!repo) throw new Error("Repository not found");
    });
    const deleteRepoDocs = this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .delete(repoDocs)
        .where(eq(repoDocs.repoId, id))
        .returning();
      if (!repo) throw new Error("Repository not found");
    });
    const deleteRepoFiles = this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .delete(repoFiles)
        .where(eq(repoFiles.repoId, id))
        .returning();
      if (!repo) throw new Error("Repository not found");
    });
    return Promise.all([deleteRepo, deleteRepoDocs, deleteRepoFiles]);
  }

  async getUser(user_sub: string): Promise<User | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userSub, user_sub));
      return user;
    });
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return this.handleDatabaseOperation(async () => {
      const [user] = await db.insert(users).values(insertUser).returning();
      return user;
    });
  }

  async updateUser(user: InsertUser): Promise<User> {
    return this.handleDatabaseOperation(async () => {
      const [updatedUser] = await db
        .update(users)
        .set(user)
        .where(eq(users.userSub, user.userSub))
        .returning();
      if (!updatedUser) throw new Error("User not found");
      return updatedUser;
    });
  }

  async createUserWithOrganization(user: InsertUser, orgName: string): Promise<{ user: User; organization: Organization }> {
    return this.handleDatabaseOperation(async () => {
      // Create user first
      const [createdUser] = await db.insert(users).values(user).returning();

      // Create organization with a unique slug
      const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      const [createdOrg] = await db.insert(organizations).values({
        name: orgName,
        slug,
        description: `${orgName}'s personal organization`,
      }).returning();

      // Add user to organization as owner
      await db.insert(userOrganizations).values({
        userId: createdUser.id,
        organizationId: createdOrg.id,
        role: 'owner',
      });

      return { user: createdUser, organization: createdOrg };
    });
  }

  async getOrganizations(userId: number): Promise<Organization[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          description: organizations.description,
          createdAt: organizations.createdAt,
          updatedAt: organizations.updatedAt,
        })
        .from(organizations)
        .innerJoin(userOrganizations, eq(organizations.id, userOrganizations.organizationId))
        .where(eq(userOrganizations.userId, userId))
    );
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, id));
      return org;
    });
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug));
      return org;
    });
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    return this.handleDatabaseOperation(async () => {
      const [organization] = await db.insert(organizations).values(org).returning();
      return organization;
    });
  }

  async updateOrganization(id: number, org: Partial<InsertOrganization>): Promise<Organization> {
    return this.handleDatabaseOperation(async () => {
      const [organization] = await db
        .update(organizations)
        .set({ ...org, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning();
      if (!organization) throw new Error("Organization not found");
      return organization;
    });
  }

  async deleteOrganization(id: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [org] = await db
        .delete(organizations)
        .where(eq(organizations.id, id))
        .returning();
      if (!org) throw new Error("Organization not found");
    });
  }

  async getUserOrganizations(userId: number): Promise<UserOrganization[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select()
        .from(userOrganizations)
        .where(eq(userOrganizations.userId, userId))
    );
  }

  async addUserToOrganization(userOrg: InsertUserOrganization): Promise<UserOrganization> {
    return this.handleDatabaseOperation(async () => {
      const [userOrganization] = await db.insert(userOrganizations).values(userOrg).returning();
      return userOrganization;
    });
  }

  async removeUserFromOrganization(userId: number, organizationId: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [userOrg] = await db
        .delete(userOrganizations)
        .where(and(
          eq(userOrganizations.userId, userId),
          eq(userOrganizations.organizationId, organizationId)
        ))
        .returning();
      if (!userOrg) throw new Error("User organization relationship not found");
    });
  }

  async updateUserOrganizationRole(userId: number, organizationId: number, role: string): Promise<UserOrganization> {
    return this.handleDatabaseOperation(async () => {
      const [userOrg] = await db
        .update(userOrganizations)
        .set({ role })
        .where(and(
          eq(userOrganizations.userId, userId),
          eq(userOrganizations.organizationId, organizationId)
        ))
        .returning();
      if (!userOrg) throw new Error("User organization relationship not found");
      return userOrg;
    });
  }
}

// Export a singleton instance
export const storage = new DatabaseStorage();