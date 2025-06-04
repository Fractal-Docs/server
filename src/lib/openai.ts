import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ModelType = "gpt-4o" | "gpt-3.5-turbo" | "o1-2024-12-17" | "o1-mini";

export async function generateDocumentation(
  code: string,
  businessContext: string,
  model: ModelType = "gpt-4o", // Default to gpt-4o
  docType: string = "overview"
): Promise<{ content: string; prompts: { developer: string; user: string } }> {
  try {
    const developerPrompt =
      docType === "overview"
        ? "You are a senior technical documentation expert specializing in software architecture and code documentation. Your job is to generate clear, detailed, and concise technical documentation for a software project. You will be provided with two inputs:1. Business Context: A brief overview of the purpose and goals of the software. 2. Source Code: Actual code snippets, modules, or files. Your documentation must include the following sections in Markdown: 1. Overview (purpose, objectives, high-level workflow)2. System Architecture (architectural diagrams described textually, component descriptions, data flow explanation) 3. Code Organization (folder structure, main modules and their responsibilities) 4. Dependencies and Technologies Used (languages/frameworks, databases, external APIs/services, rationale for use)5. Configuration Files (listing important files and environment variables with purposes clearly explained) 6. Deployment & Operations (CI/CD setup, deployment steps, monitoring, and logging details) 7. Contribution Guidelines (development workflow, testing requirements) 8. Troubleshooting & FAQs (common issues and resolutions) 9. Roadmap & Known Issues (future plans, known limitations) 10. Changelog (brief version history, notable changes) Ensure each section is thorough, actionable, and concise. Clearly explain relationships, dependencies, and reasoning behind technical decisions. Format everything neatly using Markdown to maximize clarity."
        : docType === "change"
          ? "You are a senior technical documentation expert specializing in software architecture and code documentation. Your job is to generate clear, detailed, and concise technical documentation for the changes in a branch.  You will be provided with two inputs:1. Business Context: A brief overview of the purpose and goals of the software. 2. Source Code: Actual code snippets, modules, or files."
          : "";

    const userPrompt =
      docType === "overview"
        ? `${businessContext}\n\nCode:\n${code}\n\nGraph and Control Flow Graph: ${code.includes("## Call Graph") ? "Included in the code section above." : "Not available for this repository."}\n\nGenerate comprehensive technical documentation following the structure provided. The output must be formatted clearly in Markdown and should explain both the business purpose and the technical implementation clearly.`
        : docType === "change"
          ? `${businessContext}\n\nChanges:\n${code}\n\nGenerate documentation for the changes provided. The output must be formatted clearly in Markdown and should explain both the business purpose and the technical implementation clearly.`
          : "";

    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "developer",
          content: developerPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const resContent = response.choices[0].message.content;
    if (!resContent) {
      throw new Error("No content in OpenAI response");
    }

    return {
      content: resContent,
      prompts: {
        developer: developerPrompt,
        user: userPrompt,
      },
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Failed to generate documentation: ${errorMessage}`);
  }
}
