import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type ModelType =
  | "gpt-4o"
  | "gpt-4.1"
  | "o4-mini"
  | "o3"
  | "gpt-4o-mini"
  | "gpt-4.1-mini"
  | "gpt-4.1-nano"
  | "o1"
  | "gpt-3.5-turbo"
  | "o1-2024-12-17"
  | "o1-mini"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-haiku-20240307"
  | "claude-3-opus-20240229";

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
    const response = await this.client.messages.create({
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
  return model.startsWith("gpt-") || model.startsWith("o1-");
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
