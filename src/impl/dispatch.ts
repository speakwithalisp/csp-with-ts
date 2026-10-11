// The single place where deferred steps are scheduled. Every former setImmediate(fn, ...args) call goes through
// dispatch(), so the scheduler can be swapped (see configure({ scheduler })) and every hop can be counted.
import { record } from './debug';

export function dispatch<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): void {
    record('dispatch');
    setImmediate(() => { fn(...args); });
}
