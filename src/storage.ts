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
} from "./shared/schema";
import { db } from "./db";
import { eq, like, inArray, and } from "drizzle-orm";

export interface IStorage {
  // PRD operations
  getPrds(userRepos: string[]): Promise<Prd[]>;
  getPrd(id: number): Promise<Prd | undefined>;
  createPrd(prd: InsertPrd): Promise<Prd>;
  updatePrd(id: number, prd: InsertPrd): Promise<Prd>;
  deletePrd(id: number): Promise<void>;
  searchPrds(userRepos: string[], query: string): Promise<Prd[]>;

  // GitHub repo operations
  getRepos(userRepos: string[]): Promise<GithubRepo[]>;
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

  async getPrds(userRepos: string[]): Promise<Prd[]> {
    return this.handleDatabaseOperation(() => {
      return db.select().from(prds).where(inArray(prds.repoId, userRepos));
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

  async searchPrds(userRepos: string[], query: string): Promise<Prd[]> {
    return this.handleDatabaseOperation(async () => {
      if (!query) return this.getPrds(userRepos);
      return db
        .select()
        .from(prds)
        .where(like(prds.title, `%${query}%`))
        .orderBy(prds.id);
    });
  }

  async getRepos(userRepos: string[]): Promise<GithubRepo[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select()
        .from(githubRepos)
        .where(inArray(githubRepos.repoId, userRepos))
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

  async updateUser(insertUser: InsertUser): Promise<User> {
    return this.handleDatabaseOperation(async () => {
      const [user] = await db
        .update(users)
        .set(insertUser)
        .where(eq(users.userSub, insertUser.userSub))
        .returning();
      return user;
    });
  }

  // Repository file analysis operations
  async getRepoFiles(repoId: string, branchName?: string): Promise<RepoFile[]> {
    const whereClause = branchName
      ? and(eq(repoFiles.repoId, repoId), eq(repoFiles.branch, branchName))
      : eq(repoFiles.repoId, repoId);
    return this.handleDatabaseOperation(() =>
      db.select().from(repoFiles).where(whereClause)
    );
  }

  async createRepoFile(insertFile: InsertRepoFile): Promise<RepoFile> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db.insert(repoFiles).values(insertFile).returning();
      return file;
    });
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
        );
      return file;
    });
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
        .returning();
      if (!file) throw new Error("Repository file not found");
      return file;
    });
  }

  async deleteRepoFile(id: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db
        .delete(repoFiles)
        .where(eq(repoFiles.id, id))
        .returning();
      if (!file) throw new Error("Repository file not found");
    });
  }

  // Repository documentation operations
  async getRepoDocs(repoId: string, branch: string): Promise<RepoDoc[]> {
    return this.handleDatabaseOperation(() =>
      db
        .select()
        .from(repoDocs)
        .where(and(eq(repoDocs.repoId, repoId), eq(repoDocs.branch, branch)))
    );
  }

  async createRepoDoc(insertDoc: InsertRepoDoc): Promise<RepoDoc> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db.insert(repoDocs).values(insertDoc).returning();
      return doc;
    });
  }

  async getRepoDoc(
    repoId: string,
    branch: string,
    docType: string
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
        );
      return doc;
    });
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
        .returning();
      if (!doc) throw new Error("Repository documentation not found");
      return doc;
    });
  }

  async deleteRepoDoc(id: number): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .delete(repoDocs)
        .where(eq(repoDocs.id, id))
        .returning();
      if (!doc) throw new Error("Repository documentation not found");
    });
  }
}

// Export a singleton instance
export const storage = new DatabaseStorage();
