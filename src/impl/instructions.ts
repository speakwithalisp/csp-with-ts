import { IStream, InstrTypes, ProcessEvents, CLOSED } from './constants';
import { IChan, IChanValue, InstructionGeneral, InstructionCallback, IProcE, IProcSleepE } from './interfaces';
import { queueNextOnThread } from './scheduler';
import { CSP } from './service';

// Instruction

export function instruction<T extends IStream, S extends IStream>(event: IProcE<ProcessEvents.PUT | ProcessEvents.TAKE, T, S>, ch: IChan<T, S>, thread: Generator<undefined, void, undefined>): (() => InstructionGeneral<T, S>) & {
    readonly INSTRUCTION: InstrTypes.GENERAL;
    readonly event: ProcessEvents;
    readonly channel: IChan<T, S>;
} {
    function* instr() {
        try {
            ch.altFlag = event.altFlag;
            if (!CSP().has(ch)) {
                event && event.return();
                setImmediate(queueNextOnThread, thread);
                return;
            }
            else if (event.event === ProcessEvents.PUT) {
                let value: IChanValue<T> | undefined | void, done: boolean | undefined;
                while (true) {
                    if (ch.closed) {
                        event && event.return();
                        setImmediate(queueNextOnThread, thread);
                        return;
                    }
                    // if (ch.isFull()) { break; }
                    ({ value, done } = event.next());
                    if (value === undefined || done) {
                        if (value !== undefined) { yield value; }
                        event.return();
                        break;
                    }
                    yield value;
                }
            }
            else if (event.event === ProcessEvents.TAKE) {
                if (ch === event.channel) { event.next(); }
                let state: IChanValue<S> | undefined, done: boolean | undefined;
                while (true) {
                    state = yield;
                    //             console.log('in de state', state);
                    // if (event.altFlag) { ch.altFlag = false; }
                    if (state === undefined || state === CLOSED) { event.return(); break; }
                    ({ done } = event.next(state as IChanValue<S>));
                    if (event.altFlag || done) { setImmediate(queueNextOnThread, thread); event.return(); break; }
                }
            }
        }
        finally {
            setImmediate(queueNextOnThread, thread);
            event.return();
        }
    }
    Object.defineProperties(instr, { INSTRUCTION: { get() { return InstrTypes.GENERAL; } }, channel: { get() { return ch; } }, event: { get() { return event.event; } }, thread: { get() { return thread; } } });
    Object.defineProperties(instr.prototype, { INSTRUCTION: { get() { return InstrTypes.GENERAL; } }, channel: { get() { return ch; } }, stale: { get() { return event.isDone; } }, event: { get() { return event.event; } }, thread: { get() { return thread; } } });
    return instr as (() => InstructionGeneral<T, S>) & {
        readonly INSTRUCTION: InstrTypes.GENERAL;
        readonly event: ProcessEvents;
        readonly channel: IChan<T, S>;
    };
}

export function instructionCallback<T extends IStream, S extends IStream = T>(event: ProcessEvents, ch: IChan<T, S>, cb: IProcSleepE | (((val?: IChanValue<S>) => IChanValue<T> | void) & { close?: boolean; }), thread: Generator<undefined, void, undefined>, altFlag?: boolean): InstructionCallback<T, S> {
    let ret: IProcSleepE | (((val?: IChanValue<S>) => IChanValue<T> | void) & { close?: boolean; });
    ch.altFlag = !!altFlag;
    switch (event) {
        case ProcessEvents.SLEEP:
            let ceeBee: Exclude<typeof ret, IProcSleepE> = () => { return true as IChanValue<T>; }
            ceeBee.close = true;
            ret = () => {
                const a: (() => void) = () => {
                    CSP().get<T, S>(ch)!.add(
                        instructionCallback(
                            ProcessEvents.PUT,
                            ch,
                            ceeBee as Exclude<typeof ret, IProcSleepE>,
                            thread
                        ));
                    if (!ch.altFlag) { ch.close(); }
                };
                (cb as IProcSleepE)(a);
            };
            break;
        case ProcessEvents.TAKE:
            ret = ((myVal: IChanValue<S>) => {
                (cb as Exclude<typeof ret, IProcSleepE>)(myVal);
                setImmediate(queueNextOnThread, thread);
            }) as Exclude<typeof ret, IProcSleepE>;
            break;
        default: ret = () => {
            setImmediate(queueNextOnThread, thread);
            const ret: IChanValue<T> = (cb as (() => IChanValue<T>) & { close?: boolean; })() as IChanValue<T>; return ret;
        };
            Object.defineProperties(ret, { close: { get() { return !!(cb as (() => IChanValue<T>) & { close?: boolean; }).close; } } });
            break;
    }
    Object.defineProperties(ret, {
        channel: { get() { return ch; } },
        event: { get() { return event; } },
        INSTRUCTION: { get() { return InstrTypes.CALLBACK; } },
        thread: { get() { return thread; } },
        altFlag: { get() { return !!altFlag; } }
    });
    return ret as InstructionCallback<T, S>;
}
