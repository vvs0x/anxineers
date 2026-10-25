import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../public/js/vendor/', import.meta.url), { recursive: true });
await build({ entryPoints: [new URL('./fear-soundscape-entry.js', import.meta.url).pathname],
  outfile: new URL('../public/js/vendor/fear-soundscape.js', import.meta.url).pathname,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true,
  legalComments: 'eof', banner: { js: '// Fear Viewer soundscape, bundled locally with Tone.js 15.1.22 (MIT).' } });
await copyFile(new URL('../node_modules/tone/LICENSE.md', import.meta.url), new URL('../public/js/vendor/Tone-LICENSE.md', import.meta.url));
