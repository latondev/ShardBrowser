export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export class SelectorNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorNotFoundError';
  }
}

export function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  delay: number = 1000
): Promise<T> {
  let attempts = 0;
  const execute = async (): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      attempts++;
      if (attempts > maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      return execute();
    }
  };
  return execute();
}