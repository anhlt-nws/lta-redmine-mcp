import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RedmineError } from '../../redmine/redmine.errors';

export async function toolResult(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(value ?? { ok: true }, null, 2) }] };
  } catch (err) {
    if (err instanceof RedmineError) return { isError: true, content: [{ type: 'text', text: err.message }] };
    throw err;
  }
}
