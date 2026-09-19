export function createCritiqueExecution({ createCaller, setExtensionPrompt, quietPromptId, inPromptType }) {
    let running = false;

    async function clearQuietPrompt() {
        await setExtensionPrompt(quietPromptId, '', inPromptType, 0, true);
    }

    async function execute(prompt) {
        if (running) throw new Error('Critique already in progress');
        running = true;
        try {
            await clearQuietPrompt();
            return await createCaller().generate(prompt);
        } finally {
            try { await clearQuietPrompt(); }
            finally { running = false; }
        }
    }

    return {
        execute,
        isRunning: () => running,
    };
}
