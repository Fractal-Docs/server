import { Pinecone, RecordMetadata } from "@pinecone-database/pinecone"
import { cosineSimilarity } from "./embeddings"

export interface VectorMetadata extends RecordMetadata {
  repoId: string
  filePath: string
  branch: string
  fileId: number
  language: string
  lastModified: string
}

export interface IVectorStorage {
  storeEmbedding(
    id: string,
    embedding: number[],
    metadata: VectorMetadata
  ): Promise<void>
  searchSimilar(
    embedding: number[],
    repoId: string,
    limit?: number
  ): Promise<
    Array<{
      id: string
      score: number
      metadata: VectorMetadata
    }>
  >
  deleteByRepoId(repoId: string, branch?: string): Promise<void>
}

export class LocalVectorStorage implements IVectorStorage {
  private vectors: Array<{
    id: string
    embedding: number[]
    metadata: VectorMetadata
  }> = []

  async storeEmbedding(
    id: string,
    embedding: number[],
    metadata: VectorMetadata
  ): Promise<void> {
    this.vectors.push({ id, embedding, metadata })
  }

  async searchSimilar(
    queryEmbedding: number[],
    repoId: string,
    limit: number = 5
  ) {
    return this.vectors
      .filter((v) => v.metadata.repoId === repoId)
      .map((v) => ({
        id: v.id,
        score: cosineSimilarity(queryEmbedding, v.embedding),
        metadata: v.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  async deleteByRepoId(repoId: string, branch?: string): Promise<void> {
    this.vectors = this.vectors.filter(
      (v) =>
        !(
          v.metadata.repoId === repoId &&
          (branch ? v.metadata.branch === branch : true)
        )
    )
  }
}

// Pinecone implementation
export class PineconeVectorStorage implements IVectorStorage {
  private client: Pinecone
  private readonly indexName = "repo-embeddings"
  private readonly dimension = 1536 // OpenAI's ada-002 dimension

  constructor() {
    if (!process.env.PINECONE_API_KEY) {
      throw new Error("Missing Pinecone API key")
    }

    this.client = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    })
  }

  private async ensureIndex() {
    const { indexes } = await this.client.listIndexes()

    if (!indexes) {
      throw new Error("No indexes found")
    }

    if (!indexes.find((index) => index.name === this.indexName)) {
      await this.client.createIndex({
        name: this.indexName,
        dimension: this.dimension,
        metric: "cosine",
        spec: {
          serverless: {
            cloud: "aws",
            region: "us-east-1",
          },
        },
      })
    }
  }

  async storeEmbedding(
    id: string,
    embedding: number[],
    metadata: VectorMetadata
  ): Promise<void> {
    await this.ensureIndex()
    const index = this.client.index(this.indexName)

    await index.upsert([
      {
        id,
        values: embedding,
        metadata,
      },
    ])
  }

  async searchSimilar(
    queryEmbedding: number[],
    repoId: string,
    limit: number = 5
  ) {
    const index = this.client.index(this.indexName)

    const results = await index.query({
      vector: queryEmbedding,
      filter: { repoId },
      topK: limit,
      includeMetadata: true,
    })

    return results.matches.map((match) => ({
      id: match.id,
      score: match.score || 0,
      metadata: match.metadata as VectorMetadata,
    }))
  }

  async deleteByRepoId(repoId: string, branch: string): Promise<void> {
    const index = this.client.index(this.indexName)

    let list = await index.listPaginated({
      prefix: `${repoId}-${branch}`,
    })
    if (!list || !list.vectors) return

    let vectorIds = list.vectors.map((vector) => vector.id)

    if (vectorIds.length === 0) return

    await index.deleteMany(vectorIds)

    while (list.pagination?.next) {
      list = await index.listPaginated({
        prefix: `${repoId}-${branch}`,
      })
      if (!list || !list.vectors) return

      vectorIds = list.vectors.map((vector) => vector.id)
      index.deleteMany(vectorIds)
    }
  }
}

// Export a factory function that creates the appropriate storage implementation
export function createVectorStorage(): IVectorStorage {
  if (!process.env.PINECONE_API_KEY) {
    return new LocalVectorStorage()
  }
  // Use Pinecone for production
  return new PineconeVectorStorage()
}

export const vectorStorage = createVectorStorage()
