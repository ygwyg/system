import type { AIProvider, ChatParams, ProviderEnv, VisionParams } from "./index";

const DEFAULT_FAST_MODEL = "claude-3-5-haiku-20241022";
const DEFAULT_SMART_MODEL = "claude-sonnet-4-20250514";

export class AnthropicProvider implements AIProvider {
  name = "anthropic" as const;

  constructor(private env: ProviderEnv) {}

  private get apiKey(): string {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    return this.env.ANTHROPIC_API_KEY;
  }

  private resolveModel(model?: string, fallback?: string): string {
    return model || fallback || DEFAULT_SMART_MODEL;
  }

  async chat(params: ChatParams): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.resolveModel(
          params.model,
          this.env.MODEL_SMART || DEFAULT_SMART_MODEL
        ),
        max_tokens: 4096,
        system: params.system,
        messages: params.messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = (await response.json()) as { content: { text: string }[] };
    return data.content[0]?.text || "No response";
  }

  async chatWithVision(params: VisionParams): Promise<string> {
    const visionMessages = [
      {
        role: "user" as const,
        content: [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: params.image.mimeType,
              data: params.image.data,
            },
          },
          {
            type: "text" as const,
            text: params.userRequest
              ? `The user asked: "${params.userRequest}"\n\nHere is the screenshot I just took. Please describe what you see and address the user's request.`
              : "Here is a screenshot I just took. Please describe what you see.",
          },
        ],
      },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.resolveModel(
          params.model,
          this.env.MODEL_SMART || DEFAULT_SMART_MODEL
        ),
        max_tokens: 4096,
        system: params.system,
        messages: visionMessages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude Vision API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { content: { text: string }[] };
    return data.content[0]?.text || "No response";
  }
}
