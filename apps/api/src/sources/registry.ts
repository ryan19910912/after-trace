import { TaipeiSportsCenterAdapter } from './taipei-sports-center';
import { TinyBookAdapter } from './tinybook';
import type { AvailabilitySourceAdapter } from './types';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class SourceAdapterRegistry {
  private readonly adapters = new Map<string, AvailabilitySourceAdapter>();

  constructor(adapters: AvailabilitySourceAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: AvailabilitySourceAdapter): void {
    if (this.adapters.has(adapter.code)) {
      throw new Error(`Duplicate availability source adapter: ${adapter.code}`);
    }
    this.adapters.set(adapter.code, adapter);
  }

  get(sourceCode: string): AvailabilitySourceAdapter {
    const adapter = this.adapters.get(sourceCode);
    if (!adapter) throw new Error(`Unknown availability source adapter: ${sourceCode}`);
    return adapter;
  }

  list(): AvailabilitySourceAdapter[] {
    return [...this.adapters.values()];
  }
}

export function createDefaultSourceRegistry(fetcher: Fetcher = fetch): SourceAdapterRegistry {
  return new SourceAdapterRegistry([
    new TaipeiSportsCenterAdapter(fetcher),
    new TinyBookAdapter(fetcher),
  ]);
}
