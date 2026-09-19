import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeJsonReport(root, reportPath, report) {
    const resolved = path.resolve(root, reportPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return resolved;
}
