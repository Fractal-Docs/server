import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Generate embeddings using OpenAI's API
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  return response.data[0].embedding;
}

// Cosine similarity function for comparing embeddings
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Function to chunk text for processing
export function chunkText(text: string, maxChunkSize: number = 8000): string[] {
  const chunks: string[] = [];
  let currentChunk = "";

  const lines = text.split("\n");

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 <= maxChunkSize) {
      currentChunk += (currentChunk ? "\n" : "") + line;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// Process file content and generate embeddings
export async function processFileContent(
  content: string,
): Promise<{ chunks: string[]; embeddings: number[][] }> {
  const chunks = chunkText(content);
  const embeddings = await Promise.all(
    chunks.map((chunk) => generateEmbedding(chunk)),
  );

  return { chunks, embeddings };
}
