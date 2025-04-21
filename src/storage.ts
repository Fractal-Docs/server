import {
  prds,
  githubRepos,
  githubAuth,
  repoFiles,
  repoDocs,
  type Prd,
  type InsertPrd,
  type GithubRepo,
  type InsertGithubRepo,
  type GithubAuth,
  type InsertGithubAuth,
  type RepoFile,
  type InsertRepoFile,
  type RepoDoc,
  type InsertRepoDoc,
} from "./shared/schema";
import { db } from "./db";
import { eq, like, and } from "drizzle-orm";

export interface IStorage {
  // PRD operations
  getPrds(): Promise<Prd[]>;
  getPrd(id: number): Promise<Prd | undefined>;
  createPrd(prd: InsertPrd): Promise<Prd>;
  updatePrd(id: number, prd: InsertPrd): Promise<Prd>;
  deletePrd(id: number): Promise<void>;
  searchPrds(query: string): Promise<Prd[]>;

  // GitHub repo operations
  getRepos(): Promise<GithubRepo[]>;
  getRepo(id: string): Promise<GithubRepo | undefined>;
  createRepo(repo: InsertGithubRepo): Promise<GithubRepo>;
  deleteRepo(id: string): Promise<void>;

  // GitHub auth operations
  getGithubAuth(): Promise<GithubAuth | undefined>;
  saveGithubAuth(auth: InsertGithubAuth): Promise<GithubAuth>;

  // Repository file analysis operations
  getRepoFiles(repoId: string): Promise<RepoFile[]>;
  createRepoFile(file: InsertRepoFile): Promise<RepoFile>;
  getRepoFile(repoId: string, filePath: string): Promise<RepoFile | undefined>;
  updateRepoFile(id: number, file: Partial<InsertRepoFile>): Promise<RepoFile>;
  deleteRepoFile(id: number): Promise<void>;

  // Repository documentation operations
  getRepoDocs(repoId: string): Promise<RepoDoc[]>;
  createRepoDoc(doc: InsertRepoDoc): Promise<RepoDoc>;
  getRepoDoc(repoId: string): Promise<RepoDoc | undefined>;
  updateRepoDoc(id: number, doc: Partial<InsertRepoDoc>): Promise<RepoDoc>;
  deleteRepoDoc(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private async handleDatabaseOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.error("Database operation failed:", error);
      throw new Error(
        error instanceof Error ? error.message : "Database operation failed",
      );
    }
  }

  async getPrds(): Promise<Prd[]> {
    return this.handleDatabaseOperation(() => db.select().from(prds));
  }

  async getPrd(id: number): Promise<Prd | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [prd] = await db.select().from(prds).where(eq(prds.id, id));
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

  async searchPrds(query: string): Promise<Prd[]> {
    return this.handleDatabaseOperation(async () => {
      if (!query) return this.getPrds();
      return db
        .select()
        .from(prds)
        .where(like(prds.title, `%${query}%`))
        .orderBy(prds.id);
    });
  }

  async getRepos(): Promise<GithubRepo[]> {
    return this.handleDatabaseOperation(() => db.select().from(githubRepos));
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

  
  async updateRepo(id: string, updateRepo: Partial<InsertGithubRepo>): Promise<GithubRepo> {
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

  async deleteRepo(id: string): Promise<void> {
    return this.handleDatabaseOperation(async () => {
      const [repo] = await db
        .delete(githubRepos)
        .where(eq(githubRepos.repoId, id))
        .returning();
      if (!repo) throw new Error("Repository not found");
    });
  }

  async getGithubAuth(): Promise<GithubAuth | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [auth] = await db.select().from(githubAuth);
      return auth;
    });
  }

  async saveGithubAuth(insertAuth: InsertGithubAuth): Promise<GithubAuth> {
    return this.handleDatabaseOperation(async () => {
      // First delete any existing auth
      await db.delete(githubAuth);
      // Then insert the new one
      const [auth] = await db.insert(githubAuth).values(insertAuth).returning();
      return auth;
    });
  }

  // Repository file analysis operations
  async getRepoFiles(repoId: string): Promise<RepoFile[]> {
    return this.handleDatabaseOperation(() =>
      db.select().from(repoFiles).where(eq(repoFiles.repoId, repoId)),
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
  ): Promise<RepoFile | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db
        .select()
        .from(repoFiles)
        .where(
          and(eq(repoFiles.repoId, repoId), eq(repoFiles.filePath, filePath)),
        );
      return file;
    });
  }

  async updateRepoFile(
    id: number,
    updateFile: Partial<InsertRepoFile>,
  ): Promise<RepoFile> {
    return this.handleDatabaseOperation(async () => {
      const [file] = await db
        .update(repoFiles)
        .set(updateFile)
        .where(eq(repoFiles.id, id))
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
  async getRepoDocs(repoId: string): Promise<RepoDoc[]> {
    return this.handleDatabaseOperation(() =>
      db.select().from(repoDocs).where(eq(repoDocs.repoId, repoId)),
    );
  }

  async createRepoDoc(insertDoc: InsertRepoDoc): Promise<RepoDoc> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db.insert(repoDocs).values(insertDoc).returning();
      return doc;
    });
  }

  async getRepoDoc(repoId: string): Promise<RepoDoc | undefined> {
    return this.handleDatabaseOperation(async () => {
      const [doc] = await db
        .select()
        .from(repoDocs)
        .where(eq(repoDocs.repoId, repoId));
      return doc;
    });
  }

  async updateRepoDoc(
    id: number,
    updateDoc: Partial<InsertRepoDoc>,
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
