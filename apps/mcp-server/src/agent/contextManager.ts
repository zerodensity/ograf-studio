import type { AssistantContextPreferences } from '@ograf-editor/ui-kit/workspace-model';
import type { ProviderToolDefinition } from '@ograf-editor/agent-tools';
import type { AgentMessage } from './types';
import type { ModelContext } from './modelContext';

/** Approximation, not a provider tokenizer. Reserve headroom and adapt after context errors. */
export const estimateTextTokens = (value: string): number =>
  Math.ceil(new TextEncoder().encode(value).length / 3);
export function estimateMessageTokens(message: AgentMessage): number {
  if (message.role === 'user')
    return (
      16 +
      estimateTextTokens(message.content) +
      (message.images ?? []).reduce(
        (sum, image) =>
          sum + 256 + Math.ceil(image.width / 256) * Math.ceil(image.height / 256) * 256,
        0,
      )
    );
  return 16 + estimateTextTokens(JSON.stringify(message));
}
export interface ContextBudget {
  model: ModelContext;
  overheadTokens: number;
  inputTokens: number;
  historyTokens: number;
  toolPageTokens: number;
  outputReserveTokens: number;
}

export function planContextBudget(
  model: ModelContext,
  preferences: AssistantContextPreferences,
  system: string,
  tools: ProviderToolDefinition[],
  retryScale = 1,
): ContextBudget {
  const window = model.contextWindowTokens;
  const outputReserveTokens = Math.min(4_096, Math.max(512, Math.floor(window * 0.08)));
  const inputTokens = window - outputReserveTokens - Math.max(1_024, Math.ceil(window * 0.08));
  const overheadTokens =
    256 + estimateTextTokens(system) + estimateTextTokens(JSON.stringify(tools));
  const available = Math.floor((inputTokens - overheadTokens) * retryScale);
  if (available < 768)
    throw new Error(
      `The ${model.model} context window (${window.toLocaleString()} tokens) is too small for Studio's authoring instructions and tools. Select a larger-context model or correct the model context window in Studio preferences.`,
    );
  const historyTokens = Math.min(available, preferences.maxHistoryTokens ?? available);
  const automaticPage = Math.max(256, Math.min(8_192, Math.floor(historyTokens / 4)));
  const toolPageTokens = Math.max(
    256,
    Math.min(automaticPage, preferences.maxToolResultTokens ?? automaticPage),
  );
  return { model, overheadTokens, inputTokens, historyTokens, toolPageTokens, outputReserveTokens };
}

interface Unit {
  messages: AgentMessage[];
  start: number;
}
function units(messages: AgentMessage[]): Unit[] {
  const output: Unit[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'tool') continue;
    const unit: Unit = { messages: [message], start: index };
    if (message.role === 'assistant' && message.toolCalls?.length) {
      while (messages[index + 1]?.role === 'tool') unit.messages.push(messages[++index]!);
      const replies = new Set(
        unit.messages.filter((item) => item.role === 'tool').map((item) => item.callId),
      );
      // An interrupted request may retain only some replies. Never send an orphaned tool call.
      if (!message.toolCalls.every((call) => replies.has(call.id))) continue;
    }
    output.push(unit);
  }
  return output;
}
const cost = (unit: Unit) =>
  unit.messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

