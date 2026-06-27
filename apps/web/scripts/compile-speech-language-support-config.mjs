import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, printParseErrorCode } from 'jsonc-parser';
import { format, resolveConfig } from 'prettier';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, '..', 'src', 'lib');
const sourcePath = join(configDir, 'speech-language-support.config.jsonc');
const outputPath = join(configDir, 'speech-language-support.config.json');
const checkOnly = process.argv.includes('--check');

const source = readFileSync(sourcePath, 'utf8');
const errors = [];
const parsed = parse(source, errors, { allowTrailingComma: true, disallowComments: false });

if (errors.length > 0) {
  const formatted = errors
    .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
    .join('\n');
  throw new Error(`Invalid speech language support JSONC:\n${formatted}`);
}

const prettierConfig = (await resolveConfig(outputPath)) ?? {};
const output = await format(JSON.stringify(parsed, null, 2), { ...prettierConfig, parser: 'json' });

if (checkOnly) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== output) {
    throw new Error(
      'Generated speech language support config is stale. Run `npm run speech:config --workspace=@sotto/web`.'
    );
  }
} else {
  writeFileSync(outputPath, output);
}
