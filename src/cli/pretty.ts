/** Human-readable CLI output. */
import pc from 'picocolors';
import { fieldLabel } from '../labels.ts';
import { type FileResult, type JudgeOptions, fileStatus, summarize } from '../output.ts';
import type { Issue } from '../types.ts';

export interface PrettyOptions extends JudgeOptions {
  /** Show info messages too. */
  verbose?: boolean;
  /** Print only the summary line. */
  quiet?: boolean;
  /** Use colours. */
  color: boolean;
  /** Wrap width in columns. */
  width: number;
}

type Colors = ReturnType<typeof pc.createColors>;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Word-wrap `text` to `width` columns, indenting every line by `indent` spaces. */
export function wrap(text: string, width: number, indent: number): string[] {
  const max = Math.max(20, (Number.isFinite(width) ? width : 100) - indent);
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= max) line += ` ${word}`;
    else {
      lines.push(pad + line);
      line = word;
    }
  }
  if (line !== '') lines.push(pad + line);
  return lines;
}

function renderIssue(issue: Issue, c: Colors, width: number): string[] {
  const icon =
    issue.severity === 'error'
      ? c.red('✗')
      : issue.severity === 'warning'
        ? c.yellow('⚠')
        : c.blue('ℹ');
  const label = fieldLabel(issue.field);
  const out = [`  ${icon} ${c.bold(issue.ruleId)}${label === '' ? '' : `  ${label}`}`];
  out.push(...wrap(issue.message, width, 4));
  if (issue.severity !== 'info' && issue.fix !== undefined) {
    const [first = '', ...rest] = wrap(`Fix: ${issue.fix}`, width, 4);
    out.push(c.cyan(first), ...rest.map((l) => c.cyan(l)));
  }
  if (issue.citation !== undefined) out.push(c.dim(`    ${issue.citation}`));
  return out;
}

function headerStatus(result: FileResult, options: PrettyOptions, c: Colors): string {
  const status = fileStatus(result, options);
  if (status === 'input-error') return c.red('✗ input error');
  if (!('report' in result)) return '';
  const { errors, warnings } = result.report;
  if (status === 'not-checked') return c.dim('– not checked');
  if (status === 'pass') {
    return warnings.length === 0
      ? c.green('✓ OK')
      : `${c.green('✓ OK')} · ${c.yellow(plural(warnings.length, 'warning'))}`;
  }
  const parts = `${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}`;
  return c.red(`✗ ${parts}${errors.length === 0 ? ' (strict)' : ''}`);
}

function renderFile(result: FileResult, options: PrettyOptions, c: Colors): string[] {
  const status = fileStatus(result, options);
  const meta: string[] = [];
  if ('report' in result) {
    if (result.report.format !== undefined) meta.push(result.report.format.toUpperCase());
    if (result.report.tier !== undefined) meta.push(`tier ${result.report.tier}`);
  }
  meta.push(headerStatus(result, options, c));
  const out = [`${c.bold(result.file)}  ${meta.join(c.dim(' · '))}`];

  const errors = 'report' in result ? result.report.errors : [result.inputError];
  const warnings = 'report' in result ? result.report.warnings : [];
  const infos = 'report' in result ? result.report.infos : [];
  // A not-checked file shows its notes even without --verbose, so the reason is visible.
  const showInfos = options.verbose === true || status === 'not-checked';
  const groups: [string, Issue[]][] = [
    ['Errors', errors],
    ['Warnings', warnings],
    ['Info', showInfos ? infos : []],
  ];
  for (const [title, issues] of groups) {
    if (issues.length === 0) continue;
    out.push('', c.dim(`  ${title} (${issues.length})`));
    for (const issue of issues) out.push(...renderIssue(issue, c, options.width));
  }
  return out;
}

/** The final line: "3 files · 1 failed · 4 warnings". */
export function summaryLine(results: readonly FileResult[], options: PrettyOptions): string {
  const c = pc.createColors(options.color);
  const s = summarize(results, options);
  const parts = [
    plural(s.files, 'file'),
    s.failed > 0 ? c.red(`${s.failed} failed`) : `${s.failed} failed`,
    s.warnings > 0 ? c.yellow(plural(s.warnings, 'warning')) : plural(s.warnings, 'warning'),
  ];
  if (s.notChecked > 0) parts.push(`${s.notChecked} not checked`);
  if (s.inputErrors > 0) parts.push(c.red(plural(s.inputErrors, 'input error')));
  if (s.strict) parts.push('strict');
  return parts.join(c.dim(' · '));
}

/** Render all results, followed by the summary line. */
export function renderPretty(results: readonly FileResult[], options: PrettyOptions): string {
  const c = pc.createColors(options.color);
  const out: string[] = [];
  if (options.quiet !== true) {
    for (const result of results) out.push(...renderFile(result, options, c), '');
  }
  out.push(summaryLine(results, options));
  return `${out.join('\n')}\n`;
}
