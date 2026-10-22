import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RedmineError } from '../../redmine/redmine.errors';

const asJson = (value: unknown): CallToolResult['content'] =>
  [{ type: 'text', text: JSON.stringify(value ?? { ok: true }, null, 2) }];

export async function toolResult<T>(
  fn: () => Promise<T>,
  toContent: (value: T) => CallToolResult['content'] = asJson,
): Promise<CallToolResult> {
  try {
    return { content: toContent(await fn()) };
  } catch (err) {
    if (err instanceof RedmineError) return { isError: true, content: [{ type: 'text', text: err.message }] };
    throw err;
  }
}
