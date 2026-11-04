import { validateConnection } from './connection.js';
import { createChatCompletionsModel } from './chat-completions.js';
import { createResponsesModel } from './responses.js';

/** Explicit protocol selection only; never infer it from a model name or retry elsewhere. */
export function createModel(options) {
    const connection = validateConnection(options.connection);
    return (connection.profile === 'responses' ? createResponsesModel : createChatCompletionsModel)({ ...options, connection });
}
