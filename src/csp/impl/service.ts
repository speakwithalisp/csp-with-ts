import { IStream, ProcessEvents } from './constants';
import { IChan } from './channels';
import { IProcE } from './processEvents';
import { ProcessEventQ, createQ } from './processQueue';
import { IProc, KILL } from './process';

// Global registry of processes
export interface IGoordinator<T extends IStream = IStream, S extends IStream = T> extends WeakMap<IChan<T, S>, ProcessEventQ<T, S>> {
    set<T extends IStream, S extends IStream = T>(chan: IChan<T, S>, q: ProcessEventQ<T, S>): this;
    get<T extends IStream, S extends IStream = T>(chan: IChan<T, S>): ProcessEventQ<T, S>;
    register(this: IGoordinator, process: IProc): void;
    terminate(this: IGoordinator, proc: IProc): void;
};
// registry functions
export function register(this: IGoordinator, process: IProc): void {
    let event: IProcE<ProcessEvents, IStream>;
    for (event of process.events)
        if (!this.has(event.channel)) {
            if (event.channel.hasXForm) {
                this.set<typeof event.channel extends IChan<infer T> ? T : never>(event.channel, createQ(event.channel));
            }
            else {
                this.set(event.channel, createQ<typeof event.channel extends IChan<infer T, infer _> ? T : never, typeof event.channel extends IChan<infer _, infer S> ? S : never>(event.channel));
            }
        }
}

// close function
export function terminate(this: IGoordinator, process: IProc): void {
    // process.coordinator.push(KILL);
    setImmediate(() => KILL.call(process));
}

let CSPInstance: IGoordinator;
export default function CSP(): IGoordinator {
    if (!CSPInstance) {
        let ret = new WeakMap<IChan<IStream>, ProcessEventQ<IStream>>();
        Object.defineProperties(ret, {
            register: { value: register },
            terminate: { value: terminate },
        })
        CSPInstance = ret as IGoordinator;
    }
    return CSPInstance;
}
