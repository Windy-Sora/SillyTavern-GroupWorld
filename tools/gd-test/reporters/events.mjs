import path from 'node:path';

export default async function* events(source) {
    for await (const event of source) {
        if (event.type === 'test:pass' || event.type === 'test:fail') {
            const { name, file, line, column, details, skip, todo } = event.data;
            // Node emits a successful file wrapper when a name filter matches no tests.
            if (line === 1 && column === 1 && file && path.resolve(name) === path.resolve(file)) continue;
            yield `${JSON.stringify({ type: event.type, name, file, line, column, kind: details?.type, skip, todo })}\n`;
        }
    }
}
