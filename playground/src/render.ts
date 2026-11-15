/**
 * Builds the results panel. Everything from the invoice (messages quote its
 * values) goes in with textContent, never innerHTML.
 */
import { type Issue, type Severity, fieldLabel } from '../../src/index.ts';
import { type Outcome, FORMAT_LABEL, headline, tierSummary } from './check.ts';

const ISSUES_URL = 'https://github.com/larplarp67/invoicelint/issues';

interface Props {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.className !== undefined) el.className = props.className;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

const ICON: Record<Severity, string> = { error: '✗', warning: '⚠', info: 'ℹ' };
const GROUP_TITLE: Record<Severity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Info',
};

/** Selects an issue's field in the editor. Absent for UBL, where fields aren't places in the text. */
export interface FieldLink {
  /** Whether this field can be shown (it parses, and the editor holds valid JSON). */
  canShow: (field: string) => boolean;
  show: (field: string) => void;
}

function renderIssue(issue: Issue, link: FieldLink | undefined): HTMLLIElement {
  const label = fieldLabel(issue.field);
  const head = h('div', { className: 'issue__head' }, [
    h('span', {
      className: 'issue__icon',
      text: ICON[issue.severity],
      attrs: { 'aria-hidden': 'true' },
    }),
    h('code', { className: 'issue__rule', text: issue.ruleId }),
  ]);
  const linked = link !== undefined && issue.field !== '' && link.canShow(issue.field);
  if (linked) {
    // A real button for keyboard and screen reader users; a click anywhere on the card works too.
    head.append(
      h('button', {
        className: 'issue__field issue__show',
        text: label === '' ? issue.field : label,
        attrs: {
          type: 'button',
          // The JSON path, for people editing the invoice by hand.
          title: issue.field,
          'aria-label': `Show ${label === '' ? issue.field : label} in the editor`,
        },
      }),
    );
  } else if (label !== '') {
    head.append(h('span', { className: 'issue__field', text: label }));
  }

  const item = h('li', { className: `issue issue--${issue.severity}` }, [
    head,
    h('p', { className: 'issue__message', text: issue.message }),
  ]);
  if (linked) {
    item.classList.add('issue--linked');
    item.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a') !== null) return;
      // Don't steal a click that ends a text selection inside the card.
      const selection = window.getSelection();
      if (selection !== null && !selection.isCollapsed && item.contains(selection.anchorNode)) {
        return;
      }
      link.show(issue.field);
    });
  }
  if (issue.fix !== undefined) {
    item.append(h('p', { className: 'issue__fix' }, [h('strong', { text: 'Fix: ' }), issue.fix]));
  }
  if (issue.citation !== undefined) {
    item.append(h('p', { className: 'issue__citation', text: issue.citation }));
  }
  return item;
}

function renderGroup(
  severity: Severity,
  issues: Issue[],
  link: FieldLink | undefined,
): HTMLElement {
  const list = h(
    'ul',
    { className: 'issues' },
    issues.map((i) => renderIssue(i, link)),
  );
  const title = `${GROUP_TITLE[severity]} (${issues.length})`;
  return h('section', { className: `group group--${severity}` }, [
    h('h3', { className: 'group__title', text: title }),
    list,
  ]);
}

export interface RenderOptions {
  /** Whether the Info group starts open. */
  infoOpen: boolean;
  onInfoToggle: (open: boolean) => void;
  /** Lets a click on an issue select its field in the editor. */
  fieldLink?: FieldLink;
}

/** Replace the panel's contents with the outcome. */
export function renderResults(panel: HTMLElement, outcome: Outcome, options: RenderOptions): void {
  if (outcome.kind === 'empty') {
    panel.replaceChildren(
      h('div', { className: 'empty' }, [
        h('p', { className: 'empty__title', text: 'No invoice yet' }),
        h('p', {
          text: 'Paste a JSON or UBL XML invoice into the editor, drop a file anywhere on the page, or use Open file.',
        }),
      ]),
    );
    return;
  }
  if (outcome.kind === 'crashed') {
    panel.replaceChildren(
      h('div', { className: 'summary summary--error' }, [
        h('p', { className: 'status status--error' }, [
          h('span', { text: '✗', attrs: { 'aria-hidden': 'true' } }),
          ' invoicelint crashed',
        ]),
        h('p', {
          className: 'summary__detail',
          text: `This is a bug: bad invoice data should never crash it. Error: ${outcome.message}`,
        }),
        h('p', { className: 'summary__detail' }, [
          h('a', { text: 'Report it on GitHub', attrs: { href: ISSUES_URL } }),
        ]),
      ]),
    );
    return;
  }

  const head = headline(outcome);
  const badges = h('div', { className: 'badges' }, [
    h('span', { className: `status status--${head.tone}` }, [
      h('span', { text: head.icon, attrs: { 'aria-hidden': 'true' } }),
      ` ${head.title}`,
    ]),
    h('span', { className: 'badge', text: FORMAT_LABEL[outcome.format] }),
  ]);
  const summary = h('div', { className: `summary summary--${head.tone}` }, [
    badges,
    h('p', { className: 'summary__detail', text: head.detail }),
  ]);
  const tier = tierSummary(outcome);
  if (tier !== undefined) {
    badges.append(h('span', { className: 'badge badge--tier', text: tier.badge }));
    summary.append(h('p', { className: 'summary__detail', text: tier.caption }));
  }

  const { errors, warnings, infos } = outcome.report;
  const sections: HTMLElement[] = [summary];
  const link = options.fieldLink;
  if (errors.length > 0) sections.push(renderGroup('error', errors, link));
  if (warnings.length > 0) sections.push(renderGroup('warning', warnings, link));
  if (infos.length > 0) {
    const details = h('details', { className: 'group group--info' }, [
      h('summary', { className: 'group__title', text: `Info (${infos.length})` }),
      h(
        'ul',
        { className: 'issues' },
        infos.map((i) => renderIssue(i, link)),
      ),
    ]);
    details.open = options.infoOpen;
    details.addEventListener('toggle', () => {
      options.onInfoToggle(details.open);
    });
    sections.push(details);
  }
  panel.replaceChildren(...sections);
}
