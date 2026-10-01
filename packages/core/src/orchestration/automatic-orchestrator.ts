import type { BrowserVerifier, BrowserVerificationResult } from '../integrations/browser-verifier.js';
import type { DecisionGate, DecisionResult } from '../integrations/decision-gate.js';
import type { SandboxBackend, SandboxTaskResult } from '../integrations/sandbox-backend.js';
import type { OrchestrationRequest, ServerReadiness, TaskPlan } from './types.js';

export interface AutomaticOrchestrationRuntime {
  browserVerifier?: BrowserVerifier;
  decisionGate?: DecisionGate;
  sandboxBackend?: SandboxBackend;
}

export interface AutomaticEvidence {
  kind: 'decision' | 'sandbox' | 'browser';
  phase: 'preflight' | 'postflight';
  success: boolean;
  status: string;
  summary: string;
  details?: unknown;
}

function decisionQuestions() {
  return {
    execution_path: {
      type: 'choice' as const,
      instructions: 'Which execution path best matches this request?',
      criteria: {
        native: 'ordinary explanation, code reading, or local edit using the normal MyCode tools',
        browser: 'browser-visible behavior or UI verification',
        sandbox: 'isolated, untrusted, expensive, or parallel worker execution',
        decision: 'typed classification, score, routing, or confidence decision',
      },
    },
    needs_verification: {
      type: 'noul' as const,
      instructions: 'Does the request explicitly require an independently verified outcome?',
    },
  };
}

function evidenceFromDecision(result: DecisionResult): AutomaticEvidence {
  return {
    kind: 'decision',
    phase: 'preflight',
    success: result.success,
    status: result.status,
    summary: result.summary,
    details: { answers: result.answers, routing: result.routing, confidence: result.confidence, error: result.error },
  };
}

function evidenceFromSandbox(result: SandboxTaskResult): AutomaticEvidence {
  return {
    kind: 'sandbox',
    phase: 'preflight',
    success: result.success,
    status: result.status,
    summary: result.summary,
    details: { taskName: result.taskName, output: result.output, error: result.error, evidence: result.evidence },
  };
}

function evidenceFromBrowser(result: BrowserVerificationResult): AutomaticEvidence {
  return {
    kind: 'browser',
    phase: 'postflight',
    success: result.success,
    status: result.status,
    summary: result.summary,
    details: { finalUrl: result.finalUrl, pageText: result.pageText?.slice(0, 4_000), evidence: result.evidence, error: result.error },
  };
}

function browserUrl(plan: TaskPlan): string | undefined {
  const verifier = plan.tasks.find(task => task.kind === 'browser-verifier');
  const url = verifier?.metadata?.url;
  return typeof url === 'string' ? url : undefined;
}

function browserReadiness(plan: TaskPlan): ServerReadiness | undefined {
  return plan.tasks.find(task => task.kind === 'browser-verifier')?.serverReadiness;
}

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve(true);
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(false);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function waitForServer(readiness: ServerReadiness, signal: AbortSignal): Promise<AutomaticEvidence | undefined> {
  if (!readiness.required) return undefined;
  if (!readiness.url) {
    return {
      kind: 'browser',
      phase: 'postflight',
      success: false,
      status: 'unavailable',
      summary: 'Browser verification requires a server URL, but none was provided.',
    };
  }
  const timeoutMs = Math.max(1_000, Math.min(readiness.timeoutMs ?? 30_000, 300_000));
  const pollMs = Math.max(100, Math.min(readiness.pollMs ?? 500, 5_000));
  const deadline = Date.now() + timeoutMs;
  let lastError = 'No response from the application server.';
  while (Date.now() < deadline) {
    if (signal.aborted) {
      return {
        kind: 'browser',
        phase: 'postflight',
        success: false,
        status: 'timeout',
        summary: 'Server readiness was cancelled before browser verification started.',
        details: { url: readiness.url },
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(2_000, Math.max(250, deadline - Date.now())));
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(readiness.url, { method: 'GET', signal: controller.signal });
      if (response.status < 500) return undefined;
      lastError = `Server returned HTTP ${response.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    if (!(await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())), signal))) break;
  }
  return {
    kind: 'browser',
    phase: 'postflight',
    success: false,
    status: 'timeout',
    summary: `Application server was not ready within ${timeoutMs}ms; browser verification was not started.`,
    details: { url: readiness.url, error: lastError },
  };
}

export async function runAutomaticPreflight(
  plan: TaskPlan,
  request: OrchestrationRequest,
  runtime: AutomaticOrchestrationRuntime,
  signal: AbortSignal,
): Promise<AutomaticEvidence | undefined> {
  if (plan.mode === 'decision' && runtime.decisionGate) {
    const result = await runtime.decisionGate.decide({
      state: request.query,
      questions: decisionQuestions(),
    }, { cwd: request.cwd, signal });
    return evidenceFromDecision(result);
  }

  if ((plan.mode === 'parallel' || plan.mode === 'sandbox') && runtime.sandboxBackend) {
    const primary = plan.tasks[0];
    if (!primary) return undefined;
    const result = await runtime.sandboxBackend.runTask({
      name: primary.id,
      goal: primary.prompt,
      cwd: request.cwd,
      readOnly: primary.readOnly === true,
    }, { signal });
    return evidenceFromSandbox(result);
  }

  return undefined;
}

export async function runAutomaticPostflight(
  plan: TaskPlan,
  request: OrchestrationRequest,
  runtime: AutomaticOrchestrationRuntime,
  signal: AbortSignal,
): Promise<AutomaticEvidence | undefined> {
  if ((plan.mode !== 'browser' && plan.mode !== 'fix-and-verify') || !runtime.browserVerifier) return undefined;
  const url = browserUrl(plan);
  if (!url) {
    return {
      kind: 'browser',
      phase: 'postflight',
      success: false,
      status: 'unavailable',
      summary: 'Browser verification was planned, but the request did not include an application URL.',
      details: { hint: 'Provide an http:// or https:// URL, or call browser_verify with one.' },
    };
  }
  const readiness = await waitForServer(browserReadiness(plan) ?? { required: false }, signal);
  if (readiness) return readiness;
  const result = await runtime.browserVerifier.verify({
    url,
    goal: request.query,
    allowMutations: false,
  }, { cwd: request.cwd, signal });
  return evidenceFromBrowser(result);
}

export function formatAutomaticEvidence(evidence: AutomaticEvidence): string {
  return `[Automatic ${evidence.phase} ${evidence.kind} evidence]
Status: ${evidence.status}
Success: ${evidence.success ? 'yes' : 'no'}
Summary: ${evidence.summary}
Details:
${JSON.stringify(evidence.details ?? {}, null, 2).slice(0, 8_000)}`;
}