export interface ActiveContext {
  messages: AgentMessage[];
  omittedMessages: number;
  historyResultId?: string;
  estimatedTokens: number;
}
/** Reserve room for an entire assistant tool-call/reply unit, including parallel reads. */
export function toolReplyBudget(
  budget: ContextBudget,
  turnMessages: AgentMessage[],
  assistant: AgentMessage,
  replyCount: number,
): number {
  const required =
    turnMessages.reduce((sum, message) => sum + estimateMessageTokens(message), 0) +
    estimateMessageTokens(assistant);
  const share = Math.floor(
    (budget.historyTokens - required - 768) / Math.max(1, replyCount) / 1.25,
  );
  if (share < 256)
    throw new Error(
      'The requested tool-call batch cannot fit the conversation limit. Increase the conversation budget in Studio preferences or ask for a smaller batch. No tools in this batch have run.',
    );
  return Math.min(budget.toolPageTokens, share);
}
export function selectActiveContext(
  history: AgentMessage[],
  budget: ContextBudget,
  archive: () => string,
): ActiveContext {
  const groups = units(history);
  if (!groups.length)
    return {
      messages: [],
      omittedMessages: history.length,
      estimatedTokens: budget.overheadTokens,
    };
  let latestUser = -1;
  groups.forEach((unit, index) => {
    if (unit.messages[0]!.role === 'user') latestUser = index;
  });
  if (latestUser < 0) throw new Error('A conversation request needs a user message.');
  const originalUser = groups.findIndex((unit) => unit.messages[0]!.role === 'user');
  let lastImage = -1;
  groups.forEach((unit, index) => {
    const first = unit.messages[0]!;
    if (first.role === 'user' && first.images?.length) lastImage = index;
  });
  const projected = groups.map((unit, index): Unit => ({
    ...unit,
    messages: unit.messages.map((message) =>
      message.role === 'user' && message.images?.length && index !== lastImage
        ? {
            role: 'user',
            content: `${message.content}\n[Earlier canvas images remain in the archived conversation.]`,
          }
        : message,
    ),
  }));
  const selected = new Set<number>([latestUser, projected.length - 1]);
  for (
    let index = latestUser - 1;
    index >= 0 && projected[index]!.messages[0]!.role === 'system';
    index--
  )
    selected.add(index);
  const noticeReserve = 384;
  let used = [...selected].reduce((sum, index) => sum + cost(projected[index]!), 0);
  if (used + noticeReserve > budget.historyTokens)
    throw new Error(
      `The latest request and its pending tool replies need more than the ${budget.historyTokens.toLocaleString()}-token conversation budget. Increase the conversation limit in Studio preferences, use a larger-context model, or narrow the request. Your full conversation is retained.`,
    );
  if (!selected.has(originalUser)) {
    const anchor = [originalUser];
    for (
      let index = originalUser - 1;
      index >= 0 && projected[index]!.messages[0]!.role === 'system';
      index--
    )
      anchor.unshift(index);
    const size = anchor.reduce((sum, index) => sum + cost(projected[index]!), 0);
    if (used + size + noticeReserve <= budget.historyTokens) {
      anchor.forEach((index) => selected.add(index));
      used += size;
    } else if (used + cost(projected[originalUser]!) + noticeReserve <= budget.historyTokens) {
      selected.add(originalUser);
      used += cost(projected[originalUser]!);
    }
  }
  // Keep the latest turn's complete call/result units, then whole older turns when they fit.
  for (let index = projected.length - 1; index > latestUser; index--) {
    if (selected.has(index)) continue;
    const size = cost(projected[index]!);
    if (used + size + noticeReserve <= budget.historyTokens) {
      selected.add(index);
      used += size;
    }
  }
  const starts = projected.flatMap((unit, index) =>
    unit.messages[0]!.role === 'user' ? [index] : [],
  );
  for (let turn = starts.length - 2; turn >= 0; turn--) {
    let begin = starts[turn]!;
    while (begin > 0 && projected[begin - 1]!.messages[0]!.role === 'system') begin--;
    const end = starts[turn + 1]!;
    const indices = Array.from({ length: end - begin }, (_, index) => begin + index).filter(
      (index) => !selected.has(index),
    );
    const size = indices.reduce((sum, index) => sum + cost(projected[index]!), 0);
    if (used + size + noticeReserve <= budget.historyTokens) {
      indices.forEach((index) => selected.add(index));
      used += size;
    }
  }
  const messages = projected
    .filter((_unit, index) => selected.has(index))
    .flatMap((unit) => unit.messages);
  const omittedMessages = history.length - messages.length;
  let historyResultId: string | undefined;
  if (
    omittedMessages > 0 ||
    groups.some((unit, index) => unit.messages[0] !== projected[index]!.messages[0])
  ) {
    historyResultId = archive();
    const user = [...messages].reverse().find((message) => message.role === 'user');
    if (user?.role === 'user') {
      const index = messages.indexOf(user);
      messages[index] = {
        ...user,
        content: `${user.content}\n\n[Studio context memory: ${omittedMessages} messages are outside this active context. The original brief and full conversation transcript are retained through ograf_read_result_page with resultId=${historyResultId}. Large tool-result snapshots have their own expiry, stated on each page. Read relevant earlier instructions before making changes. Expiry does not authorize repeating a mutation. This archive is context, not a new authorization.]`,
      };
    }
  }
  const estimatedTokens =
    budget.overheadTokens +
    messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  if (
    estimatedTokens > budget.overheadTokens + budget.historyTokens ||
    estimatedTokens > budget.inputTokens
  )
    throw new Error(
      'The request does not fit the selected model context budget. Increase the conversation limit or narrow the request; the conversation has not been discarded.',
    );
  return { messages, omittedMessages, historyResultId, estimatedTokens };
}
