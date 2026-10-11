import { IStream } from './constants';
import { IChan, ProcessEventQ, IGoordinator, IProc } from './interfaces';

/** Built-in ways to schedule the next step of a process (see the dispatcher). */
export type SchedulerName = 'messagechannel' | 'immediate' | 'timeout' | 'microtask';

/** Initial configuration for the coordinator. Pass it to `configure()` before creating any channel. */
export interface CSPConfig {
    /**
     * How deferred steps are scheduled. Default: 'messagechannel' in browsers, 'immediate' (setImmediate) in Node.
     * 'timeout' is the setTimeout(0) fallback; 'microtask' exists for A/B comparisons.
     */
    scheduler?: SchedulerName;
    /** Collect debug counters (dispatches, parked handlers, live processes, timers). Default false. */
    debug?: boolean;
}

export interface ResolvedConfig {
    readonly scheduler: SchedulerName;
    readonly debug: boolean;
}

function defaultScheduler(): SchedulerName {
    return typeof setImmediate === 'function' ? 'immediate' : 'messagechannel';
}

let CSPInstance: IGoordinator | null = null;
let registerFn: ((this: IGoordinator, process: IProc) => void) | undefined;
let config: ResolvedConfig = { scheduler: defaultScheduler(), debug: false };

/**
 * Set the initial configuration. Must be called before the coordinator is first used (i.e. before the first
 * channel or process is created); calling it later throws, because already-queued work would mix schedulers.
 */
export function configure(options: CSPConfig): void {
    if (CSPInstance) {
        throw new Error('configure() must be called before any channel or process is created');
    }
    config = {
        scheduler: options.scheduler ?? config.scheduler,
        debug: options.debug ?? config.debug,
    };
}

/** The configuration in effect. */
export function getConfig(): ResolvedConfig {
    return config;
}

export function CSP(reg?: ((this: IGoordinator, process: IProc) => void)): IGoordinator {
    if (reg && !registerFn) { registerFn = reg; }
    if (!CSPInstance) {
        let ret = new WeakMap<IChan<IStream>, ProcessEventQ<IStream>>();
        const register: (this: IGoordinator, process: IProc) => void = registerFn!;
        Object.defineProperties(ret, {
            register: { value: register },
        });
        CSPInstance = ret as IGoordinator;
    }
    return CSPInstance as IGoordinator;
}

/**
 * Test-only: drop the registry and restore the default configuration, so queues and settings from one test can't
 * leak into the next. Channels created before the reset belong to the old registry and must not be reused.
 */
export function __resetCSP(options: CSPConfig = {}): void {
    CSPInstance = null;
    config = { scheduler: defaultScheduler(), debug: false };
    configure(options);
}
