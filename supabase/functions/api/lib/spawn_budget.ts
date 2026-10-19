// Shared daily spawn budget store for Ask Slippay subprocess engine.
// Tracks total Claude CLI spawns per UTC day across the deployment.

export interface ReserveResult {
  allowed: boolean;
  remaining: number;
  count: number;
  ceiling: number;
}

export interface DailyBudgetStore {
  tryReserve(day: string, maxDaily: number): Promise<ReserveResult>;
  refund(day: string): Promise<number>;
  getCount(day: string): Promise<number>;
  reset(day?: string): Promise<void>;
}

// Global symbol to ensure isolates in the same runtime share the identical memory state
const GLOBAL_STORE_KEY = Symbol.for("slippay.ask.daily_spawn_store.v1");

interface StoreState {
  counts: Map<string, number>;
}

function getGlobalState(): StoreState {
  const g = globalThis as unknown as { [GLOBAL_STORE_KEY]?: StoreState };
  if (!g[GLOBAL_STORE_KEY]) {
    g[GLOBAL_STORE_KEY] = {
      counts: new Map<string, number>(),
    };
  }
  return g[GLOBAL_STORE_KEY]!;
}

export class SharedDailyBudgetStore implements DailyBudgetStore {
  private state: StoreState;

  constructor(state?: StoreState) {
    this.state = state ?? getGlobalState();
  }

  async tryReserve(day: string, maxDaily: number): Promise<ReserveResult> {
    const current = this.state.counts.get(day) ?? 0;
    if (current >= maxDaily) {
      console.warn(
        `[ask] daily spawn budget exhausted: ${current}/${maxDaily} (remaining: 0, day: ${day})`,
      );
      return {
        allowed: false,
        remaining: 0,
        count: current,
        ceiling: maxDaily,
      };
    }
    const next = current + 1;
    this.state.counts.set(day, next);
    const remaining = Math.max(0, maxDaily - next);
    return {
      allowed: true,
      remaining,
      count: next,
      ceiling: maxDaily,
    };
  }

  async refund(day: string): Promise<number> {
    const current = this.state.counts.get(day) ?? 0;
    if (current > 0) {
      const next = current - 1;
      this.state.counts.set(day, next);
      return next;
    }
    return 0;
  }

  async getCount(day: string): Promise<number> {
    return this.state.counts.get(day) ?? 0;
  }

  async reset(day?: string): Promise<void> {
    if (day) {
      this.state.counts.delete(day);
    } else {
      this.state.counts.clear();
    }
  }
}

export const defaultSpawnBudgetStore: DailyBudgetStore = new SharedDailyBudgetStore();
