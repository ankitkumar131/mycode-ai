import type {
  OrchestrationRequest,
  OrchestrationTaskSpec,
  TaskPlan,
  TaskPlanner,
} from './types.js';

const BROWSER_TERMS = [
  'browser',
  'chrome',
  'website',
  'web page',
  'webpage',
  'frontend',
  'front-end',
  'ui',
  'login flow',
  'click',
  'form',
  'visual',
  'in the page',
  'in the app',
];

const FIX_TERMS = [
  'fix',
  'repair',
  'debug',
  'bug',
  'broken',
  'failing',
  'failure',
  'error',
  'regression',
  'implement',
  'change',
  'update',
];

const DECISION_TERMS = [
  'classify',
  'categorize',
  'route',
  'triage',
  'which should',
  'choose the best',
  'is this',
  'should we',
  'confidence',
  'yes or no',
  'score these',
];

const PARALLEL_TERMS = [
  'in parallel',
  'simultaneously',
  'at the same time',
  'multiple agents',
  'several agents',
  'parallel agents',
  'independently',
];

const SANDBOX_TERMS = [
  'sandbox',
  'isolated worker',
  'isolated task',
  'container worker',
  'untrusted code',
  'ax task',
];

function firstUrl(query: string): string | undefined {
  return query.match(/https?:\/\/[^\s)>'"]+/i)?.[0]?.replace(/[.,!?]+$/, '');
}

function hasTerm(query: string, terms: string[]): boolean {
  return terms.some(term => query.includes(term));
}

function task(
  id: string,
  kind: OrchestrationTaskSpec['kind'],
  title: string,
  prompt: string,
  options: Partial<OrchestrationTaskSpec> = {},
): OrchestrationTaskSpec {
  return { id, kind, title, prompt, ...options };
}

/**
 * Small, deterministic first-pass router.
 *
 * This is intentionally conservative: it recognizes strong intent signals
 * without sending every ordinary question through a browser, model gate, or
 * remote sandbox. A configured Laya gate can replace or augment this planner
 * in a later phase.
 */
export class TaskRouter implements TaskPlanner {
  plan(request: OrchestrationRequest): TaskPlan {
    const query = request.query.trim();
    const normalized = query.toLowerCase();
    const wantsBrowser = hasTerm(normalized, BROWSER_TERMS);
    const wantsFix = hasTerm(normalized, FIX_TERMS);
    const wantsDecision = hasTerm(normalized, DECISION_TERMS);
    const wantsParallel = hasTerm(normalized, PARALLEL_TERMS);
    const wantsSandbox = hasTerm(normalized, SANDBOX_TERMS);
    const url = firstUrl(query);

    let mode: TaskPlan['mode'] = 'native';
    let reason = 'Use the normal MyCode agent and tool loop.';
    let recommendedTools = ['native_tools'];
    let tasks: OrchestrationTaskSpec[] = [
      task('primary', 'native', 'Primary MyCode task', query, {
        capabilities: ['files', 'terminal', 'git', 'web'],
      }),
    ];

    if (wantsBrowser && wantsFix) {
      mode = 'fix-and-verify';
      reason = 'The request combines a code change with a browser-visible behavior; fix first, then verify the resulting application state.';
      recommendedTools = ['native_tools', 'sandbox_task', 'browser_verify'];
      tasks = [
        task('fixer', 'fixer', 'Fix the application', query, {
          capabilities: ['files', 'terminal', 'git'],
        }),
        task('browser-verifier', 'browser-verifier', 'Verify the browser behavior', `Verify the browser-visible acceptance criteria from this request after the fixer completes:\n\n${query}`, {
          dependsOn: ['fixer'],
          readOnly: true,
          capabilities: ['browser'],
          metadata: url ? { url } : undefined,
        }),
      ];
    } else if (wantsBrowser) {
      mode = 'browser';
      reason = 'The request mentions browser-visible behavior, so a browser-capable verifier should be preferred when configured.';
      recommendedTools = ['browser_verify', 'native_tools'];
      tasks = [
        task('browser-verifier', 'browser-verifier', 'Verify browser behavior', query, {
          readOnly: true,
          capabilities: ['browser'],
          metadata: url ? { url } : undefined,
        }),
      ];
    } else if (wantsDecision) {
      mode = 'decision';
      reason = 'The request asks for a typed classification, routing, score, or confidence decision.';
      recommendedTools = ['decision_gate', 'native_tools'];
      tasks = [
        task('decision', 'decision', 'Make the requested decision', query, {
          readOnly: true,
          capabilities: ['typed-decision'],
        }),
      ];
    } else if (wantsSandbox) {
      mode = 'sandbox';
      reason = 'The request asks for isolated, untrusted, containerized, or AX-backed execution.';
      recommendedTools = ['sandbox_task', 'native_tools'];
      tasks = [
        task('sandbox-worker', 'sandbox-worker', 'Run an isolated worker', query, {
          capabilities: ['sandbox', 'files', 'terminal'],
          metadata: { requestedByUser: true },
        }),
      ];
    } else if (wantsParallel) {
      mode = 'parallel';
      reason = 'The request explicitly asks for independent work to happen concurrently.';
      recommendedTools = ['parallel_delegate', 'sandbox_task', 'native_tools'];
      tasks = [
        task('parallel-primary', 'native', 'Primary parallel work', query, {
          capabilities: ['files', 'terminal', 'git', 'web'],
        }),
      ];
    }

    if (wantsParallel && mode === 'fix-and-verify') {
      reason += ' The independent checks may run concurrently after the fixer produces a stable artifact.';
    }

    return {
      id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      mode,
      reason,
      confidence: mode === 'native' ? 0.6 : 0.86,
      tasks,
      recommendedTools,
      createdAt: new Date().toISOString(),
    };
  }
}

export const taskRouter = new TaskRouter();

export function formatTaskPlanGuidance(plan: TaskPlan): string {
  if (plan.mode === 'native') return '';
  const tasks = plan.tasks
    .map(item => `- ${item.id}: ${item.title}${item.dependsOn?.length ? ` (after ${item.dependsOn.join(', ')})` : ''}`)
    .join('\n');
  return `Automatic execution plan (intent routing):
- Mode: ${plan.mode}
- Reason: ${plan.reason}
- Recommended integrations: ${plan.recommendedTools.join(', ')}
- Planned work:
${tasks}
Use a configured specialized integration when its tool is available. Do not claim that a browser, decision model, or sandbox was used unless a tool result proves it. Preserve MyCode approvals and verification rules.`;
}
