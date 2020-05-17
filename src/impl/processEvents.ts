import { IStream, ProcessEvents, CLOSED } from './constants';
import { isChan } from './channels';
import { makeFakeThread } from './utils';
import { IChanValue, IChan, IProcPutE, IProcTakeE, IProcSleepE } from './interfaces';
import { CSP } from './service';
import { instructionCallback } from './instructions';
import { createQ } from './processQueue';

export function put<T extends IStream, S extends IStream = T>(chan: IChan<T, S>, source: IChan<any, T> | (() => Generator<IChanValue<T>, any, any>), altFlag?: boolean): IProcPutE<T, S> {
    let isDone: boolean = false;
    let newSource = isChan(source) ? function* () { yield source as IChanValue<T>; } : source;
    function* proc() {
        try {
            const push: Generator<IChanValue<T>, IChanValue<T>, any> = newSource();
            let state: { value: IChanValue<T>; done?: boolean | undefined; } = push.next();
            if (isChan(source)) { yield state.value; push.return(state.value); isDone = true; return; }
            if (state.done) { push.return(state.value); isDone = true; return; }
            while (!state.done) {
                yield state.value;
                state = push.next();
                if (!!state.done) { break; }
            }
        }
        finally {
            isDone = true;
        }
    }
    Object.defineProperties(proc.prototype, { isDone: { get() { return isDone; } }, channel: { get() { return chan; } }, event: { get() { return ProcessEvents.PUT; } }, altFlag: { get() { return !!altFlag; } } });
    return proc() as IProcPutE<T, S>;
}


export function take<T extends IStream, S extends IStream = T>(chan: IChan<T, S>, sink?: () => Generator<undefined, any, IChanValue<S>>, altFlag?: boolean, pred?: (arg?: IChanValue<S>) => boolean): IProcTakeE<T, S> {
    let isDone: boolean = false;
    function* proc() {
        try {
            //        console.log('slink', sink);
            const pull: Generator<undefined, void, IChanValue<S>> | undefined = sink ? sink() : undefined;
            let done = false;
            let state: IChanValue<S> | undefined;
            if (!!pull) { pull.next(); }
            while (!done) {
                state = yield;
                if (state === undefined || state === CLOSED) { if (pull) { pull.return(); } isDone = true; break; }
                if (pred && !pred(state)) { if (pull) { pull.return(); } isDone = true; break; }
                if (pull) { done = !!pull.next(state).done; }
                // else { yield state; }
            }
            if (!done && pull) { pull.return(); }
        }
        finally {
            isDone = true;
        }
    }
    Object.defineProperties(proc.prototype, { isDone: { get() { return isDone; } }, channel: { get() { return chan; } }, event: { get() { return ProcessEvents.TAKE; } }, altFlag: { get() { return !!altFlag; } } });
    return proc() as IProcTakeE<T, S>;
}


export function sleep(chan: IChan<boolean>, msecs: number): IProcSleepE {
    let isDone: boolean = false;
    const cb = (someCb: (() => void)) => { isDone = true; someCb(); };
    const ret = (someCb: (() => void)) => { setTimeout(cb, msecs, someCb); }
    Object.defineProperties(ret, { isDone: { get() { return isDone; } }, channel: { get() { return chan; } }, event: { get() { return ProcessEvents.SLEEP; } } });
    return ret as IProcSleepE;
}


export function putAsync<T extends IStream, S extends IStream = T>(ch: IChan<T, S>, val: T, close?: boolean, cb?: () => any | void): void {
    if (!CSP().has(ch)) { CSP().set(ch, createQ<T, S>(ch)); }
    // CSP().get(ch)!.addCallback(instructionCallback(ProcessEvents.PUT, ch, () => { cb && cb(); return val; }, makeFakeThread()));
    const mainCB = () => { cb && cb(); return val; };
    Object.defineProperty(mainCB, 'close', { get() { return !!close; } });
    CSP().get(ch)!.add(instructionCallback(ProcessEvents.PUT, ch, mainCB, makeFakeThread()));
}

export function takeAsync<T extends IStream, S extends IStream = T>(ch: IChan<T, S>): Promise<IChanValue<S>> {
    if (!CSP().has(ch)) { CSP().set(ch, createQ<T, S>(ch)); }
    const ret: Promise<IChanValue<S>> = new Promise<IChanValue<S>>(resolve => {
        // CSP().get(ch)!.addCallback(instructionCallback(ProcessEvents.TAKE, ch, resolve as ((val: T) => T), makeFakeThread()));
        CSP().get<T, S>(ch)!.add(instructionCallback(ProcessEvents.TAKE, ch, resolve, makeFakeThread()));
    });
    return ret;
}
