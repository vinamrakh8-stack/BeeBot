import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * jsdom has no EventSource. The store opens one as soon as a user is present,
 * so tests get a harmless stub that records nothing and never emits events.
 */
class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(): void {
    // No server-sent events in tests.
  }

  removeEventListener(): void {
    // No server-sent events in tests.
  }

  close(): void {
    this.readyState = 2;
  }
}

(globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource =
  MockEventSource;

afterEach(() => {
  cleanup();
  MockEventSource.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
