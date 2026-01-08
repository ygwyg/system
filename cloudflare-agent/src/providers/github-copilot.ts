import type {
  AIProvider,
  ChatParams,
  Message,
  MessageContent,
  ProviderEnv,
  VisionParams,
} from "./index";

interface CopilotToken {
  token: string;
  expiresAt: number;
}

export class GitHubCopilotProvider implements AIProvider {
  name = "github" as const;
  private copilotToken: CopilotToken | null = null;

  constructor(private env: ProviderEnv) {}

  private get githubToken(): string {
    if (!this.env.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN is not set");
    }
    return this.env.GITHUB_TOKEN;
  }

  private async getCopilotToken(): Promise<string> {
    if (
      this.copilotToken &&
      Date.now() < this.copilotToken.expiresAt - 60_000
    ) {
      return this.copilotToken.token;
    }

    const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: {
        Authorization: `token ${this.githubToken}`,
        Accept: "application/json",
        "User-Agent": "SYSTEM-Mac-Control/1.0",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get Copilot token: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as { token: string; expires_at: number };
    this.copilotToken = {
      token: data.token,
      expiresAt: data.expires_at * 1000,
    };
    return data.token;
  }

  private flattenContent(content: string | MessageContent[]): string {
    if (typeof content === "string") return content;
    return content
      .map((c) => (c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  private toOpenAIMessages(system: string, messages: Message[]) {
    const openaiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (system.trim()) {
      openaiMessages.push({ role: "system", content: system });
    }
    for (const msg of messages) {
      openaiMessages.push({
        role: msg.role,
        content: this.flattenContent(msg.content),
      });
    }
    return openaiMessages;
  }

  private resolveModel(model?: string): string {
    return model || this.env.COPILOT_MODEL || "gpt-4o";
  }

  async chat(params: ChatParams): Promise<string> {
    const copilotToken = await this.getCopilotToken();
    const openaiMessages = this.toOpenAIMessages(params.system, params.messages);

    const response = await fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${copilotToken}`,
        "Editor-Version": "vscode/1.96.0",
        "Editor-Plugin-Version": "copilot-chat/0.24.0",
        "User-Agent": "GitHubCopilotChat/0.24.0",
        "Openai-Intent": "conversation-panel",
      },
      body: JSON.stringify({
        model: this.resolveModel(params.model),
        max_tokens: 4096,
        messages: openaiMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub Copilot API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices[0]?.message?.content || "No response";
  }

  async chatWithVision(params: VisionParams): Promise<string> {
    const copilotToken = await this.getCopilotToken();
    const visionMessages = [
      ...(params.system.trim()
        ? [{ role: "system" as const, content: params.system }]
        : []),
      {
        role: "user" as const,
        content: [
          {
            type: "image_url" as const,
            image_url: {
              url: `data:${params.image.mimeType};base64,${params.image.data}`,
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

    const response = await fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${copilotToken}`,
        "Editor-Version": "vscode/1.96.0",
        "Editor-Plugin-Version": "copilot-chat/0.24.0",
        "User-Agent": "GitHubCopilotChat/0.24.0",
        "Openai-Intent": "conversation-panel",
      },
      body: JSON.stringify({
        model: this.resolveModel(params.model),
        max_tokens: 4096,
        messages: visionMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitHub Copilot Vision API error: ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices[0]?.message?.content || "No response";
  }
}
