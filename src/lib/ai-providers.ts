import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { encodingForModel } from "js-tiktoken";
import { InsertRepoDoc } from "src/shared/schema";
import { Role } from "./roles";

export type ModelType =
  | "gpt-4.1"
  | "o3"
  | "gpt-4.1-mini"
  | "claude-sonnet-4-20250514"
  | "claude-opus-4-20250514";

export interface AIProvider {
  generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    model: string
  ): Promise<string>;
}

class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    model: string
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "developer",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No content in OpenAI response");
    }
    return content;
  }
}

class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    model: string
  ): Promise<string> {
    const response =
      model === "claude-sonnet-4-20250514"
        ? await this.client.beta.messages.create({
            model,
            max_tokens: 4000,
            system: systemPrompt,
            betas: ["context-1m-2025-08-07"],
            messages: [
              {
                role: "user",
                content: userPrompt,
              },
            ],
          })
        : await this.client.messages.create({
            model,
            max_tokens: 4000,
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: userPrompt,
              },
            ],
          });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Anthropic");
    }
    return content.text;
  }
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || model.startsWith("o3");
}

export function getAIProvider(model: ModelType): AIProvider {
  if (isAnthropicModel(model)) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for Anthropic models"
      );
    }
    return new AnthropicProvider();
  } else if (isOpenAIModel(model)) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for OpenAI models"
      );
    }
    return new OpenAIProvider();
  } else {
    throw new Error(`Unsupported model: ${model}`);
  }
}

interface ModelChoice {
  model: ModelType;
  estimatedTokens: number;
  reason: string;
}

function estimateTokens(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): number {
  try {
    const enc = encodingForModel("gpt-4.1");
    const systemTokens = enc.encode(systemPrompt).length;
    const userTokens = enc.encode(userPrompt).length;
    return systemTokens + userTokens + maxTokens;
  } catch {
    // fallback: 1 token ~ 4 chars
    return Math.ceil((systemPrompt.length + userPrompt.length) / 4) + maxTokens;
  }
}

export function chooseModel(
  docType: InsertRepoDoc["docType"] | "release" | "role",
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  role?: Role
): ModelChoice {
  // Rough context size = prompt tokens
  const contextSize = estimateTokens("gpt-4.1", systemPrompt, userPrompt, 0);

  let model: ModelType = "gpt-4.1-mini";
  let reason = "Defaulting to gpt-4.1-mini as balanced option.";

  if (docType === "overview") {
    if (contextSize > 500_000) {
      model = "gpt-4.1";
      reason =
        "Cold start with very large context (>500k), using GPT-4.1 for 1M token window.";
    } else {
      model = "gpt-4.1-mini";
      reason =
        "Cold start with mid-size context, using GPT-4.1-mini for cost/performance.";
    }
  }

  if (docType === "delta") {
    if (contextSize <= 100_000) {
      model = "o3";
      reason =
        "Change doc with ≤100k tokens, using o3 for deep reasoning on diffs.";
    } else {
      model = "gpt-4.1";
      reason =
        "Change doc with >100k tokens, using GPT-4.1 to handle larger diffs.";
    }
  }

  if (docType === "release") {
    model = "gpt-4.1-mini";
    reason =
      "Release doc focuses on product/business logic, GPT-4.1-mini balances detail with efficiency.";
  }

  if (docType === "role") {
    if (role === "executive") {
      model = "claude-opus-4-20250514";
      reason =
        "Executive-facing deliverable, using Claude Opus for highest-quality prose.";
    } else {
      model = "claude-sonnet-4-20250514";
      reason =
        "Role-based doc (sales/marketing/etc.), using Claude Sonnet 3.5 for polished language.";
    }
  }

  const estimatedTokens = estimateTokens(
    model,
    systemPrompt,
    userPrompt,
    maxTokens
  );

  return { model, estimatedTokens, reason };
}
