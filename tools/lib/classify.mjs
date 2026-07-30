import path from 'node:path';

export function classifyContentFile(contentRoot, file) {
  const relative = path.relative(contentRoot, file);
  const parts = relative.split(path.sep);
  const basename = path.basename(file);
  if (parts[0] === '_generated' || basename === 'index.md' || parts.length === 1) {
    return { kind: 'guide', relative, parts, basename };
  }
  if (parts.length === 4 && basename.endsWith('.md')) {
    return { kind: 'record', relative, parts, basename };
  }
  return { kind: 'unknown', relative, parts, basename };
}

export function isGuidePage(contentRoot, file) {
  return classifyContentFile(contentRoot, file).kind === 'guide';
}

export function isRecordDocument(contentRoot, file) {
  return classifyContentFile(contentRoot, file).kind === 'record';
}
