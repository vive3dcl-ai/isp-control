export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiCompletionRequest = {
  provider: string;
  model: string;
  apiKey: string;
  messages: AiChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type AiCompletionResult = {
  text: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};
