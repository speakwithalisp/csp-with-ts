import { IStream, ProcessEvents } from './constants';
import { IChan, IChanValue, IProc, IProcE, ProcessEventQ, IGoordinator, IProcEventsProp, IProcSleepE } from './interfaces';
import { instruction, instructionCallback } from './instructions';
import { createQ } from './processQueue';
import { queueImmediately } from './scheduler';
import { CSP } from './service';
import { chan } from './channels';
import { putAsync } from './processEvents';
// Coordination of processes (IPC) via channels

export const KILL = function (this: IProc) { this.kill(); }

// registry functions
export function register(this: IGoordinator, process: IProc): void {
    let event: IProcEventsProp;
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

// function* singletonPut(ch: IChan<boolean>): Generator<IChanValue<boolean>, void, undefined> {
//     console.log('da dirty deed will commence');
//     yield true;
//     console.log('da dirty deed is done');
//     ch.close();
//     console.log(ch);
//     console.log(CSP().get(ch));
// }

export class Process implements IProc {
    private _events: Array<IProcEventsProp>;
    private _killHook: (() => void) | null;
    private _channel: IChan<boolean>;
    private _thread: (procInst: IProc, pop: () => IProcEventsProp | undefined) => Generator<undefined, void, undefined | Generator<undefined, void, undefined>>;
    private _live: boolean;
    constructor(obj: { events: IProcEventsProp[]; kill?: () => void; thread: (procInst: IProc, pop: () => IProcEventsProp | undefined) => Generator<undefined, void, undefined | Generator<undefined, void, undefined>>; }) {
        if (obj.kill) {
            this._killHook = obj.kill;
        }
        else {
            this._killHook = null;
        }
        this._thread = obj.thread;
        this._events = obj.events;
        this._channel = chan<boolean>();
        this._live = false;
        if (!CSP().has(this._channel)) { CSP().set(this._channel, createQ<boolean>(this._channel)); }
        register.apply(CSP(), [this]);
    }
    kill() {
        for (const proc of this._events) {
            if (isProcess(proc)) {
                if (proc !== this && !proc.channel.closed) {
                    setImmediate(proc.kill);
                }
            }
            else {
                if (!proc.isDone) {
                    if ((proc as Exclude<IProcEventsProp, IProc>).event === ProcessEvents.SLEEP) { (proc as IProcSleepE)(() => { }); }
                    //requestAnimationFrame
                    else { setImmediate(queueImmediately, proc); }
                }
            }
        }
        if (CSP().has(this._channel) && !this._channel.closed) {
            putAsync(this._channel, true, true, () => { this._live = false; });
        }
        if (this._killHook) { this._killHook(); }
    }
    run() {
        const thread = this._thread(this, this._events.pop.bind(this._events));
        thread.next();
        this._live = true;
        thread.next(thread);
    }
    get events() { return this._events; }
    get channel() { return this._channel; }
    get isLive() { return this._live; }
}

export function isProcess(val: any): val is IProc {
    if (val instanceof Process) { return true; }
    return false;
}

// process creation function.
export function createProcess(...procEventsArgs: IProcEventsProp[]): IProc {
    //TODO: Add backPressure queue
    // const coordinator: typeof KILL[] = new Array(1);
    let procEvents = procEventsArgs.reverse();
    function* makeThread(procInstance: IProc, pop: () => IProcEventsProp | undefined): Generator<undefined, void, undefined | Generator<undefined, void, undefined>> {
        if (!procInstance.events.length || procInstance.events.every(proc => isProcess(proc) ? proc.channel.closed : (proc as IProcE<ProcessEvents, IStream, IStream>).isDone)) { // coordinator.push(KILL.bind(procInstance));
            KILL.call(procInstance);
        }
        const thread: undefined | Generator<undefined, void, undefined> = yield;
        if (!thread) { throw new Error("coroutine thread instance not provided"); }
        try {
            while (procInstance.events.length) {
                let tempProc = procInstance.events[procInstance.events.length - 1]!.channel;
                if (isProcess(procInstance.events[procInstance.events.length - 1])) {
                    const proc: IProc = procInstance.events[procInstance.events.length - 1] as IProc;
                    proc.run();
                    if (!proc.channel.closed) {
                        (CSP().get(proc.channel)! as ProcessEventQ<boolean>).add(instructionCallback(ProcessEvents.TAKE, proc.channel, ((_: boolean) => { }) as (((val?: IChanValue<boolean>) => IChanValue<boolean> | void) & { close?: boolean; }), thread));
                        yield;
                    }
                }
                else {
                    const proc: typeof tempProc extends IChan<infer T, infer S> ? IProcE<ProcessEvents, T, S> : never = procInstance.events[procInstance.events.length - 1] as IProcE<ProcessEvents, IStream, IStream>;
                    if (!CSP().has(proc.channel)) { break; }
                    if (proc.event === ProcessEvents.SLEEP) { (CSP().get(proc.channel)! as ProcessEventQ<boolean>).add(instructionCallback(ProcessEvents.SLEEP, proc.channel, proc, thread)); }
                    else {
                        (CSP().get(proc.channel)! as typeof tempProc extends IChan<infer T, infer S> ? ProcessEventQ<T, S> : never).add(instruction(proc, proc.channel, thread));
                    }
                    yield;
                    //                  console.log('i should be done', proc);
                }
                pop();
            }
        }
        finally {
            if (!procInstance.events.length || procInstance.events.every(proc => (proc as IProcE<ProcessEvents, IStream, IStream>).isDone)) { KILL.call(procInstance); }
        }
    }
    let proto = { events: procEvents, thread: makeThread };
    const ret: IProc = new Process(proto);
    return ret;
}

export function createAlts(returnChan: IChan<IStream>, winVal: { readonly val: IChanValue<IStream> | undefined; done?: boolean; setVal(val: IChanValue<IStream>): void }, altFlag: boolean, ...processEvents: IProcE<ProcessEvents, IStream, IStream>[]): IProc {
    function* makeThread(procInst: IProc): Generator<undefined, void, undefined | Generator<undefined, void, undefined>> {
        let proc: IProcEventsProp;
        const thread: undefined | Generator<undefined, void, undefined> = yield;
        if (!thread) { throw new Error("coroutine thread instance not provided"); }
        try {
            for (proc of procInst.events) {
                if (!CSP().has(proc.channel)) { break; }
                if ((proc as Exclude<IProcEventsProp, IProc>).event === ProcessEvents.SLEEP) { continue; }
                (CSP().get(proc.channel)! as typeof proc.channel extends IChan<infer T, infer S> ? ProcessEventQ<T, S> : never).add(instruction(proc as Exclude<Exclude<IProcEventsProp, IProc>, IProcSleepE>, proc.channel, thread));
            }
            yield;
            const winner: IProcE<ProcessEvents, IStream> | undefined = procInst.events.filter(ev => (ev as Exclude<IProcEventsProp, IProc>).isDone).pop() as Exclude<IProcEventsProp, IProc>;
            if (winner === undefined) { throw new Error("Unable to make a selection"); }
            if (winner.event === ProcessEvents.SLEEP) { throw new Error("Sleep is not a valid event for select operation"); }
            // CSP().get(returnChan)!.addCallback(instructionCallback(ProcessEvents.PUT, returnChan, () => winner!.channel, thread));
            altFlag = false;
            for (proc of procInst.events) { if (!isProcess(proc) && proc.event !== ProcessEvents.SLEEP) { proc.return(); } }
            // experimental: do I need this complexity?
            if (winner.channel.closed && !winner.channel.altFlag) {
                (CSP().get(returnChan)! as typeof returnChan extends IChan<infer T, infer S> ? ProcessEventQ<T, S> : never).add(instructionCallback(ProcessEvents.PUT, returnChan, () => winVal.val, thread, false));
            }
            else {
                /*
                  if (winner.event === ProcessEvents.TAKE) {
                  (CSP().get(winner!.channel)! as typeof winner.channel extends IChan<infer T, infer S> ? ProcessEventQ<T, S> : never)
                  .add(instructionCallback(ProcessEvents.PUT, returnChan, () => winVal.val, makeFakeThread(), false));
                  }
                  (CSP().get(returnChan)! as typeof returnChan extends IChan<infer T> ? ProcessEventQ<T> : never)
                  .add(instructionCallback(ProcessEvents.PUT, returnChan, () => winner!.channel, thread, false));
                */
                (CSP().get(returnChan)! as typeof returnChan extends IChan<infer T> ? ProcessEventQ<T> : never)
                    .add(instructionCallback(ProcessEvents.PUT, returnChan, () => winVal.val, thread, false));
            }
            yield;
        }
        finally {
            KILL.call(procInst);
        }
    }
    // console.log('i am reborn');
    const proc = Object.create({ events: processEvents, thread: makeThread }, {
        kill: {
            value() {
                returnChan.altFlag = altFlag;
                returnChan.close();
            }
        }
    });
    if (!CSP().has(returnChan)) { CSP().set(returnChan, createQ<IStream>(returnChan)); }
    const ret: IProc = new Process(proc);
    return ret;
}
