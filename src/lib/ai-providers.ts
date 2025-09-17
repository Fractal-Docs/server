import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

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
