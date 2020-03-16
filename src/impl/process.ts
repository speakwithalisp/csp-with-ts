import { IStream, ProcessEvents } from './constants';
import { IChan, IChanValue, IProc, IProcE, ProcessEventQ, IGoordinator, Thread } from './interfaces';
import { instruction, instructionCallback } from './instructions';
import { createQ } from './processQueue';
import { queueImmediately } from './scheduler';
import { makeFakeThread } from './utils';
import { CSP } from './service';
// Coordination of processes (IPC) via channels

export const KILL = function (this: IProc) { this.kill(); }

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

// process creation function.
export function createProcess(...procEventsArgs: IProcE<ProcessEvents, IStream, IStream>[]): IProc {
    //TODO: Add backPressure queue
    // const coordinator: typeof KILL[] = new Array(1);
    let procEvents = procEventsArgs.reverse();
    function* makeThread(procInstance: IProc): Generator<undefined, void, undefined | Generator<undefined, void, undefined>> {
        if (!procEvents.length || procEvents.every(proc => proc.isDone)) { // coordinator.push(KILL.bind(procInstance));
            KILL.call(procInstance);
        }
        const thread: undefined | Thread<undefined, void, undefined> = yield;
        if (!thread) { throw new Error("coroutine thread instance not provided"); }
        try {
            while (procEvents.length) {
                let tempProc = procEvents[procEvents.length - 1]!.channel;
                const proc: typeof tempProc extends IChan<infer T, infer S> ? IProcE<ProcessEvents, T, S> : never = procEvents[procEvents.length - 1];
                if (!CSP().has(proc.channel)) { break; }
                if (proc.event === ProcessEvents.SLEEP) { (CSP().get(proc.channel)! as ProcessEventQ<boolean>).add(instructionCallback(ProcessEvents.SLEEP, proc.channel, proc, thread)); }
                else {
                    (CSP().get(proc.channel)! as typeof tempProc extends IChan<infer T, infer S> ? ProcessEventQ<T, S> : never).add(instruction(proc, proc.channel, thread));
                }
                yield;
                procEvents.pop();
            }
        }
        finally {
            if (!procEvents.length || procEvents.every(proc => proc.isDone)) { KILL.call(procInstance); }
        }
    }
    let ret: IProc = Object.create({}, {
        events: { get() { return procEvents; } },
        // coordinator: { get() { return coordinator; } },
        kill: {
            value() {
                for (const proc of procEvents) {
                    if (!proc.isDone) {
                        if (proc.event === ProcessEvents.SLEEP) { proc(() => { }); }
                        //requestAnimationFrame
                        else { setImmediate(queueImmediately, proc); }
                    }
                }
                procEvents = [];
            }
        },
        run: {
            value(): void {
                const thread = makeThread(this);
                thread.next();
                thread.next(thread);
            }
        }
    });
    register.apply(CSP(), [ret]);
    return ret;
}

export function createAlts(returnChan: IChan<IStream>, winVal: { readonly val: IChanValue<IStream> | undefined; done?: boolean; setVal(val: IChanValue<IStream>): void }, altFlag: boolean, ...processEvents: IProcE<ProcessEvents, IStream, IStream>[]): IProc {
    function* makeThread(procInst: IProc): Generator<undefined, void, undefined | Generator<undefined, void, undefined>> {
        let proc: IProcE<ProcessEvents, IStream>;
        const thread: undefined | Thread<undefined, void, undefined> = yield;
        if (!thread) { throw new Error("coroutine thread instance not provided"); }
        try {
            for (proc of procInst.events) {
                if (!CSP().has(proc.channel)) { break; }
                if (proc.event === ProcessEvents.SLEEP) { continue; }
                (CSP().get(proc.channel)! as typeof proc.channel extends IChan<infer T, infer S> ? ProcessEventQ<T, S> : never).add(instruction(proc, proc.channel, thread));
            }
            yield;
            const winner: IProcE<ProcessEvents, IStream> | undefined = procInst.events.filter(ev => ev.isDone).pop();
            if (winner === undefined) { throw new Error("Unable to make a selection"); }
            if (winner.event === ProcessEvents.SLEEP) { throw new Error("Sleep is not a valid event for select operation"); }
            // CSP().get(returnChan)!.addCallback(instructionCallback(ProcessEvents.PUT, returnChan, () => winner!.channel, thread));
            altFlag = false;
            if (winner.channel.closed && !winner.channel.altFlag) {
                (CSP().get(returnChan)! as typeof returnChan extends IChan<infer T, infer S> ? ProcessEventQ<T, S> : never).add(instructionCallback(ProcessEvents.PUT, returnChan, () => winVal.val, thread, false));
            }
            else {
                if (winner.event === ProcessEvents.TAKE) {
                    (CSP().get(winner!.channel)! as typeof winner.channel extends IChan<infer T, infer S> ? ProcessEventQ<T, S> : never)
                        .add(instructionCallback(ProcessEvents.PUT, returnChan, () => winVal.val, makeFakeThread(), false));
                }
                (CSP().get(returnChan)! as typeof returnChan extends IChan<infer T> ? ProcessEventQ<T> : never)
                    .add(instructionCallback(ProcessEvents.PUT, returnChan, () => winner!.channel, thread, false));
            }
            yield;
        }
        finally {
            KILL.call(procInst);
        }
    }

    const proc: IProc = Object.create({}, {
        events: {
            get() { return processEvents; }
        },
        kill: {
            value() {
                let proc: IProcE<ProcessEvents, IStream>;
                for (proc of processEvents) {
                    if (!proc.isDone) {
                        setImmediate(queueImmediately, proc);
                    }
                }
                returnChan.altFlag = altFlag;
                returnChan.close();
            }
        },
        run: {
            value(): void {
                const thread = makeThread(this);
                thread.next();
                thread.next(thread);
            }
        }
    });
    if (!CSP().has(returnChan)) { CSP().set(returnChan, createQ<IStream>(returnChan)); }
    register.apply(CSP(), [proc]);
    return proc;
}
