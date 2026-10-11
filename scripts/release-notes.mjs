/**
 * Prints the release notes for a version: .github/release-notes.md with the
 * version's entry from CHANGELOG.md filled in. Fails when the update log has
 * no entry for the version, so every release gets logged.
 *
 *   node scripts/release-notes.mjs 0.2.0 > notes.md
 */
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n');
const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" entry. Add one before releasing.`);
  process.exit(1);
}
const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
const changes = lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();

const template = readFileSync('.github/release-notes.md', 'utf8');
process.stdout.write(template.replaceAll('{version}', version).replace('{changes}', changes));
