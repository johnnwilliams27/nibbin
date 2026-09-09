// Copies the pipeline's dataset into public/ so the deployed site can serve the
// exact bytes it was built from. Judges (and anyone else) can download the raw
// snapshot instead of taking the rendered numbers on faith.
//
// The pipeline may still be running when this fires. That is not an error: we
// write a well-formed empty dataset so the build succeeds and the UI can say
// "index still building" honestly, rather than failing or inventing rows.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = resolve(root, 'data/agents.json');
const target = resolve(root, 'public/data/agents.json');

mkdirSync(dirname(target), { recursive: true });

let payload = null;
if (existsSync(source)) {
  try {
    const raw = readFileSync(source, 'utf8');
    if (raw.trim().length > 0) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.agents)) {
        payload = parsed;
      } else {
        console.warn('[prepare-data] data/agents.json parsed but has no agents[]; treating as empty.');
      }
    } else {
      console.warn('[prepare-data] data/agents.json is empty; treating as empty.');
    }
  } catch (error) {
    console.warn(`[prepare-data] data/agents.json is not valid JSON yet (${error.message}); treating as empty.`);
  }
} else {
  console.warn('[prepare-data] data/agents.json not found; treating as empty.');
}

if (!payload) {
  payload = { generated_at: null, agents: [] };
}

writeFileSync(target, JSON.stringify(payload));
console.log(`[prepare-data] wrote ${target} (${payload.agents.length} agents, generated_at=${payload.generated_at ?? 'none'})`);
