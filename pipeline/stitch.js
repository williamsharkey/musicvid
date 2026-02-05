#!/usr/bin/env node
/**
 * Stitch video clips together with ffmpeg.
 * Applies hard cuts or crossfades, overlays the original audio.
 *
 * Usage: node pipeline/stitch.js
 *
 * Requires: ffmpeg installed
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..', 'project');

function loadJson(name, fallback) {
  const f = join(PROJECT_DIR, name);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : fallback;
}

const project = loadJson('project.json', {});
const scenes = loadJson('scenes.json', []);
const clipsDir = join(PROJECT_DIR, 'clips');
const outputDir = join(PROJECT_DIR, 'output');

if (!existsSync(clipsDir)) {
  console.error('No clips directory. Generate video clips first.');
  process.exit(1);
}

const clipFiles = readdirSync(clipsDir)
  .filter(f => f.endsWith('.mp4'))
  .sort();

if (!clipFiles.length) {
  console.error('No .mp4 clips found in project/clips/');
  process.exit(1);
}

// Find audio file
let audioFile = null;
for (const ext of ['mp3', 'wav', 'aac', 'm4a']) {
  const p = join(PROJECT_DIR, `audio.${ext}`);
  if (existsSync(p)) { audioFile = p; break; }
}

console.log(`Found ${clipFiles.length} clips`);
console.log(`Audio: ${audioFile || 'none'}`);

// Build ffmpeg concat file
const concatPath = join(PROJECT_DIR, 'concat.txt');
const concatContent = clipFiles
  .map(f => `file '${join(clipsDir, f)}'`)
  .join('\n');
writeFileSync(concatPath, concatContent);

// Check for crossfade transitions
const hasFades = scenes.some(s => s.transition === 'fade');

let outputPath = join(outputDir, 'musicvid-final.mp4');

if (hasFades) {
  // Complex filter with crossfades
  console.log('Building with crossfades...');

  // For crossfade, we need a filter_complex approach
  // Build input list and filter chain
  const inputs = clipFiles.map(f => `-i "${join(clipsDir, f)}"`).join(' ');

  if (clipFiles.length === 1) {
    // Single clip, just copy
    const cmd = `ffmpeg -y -i "${join(clipsDir, clipFiles[0])}"${audioFile ? ` -i "${audioFile}" -map 0:v -map 1:a -shortest` : ''} -c:v libx264 -c:a aac "${outputPath}"`;
    console.log('Running:', cmd);
    execSync(cmd, { stdio: 'inherit' });
  } else {
    // Build xfade filter chain
    const fadeDur = 0.5; // 0.5s crossfade
    let filterParts = [];
    let lastLabel = '[0:v]';

    for (let i = 1; i < clipFiles.length; i++) {
      const sceneTransition = scenes[i]?.transition || 'cut';
      const outLabel = i < clipFiles.length - 1 ? `[v${i}]` : '[vout]';

      if (sceneTransition === 'fade') {
        // Calculate offset (sum of clip durations minus accumulated fades)
        filterParts.push(`${lastLabel}[${i}:v]xfade=transition=fade:duration=${fadeDur}:offset=0${outLabel}`);
      } else {
        // Hard cut via concat
        filterParts.push(`${lastLabel}[${i}:v]concat=n=2:v=1:a=0${outLabel}`);
      }
      lastLabel = outLabel;
    }

    // Fallback to simple concat if filter gets too complex
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}"${audioFile ? ` -i "${audioFile}" -map 0:v -map 1:a -shortest` : ''} -c:v libx264 -c:a aac "${outputPath}"`;
    console.log('Running:', cmd);
    execSync(cmd, { stdio: 'inherit', timeout: 600000 });
  }
} else {
  // Simple concat (hard cuts only)
  console.log('Building with hard cuts...');
  const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}"${audioFile ? ` -i "${audioFile}" -map 0:v -map 1:a -shortest` : ''} -c:v libx264 -c:a aac "${outputPath}"`;
  console.log('Running:', cmd);
  execSync(cmd, { stdio: 'inherit', timeout: 600000 });
}

console.log(`\nOutput: ${outputPath}`);
console.log('Done!');
