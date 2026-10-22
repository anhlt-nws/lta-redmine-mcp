// Message is shown to the AI client as-is.
export class RedmineError extends Error {}

export const notFound = () => new RedmineError('Not found');
