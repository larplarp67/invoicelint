/**
 * Every export of the package entry point must carry a TSDoc comment, so the
 * generated .d.ts documents the whole public API.
 */
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENTRY = join(import.meta.dirname, '..', 'src', 'index.ts');

/** True when a JSDoc comment with text sits directly above the declaration (no blank line). */
function hasOwnDoc(declaration: ts.Declaration): boolean {
  const sf = declaration.getSourceFile();
  const owner = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
  const last = ts.getJSDocCommentsAndTags(declaration).filter(ts.isJSDoc).at(-1);
  if (last === undefined) return false;
  if ((ts.getTextOfJSDocComment(last.comment) ?? '').trim() === '') return false;
  // A file-header comment that TypeScript attaches to the first statement is
  // separated from it by a blank line; it doesn't document that statement.
  const gap = sf.text.slice(last.end, owner.getStart(sf));
  return !/\n[ \t]*\n/.test(gap);
}

function undocumentedExports(): string[] {
  const program = ts.createProgram([ENTRY], {
    allowImportingTsExtensions: true,
    noEmit: true,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2023,
    strict: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(ENTRY);
  if (!source) throw new Error('entry not found');
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error('no module symbol');

  const missing: string[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (!(symbol.declarations ?? []).some(hasOwnDoc)) missing.push(exported.getName());
  }
  return missing.sort();
}

describe('public API documentation', () => {
  // Building a TypeScript program takes a few seconds, more under coverage on a busy machine.
  it('every export from src/index.ts has its own TSDoc comment', { timeout: 30_000 }, () => {
    expect(undocumentedExports()).toEqual([]);
  });
});
