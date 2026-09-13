export type SettledTask<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 2,
): Promise<SettledTask<T>[]> {
  const results = new Array<SettledTask<T>>(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export async function withExponentialRetry<T>(
  task: (attempt: number) => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  options: { maxAttempts?: number; baseDelayMs?: number; wait?: (ms: number) => Promise<void> } = {},
) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 800;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      await wait(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
