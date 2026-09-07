export class TerminalOriginError extends Error {
  readonly status = 403;

  constructor() {
    super('Forbidden origin');
    this.name = 'TerminalOriginError';
  }
}

function httpOrigin(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function hostName(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

export function assertTerminalOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): void {
  const origin = httpOrigin(request.headers.get('Origin')?.trim() ?? '');
  if (!origin || origin.origin === 'null') throw new TerminalOriginError();
  const configured = env.WEB_UI_ORIGIN?.trim();
  if (configured && configured !== '*') {
    const allowed = httpOrigin(configured);
    if (allowed?.origin !== origin.origin) throw new TerminalOriginError();
    return;
  }
  if (hostName(request.headers.get('Host') ?? '') !== origin.hostname) {
    throw new TerminalOriginError();
  }
}
