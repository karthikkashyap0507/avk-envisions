import 'server-only';

import { AppError } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { logger } from '@/server/logger';

/**
 * AI provider abstraction.
 *
 * Two real providers behind one interface, plus a disabled mode that refuses
 * loudly. There is deliberately no mock model here: nothing pretends to be a
 * model that is not connected. Without one, the coach uses its own built-in
 * answers instead (services/coach-engine.ts) - written advice around the
 * student's real figures, never invented ones.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/** True when a provider and key are configured. */
export function isAiEnabled(): boolean {
  const env = serverEnv();
  return env.AI_PROVIDER !== 'disabled' && Boolean(env.AI_API_KEY);
}

class DisabledProvider implements AiProvider {
  readonly name = 'disabled';

  async complete(): Promise<CompletionResult> {
    throw new AppError(
      'AI_DISABLED',
      'The AI Coach is not configured on this deployment. An administrator needs to set AI_PROVIDER and AI_API_KEY.',
    );
  }
}

class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const env = serverEnv();
    const base = env.AI_BASE_URL || 'https://api.anthropic.com';

    const response = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.AI_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        max_tokens: request.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS,
        system: request.system,
        messages: request.messages,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.error({ status: response.status, detail: detail.slice(0, 500) }, 'Anthropic call failed');
      throw new AppError('PROVIDER_ERROR', 'The AI service is unavailable right now.');
    }

    const payload = (await response.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };

    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();

    return {
      text,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
      model: payload.model ?? env.AI_MODEL,
    };
  }
}

class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const env = serverEnv();
    const base = env.AI_BASE_URL || 'https://api.openai.com';

    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        max_tokens: request.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS,
        // OpenAI takes the system prompt as the first message rather than a
        // separate field.
        messages: [{ role: 'system', content: request.system }, ...request.messages],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.error({ status: response.status, detail: detail.slice(0, 500) }, 'OpenAI call failed');
      throw new AppError('PROVIDER_ERROR', 'The AI service is unavailable right now.');
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    return {
      text: (payload.choices?.[0]?.message?.content ?? '').trim(),
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      model: payload.model ?? env.AI_MODEL,
    };
  }
}

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;

  const env = serverEnv();
  if (!isAiEnabled()) cached = new DisabledProvider();
  else if (env.AI_PROVIDER === 'anthropic') cached = new AnthropicProvider();
  else cached = new OpenAiProvider();

  return cached;
}

/** Test seam. */
export function __setAiProvider(provider: AiProvider | null) {
  cached = provider;
}
