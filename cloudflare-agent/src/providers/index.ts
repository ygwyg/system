import { AnthropicProvider } from "./anthropic";
import { GitHubCopilotProvider } from "./github-copilot";

export type ProviderName = "anthropic" | "github";

export interface ProviderEnv {
  AI_PROVIDER?: ProviderName;
  ANTHROPIC_API_KEY?: string;
  GITHUB_TOKEN?: string;
  COPILOT_MODEL?: string;
  MODEL_FAST?: string;
  MODEL_SMART?: string;
}

export type MessageRole = "user" | "assistant";

export interface MessageContentText {
  type: "text";
  text: string;
}

export interface MessageContentImage {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

export type MessageContent = MessageContentText | MessageContentImage;

export interface Message {
  role: MessageRole;
  content: string | MessageContent[];
}

export interface ChatParams {
  system: string;
  messages: Message[];
  model?: string;
}

export interface VisionParams {
  system: string;
  userRequest: string;
  image: { data: string; mimeType: string };
  model?: string;
}

export interface AIProvider {
  name: ProviderName;
  chat(params: ChatParams): Promise<string>;
  chatWithVision(params: VisionParams): Promise<string>;
  chatStream?(params: ChatParams): AsyncIterable<string>;
  validateCredentials?(): Promise<boolean>;
  getAvailableModels?(): string[];
}

const providers: Record<ProviderName, new (env: ProviderEnv) => AIProvider> = {
  anthropic: AnthropicProvider,
  github: GitHubCopilotProvider,
};

export function createProvider(env: ProviderEnv): AIProvider {
  const providerType: ProviderName =
    env.AI_PROVIDER || (env.GITHUB_TOKEN ? "github" : "anthropic");
  const Provider = providers[providerType];

  if (!Provider) {
    throw new Error(`Unknown provider: ${providerType}`);
  }

  return new Provider(env);
}
