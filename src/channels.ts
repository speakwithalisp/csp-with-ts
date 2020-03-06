import { SyntheticEvent } from 'react';
import { fixed, FixedBuffer, ring, RingBuffer } from './buffers';
//
//          IMPORTANT
//     ,----
//     | change all instances of setTimeout (except sleep)
//     | to setImmediate.
//     | Let Babel handle browser support
//     | checking
//     `----


const MAX_DIRTY = 64;
const CLOSED = null;

export enum InstructionPutStates {
    NO_PUT_DEFAULT,
    NO_PUT_CHAN_FULL,
    DONE,
    NOT_DONE
};

export enum InstructionTakeStates {
    CHAN_VALUE_CLOSED,
    CHAN_VALUE_OPEN,
    DONE,
    NOT_DONE,
    NO_TAKE_CHAN_EMPTY,
    NO_TAKE_DEFAULT
};

export enum ProcessEvents {
    PUT,
    TAKE,
    SLEEP
};

export enum InstrTypes {
    CALLBACK,
    GENERAL
};

export type IStream = string | number | boolean | SyntheticEvent;
// type IStreamProcess = IChanValue<IStreamValue> & { readonly event: ProcessEvents; readonly channel: IChan<IStreamValue>; };

// Channel (working around circular type definitions as a Channel can accept
// another Channel as a value)
type IChanPrimitive<T extends IStream> = FixedBuffer<T>;
export type IChanValue<T extends IStream> = T | IChanPrimitive<T> | Promise<T> | typeof CLOSED;
// export interface IChan<T extends IStream> extends WeakMap<[number, number], Array<IChanValue<T>>> {
//     buffer?: number;
//     // bufferType?: Buffers;
//     push(val: IChanValue<T>): number;
//     shift(): IChanValue<T> | undefined;
//     close(): void;
// };
export interface IChan<T extends IStream> extends FixedBuffer<T> {
    remove(): IChanValue<T>;
    last(): IChanValue<T>;
    close(): void;
    readonly closed: boolean;
    altFlag: boolean;
};
// ProcessEvents type definition. Each ProcessEvent has one and only one channel
// associalted with it
export interface IProcPutE<T extends IStream> extends Generator<IChanValue<T> | undefined, void, undefined> {
    readonly event: ProcessEvents.PUT;
    readonly channel: IChan<T>;
    readonly isDone: boolean;
    readonly altFlag: boolean;
};
export interface IProcTakeE<T extends IStream> extends Generator<undefined, void, IChanValue<T>> {
    readonly event: ProcessEvents.TAKE;
    readonly channel: IChan<T>;
    readonly isDone: boolean;
    readonly altFlag: boolean;
};
export interface IProcSleepE {
    (cb: () => void): boolean;
    readonly event: ProcessEvents.SLEEP;
    readonly channel: IChan<boolean>;
    readonly isDone: boolean;
};
export type IProcE<P extends ProcessEvents, T extends IStream> = P extends ProcessEvents.PUT ? IProcPutE<T> : P extends ProcessEvents.TAKE ? IProcTakeE<T> : P extends ProcessEvents.SLEEP ? IProcSleepE : never;

// Instruction
export interface Instruction<T extends IStream, K extends InstrTypes> {
    readonly INSTRUCTION: K;
    readonly event: ProcessEvents;
    readonly channel: IChan<T>;
    readonly thread: Generator<undefined, void, undefined>;
};
export interface InstructionCallback<T extends IStream> extends Instruction<T, InstrTypes.CALLBACK> {
    (val?: IChanValue<T>): IChanValue<T> | void;
    readonly INSTRUCTION: InstrTypes.CALLBACK;
    readonly close?: boolean;
};
export interface InstructionGeneral<T extends IStream> extends Instruction<T, InstrTypes.GENERAL>, Generator<IChanValue<T> | undefined, void, IChanValue<T> | undefined> {
    readonly INSTRUCTION: InstrTypes.GENERAL;
};
// Coordination of processes (IPC) via channels
export interface IProc<T extends IStream> {
    readonly events: IProcE<ProcessEvents, T>[];
    readonly coordinator: Array<typeof KILL>;
    // run(): Generator<Instruction<T>, void, IChanValue<T> | undefined>;
    run(): void;
    kill(): void;
    // [Symbol.asyncIterator](): AsyncGenerator<IProc<ProcessEvents, T>, undefined, IChanValue<T> | undefined>;
};

const KILL = function (this: IProc<IStream>) { this.kill(); }

export interface ProcessEventQ<T extends IStream> extends Iterable<Instruction<T, InstrTypes>> {
    instructionType: ProcessEvents | undefined;
    // run(): void;
    // add<T extends IStream>(instr: () => InstructionGeneral<T>): void;
    add<T extends IStream>(instr: InstructionCallback<T> | (() => InstructionGeneral<T>) & {
        readonly INSTRUCTION: InstrTypes.GENERAL;
        readonly event: ProcessEvents;
        readonly channel: IChan<T>;
    }): void;
    remove<T extends IStream>(): Instruction<T, InstrTypes> | undefined;
    // addCallback<T extends IStream>(instr: InstructionCallback<T>): void;
    flush(): void;
    readonly length: number;
    readonly channel: IChan<T>;
};

function drainToChan<T extends IStream>(chan: IChan<T>, source: Instruction<T, InstrTypes>): InstructionPutStates {
    if (source.event !== ProcessEvents.PUT) { return InstructionPutStates.NO_PUT_DEFAULT; }
    if (chan.isFull()) { return InstructionPutStates.NO_PUT_CHAN_FULL; }
    let value: IChanValue<T> | undefined | void, done: boolean | undefined;
    switch (source.INSTRUCTION) {
        case InstrTypes.CALLBACK:
            value = (source as InstructionCallback<T>)();
            if (value === undefined) { return InstructionPutStates.DONE; }
            else {
                chan.add(value);
                return InstructionPutStates.DONE;
            }
        case InstrTypes.GENERAL:
            if (!chan.isFull()) {
                ({ value, done } = (source as InstructionGeneral<T>).next());
                if (done || value === undefined) { return InstructionPutStates.DONE; }
                chan.add(value);
                return !!done ? InstructionPutStates.DONE : InstructionPutStates.NOT_DONE;
            }
            else { return InstructionPutStates.NO_PUT_CHAN_FULL; }
        default: return InstructionPutStates.NO_PUT_DEFAULT;
    }
}

function takeFromChan<T extends IStream>(chan: IChan<T>, sink: Instruction<T, InstrTypes>): InstructionTakeStates {
    if (chan.count() === 0 && chan.last() === CLOSED && !chan.closed) { return InstructionTakeStates.NO_TAKE_CHAN_EMPTY; }
    let value: IChanValue<T> = chan.last(), done: boolean;
    if (isChan(value)) {
        if (value.closed && !value.altFlag) {
            if (value.count() === 0) {
                chan.remove();
            }
            else {
                let tempCBVal: IChanValue<T>;
                chan.remove();
                do {
                    tempCBVal = value.remove() as IChanValue<T>;
                    if (tempCBVal !== CLOSED) {
                        setImmediate(queueRecursiveAdd, CSP().get(chan), CSP().get(chan), instructionCallback(ProcessEvents.PUT, chan, () => tempCBVal, makeFakeThread()));
                    }
                } while (value.count() > 0);
            }
            if (chan.count() === 0 && chan.last() === CLOSED && !chan.closed) { return InstructionTakeStates.NO_TAKE_CHAN_EMPTY; }
            // setImmediate(queueRecursiveAdd, this, this, instr, 'addCallback');
            return InstructionTakeStates.CHAN_VALUE_CLOSED;
        }
        else {
            return InstructionTakeStates.CHAN_VALUE_OPEN;
        }
    }
    switch (sink.INSTRUCTION) {
        case InstrTypes.CALLBACK:
            (sink as InstructionCallback<T>)(value);
            return InstructionTakeStates.DONE;
        case InstrTypes.GENERAL:
            done = !!(sink as InstructionGeneral<T>).next(value).done;
            return done ? InstructionTakeStates.DONE : InstructionTakeStates.NOT_DONE;
    }
}

function createQ<T extends IStream>(chan: IChan<T>): ProcessEventQ<T> {
    let buffer: RingBuffer<T, Instruction<T, InstrTypes>> = ring<T, Instruction<T, InstrTypes>>(32);
    let instructionType: ProcessEvents | undefined = undefined;
    const ret: ProcessEventQ<T> = Object.create(buffer, {
        channel: { get() { return chan; } },
        length: { get() { return buffer.length; } },
        instructionType: { get() { return instructionType; }, set(instrType: ProcessEvents | undefined) { instructionType = instrType; } },
        remove: { value() { return buffer.pop(); } },
        add: {
            value(instru: InstructionCallback<T> | (() => InstructionGeneral<T>) &
            {
                readonly INSTRUCTION: InstrTypes.GENERAL;
                readonly event: ProcessEvents;
                readonly channel: IChan<T>;
            }
            ): void {
                const instr: Instruction<T, InstrTypes> = instru.INSTRUCTION === InstrTypes.GENERAL ? instru() : instru;
                if (chan.closed && !chan.altFlag) {
                    if (instr.event === ProcessEvents.TAKE) {
                        if (chan.count() === 0) {
                            if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                            else { (instr as InstructionCallback<T>)(CLOSED); }
                            return;
                        }
                    }
                    else {
                        if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                        else { (instr as InstructionCallback<T>)(); }
                        return;
                    }
                }
                if (instru.channel === chan && instru.event === ProcessEvents.TAKE && instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).next(); }
                switch (instructionType) {
                    case instr.event: if (buffer.length >= MAX_DIRTY) {
                        if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                        else { (instr as InstructionCallback<T>)(); }
                        return;
                    }
                    else if (instr.event !== ProcessEvents.PUT) {
                        buffer.unboundedUnshift(instr);
                    }
                    else {
                        let temp: InstructionPutStates;
                        do {
                            temp = drainToChan(chan, instr);
                            if (temp !== InstructionPutStates.NOT_DONE) {
                                if (temp === InstructionPutStates.NO_PUT_CHAN_FULL) {
                                    buffer.unboundedUnshift(instr);
                                }
                                break;
                            }
                        } while (true);
                    }
                        break;
                    case undefined:
                        if (instr.event === ProcessEvents.PUT) {
                            while (buffer.length) {
                                (buffer.pop() as InstructionCallback<T>)();
                            }
                            let temp: InstructionPutStates;
                            do {
                                temp = drainToChan(chan, instr);
                                if (temp !== InstructionPutStates.NOT_DONE) {
                                    if (temp === InstructionPutStates.NO_PUT_CHAN_FULL) {
                                        instructionType = ProcessEvents.PUT;
                                        buffer.unboundedUnshift(instr);
                                    }
                                    break;
                                }
                            } while (true);
                        }
                        else if (instr.event === ProcessEvents.TAKE) {
                            // if (instr.INSTRUCTION === InstrTypes.GENERAL && instr.channel === chan) { (instr as InstructionGeneral<T>).next(); }
                            let eventState: InstructionTakeStates;
                            while (buffer.length) {
                                (buffer.pop() as InstructionCallback<T>)();
                            }
                            do {
                                eventState = takeFromChan(chan, instr);
                                switch (eventState) {
                                    case InstructionTakeStates.DONE: chan.remove(); break;
                                    case InstructionTakeStates.CHAN_VALUE_OPEN:
                                        setImmediate(queueRecursiveAdd, CSP().get(chan.last() as IChan<T>), this, instr /*, 'addCallback' */);
                                        break;
                                    case InstructionTakeStates.CHAN_VALUE_CLOSED:
                                        break;
                                    case InstructionTakeStates.NOT_DONE: chan.remove(); break;
                                    default:
                                        break;
                                }
                            } while ([InstructionTakeStates.CHAN_VALUE_CLOSED, InstructionTakeStates.NOT_DONE].includes(eventState));
                            if (![InstructionTakeStates.DONE, InstructionTakeStates.CHAN_VALUE_OPEN].includes(eventState)) {
                                instructionType = instr.event;
                                buffer.unboundedUnshift(instr);
                            }
                        }
                        else { buffer.unboundedUnshift(instr); }
                        break;
                    default: if (buffer.length === 0) { instructionType = instr.event === ProcessEvents.SLEEP ? undefined : instr.event; }
                        if (instr.event === ProcessEvents.SLEEP) { (instr as InstructionCallback<T>)(); }
                        else if (instr.event === ProcessEvents.PUT) {
                            let i: number = 0, othersDone: number[] = [], instrDone: boolean = false, removeChanVal: boolean = false;
                            do {
                                if (![InstructionPutStates.NO_PUT_CHAN_FULL, InstructionPutStates.NOT_DONE].includes(drainToChan(chan, instr))) { instrDone = true; }
                                i = 0;
                                for (const other of buffer) {
                                    if (othersDone.includes(i)) { i += 1; continue; }
                                    else {
                                        switch (takeFromChan(chan, other)) {
                                            case InstructionTakeStates.CHAN_VALUE_OPEN:
                                                setImmediate(queueRecursiveAdd, CSP().get(chan.last() as IChan<T>), this, other /*, other.INSTRUCTION === InstrTypes.GENERAL ? 'add' : 'addCallback' */);
                                                othersDone.push(i);
                                                break;
                                            case InstructionTakeStates.CHAN_VALUE_CLOSED: break;
                                            case InstructionTakeStates.DONE: othersDone.push(i);
                                            default:
                                                removeChanVal = true;
                                                break;
                                        }
                                    }
                                    i += 1;
                                }
                                if (removeChanVal) { chan.remove(); removeChanVal = false; }
                                if (instrDone) { break; }
                                if (othersDone.length === buffer.length) { break; }
                            } while (chan.count() > 0 || !instrDone);
                            if (buffer.length === othersDone.length) { buffer.cleanup(() => false); }
                            else { buffer.cleanup((_, ind: number) => !othersDone.includes(ind)); }
                            if (buffer.length === 0) {
                                if (instrDone) { instructionType = undefined; }
                                else {
                                    instructionType = instr.event;
                                    buffer.unboundedUnshift(instr);
                                }
                            }
                            else if (!instrDone) { throw new Error('wtf?'); }
                        }
                        else {
                            // if (instr.INSTRUCTION === InstrTypes.GENERAL && instr.event === ProcessEvents.TAKE && instr.channel === chan) { (instr as InstructionGeneral<T>).next(); }
                            let i: number = 0, other: Instruction<T, InstrTypes>, othersDone: number[] = [], instrDone: boolean = false;
                            do {
                                switch (takeFromChan(chan, instr)) {
                                    case InstructionTakeStates.CHAN_VALUE_OPEN:
                                        setImmediate(queueRecursiveAdd,
                                            CSP().get(chan.last() as IChan<T>),
                                            this, instr);
                                        //, instr.INSTRUCTION === InstrTypes.GENERAL ? 'add' : 'addCallback');
                                        instrDone = true;
                                        break;
                                    case InstructionTakeStates.DONE: instrDone = true;
                                        chan.remove();
                                        break;
                                    case InstructionTakeStates.CHAN_VALUE_CLOSED:
                                        for (i; i < buffer.length; i += 1) { othersDone.push(i); }
                                        setImmediate(queueFlushChannel, chan);
                                        break;
                                    case InstructionTakeStates.NO_TAKE_CHAN_EMPTY:
                                        i = 0;
                                        for (other of buffer) {
                                            if (othersDone.includes(i)) { i += 1; continue; }
                                            if ([InstructionPutStates.DONE, InstructionPutStates.NO_PUT_DEFAULT].includes(drainToChan(chan, other))) { othersDone.push(i); }
                                            else if (chan.isFull()) { break; }
                                            i += 1;
                                        }
                                        break;
                                    default: chan.remove(); break;
                                }
                                if (othersDone.length === buffer.length) { break; }
                            } while (!instrDone);
                            buffer.cleanup((_, index: number) => !othersDone.includes(index));
                            if (instrDone) {
                                if (buffer.length === 0) { instructionType = undefined; }
                            }
                            else if (buffer.length === 0) {
                                instructionType = instr.event;
                                buffer.unboundedUnshift(instr);
                            }
                            else { throw new Error('why this is?'); }
                        }
                        break;
                }
            }
        },
        //     add: {
        //     value(instr: (() => InstructionGeneral<T>) & {
        //         readonly INSTRUCTION: InstrTypes.GENERAL;
        //         readonly event: ProcessEvents;
        //         readonly channel: IChan<T>;
        //     }): void {
        //         if (chan.closed) {
        //             switch (instr.event) {
        //                 case ProcessEvents.TAKE: if (chan.count() === 0) {
        //                     if (instr.channel === chan) { instr().return(); }
        //                     else { setImmediate(queueRecursiveAdd, CSP().get(instr.channel), this, instr(), 'add'); }
        //                 } else {
        //                     const instruction: InstructionGeneral<T> = instr();
        //                     let value: IChanValue<T>, done: boolean | undefined;
        //                     while (chan.count() > 0) {
        //                         let value = chan.last();
        //                         if (isChan(value)) {
        //                             setImmediate(queueRecursiveAdd, CSP().get(value), this, instruction, 'add');
        //                             break;
        //                         }
        //                         else {
        //                             chan.remove();
        //                             done = instruction.next(value).done;
        //                             if (done) { break; }
        //                         }
        //                     }
        //                 }
        //                     break;
        //                 default: if (instr.channel === chan) { instr().return(); }
        //                 else { setImmediate(queueRecursiveAdd, CSP().get(instr.channel), this, instr(), 'add'); }
        //                     break;
        //             }
        //             return;
        //         }
        //         switch (instructionType) {
        //             case instr.event: if (buffer.length >= MAX_DIRTY || chan.closed) {
        //                 instr().return();
        //                 break;
        //             }
        //                 let temp: InstructionGeneral<T> = instr();
        //                 if (instr.event === ProcessEvents.PUT) {
        //                     let state: undefined | { value: IChanValue<T> | undefined | void; done?: boolean } = undefined;
        //                     while (!chan.isFull()) {
        //                         state = temp.next();
        //                         if (state.value === undefined || state.done) { temp.return(); break; }
        //                         chan.add(state.value!);
        //                     }
        //                     if (!state || (chan.isFull() && !state.done)) { buffer.unboundedUnshift(temp); }
        //                     else { temp.return(); }
        //                 }
        //                 else if (instr.event === ProcessEvents.TAKE) {
        //                     if (instr.channel === chan) { temp.next(); }
        //                     buffer.unboundedUnshift(temp);
        //                     break;
        //                 }
        //                 break;
        //             case undefined: if (instr.event === ProcessEvents.PUT) {
        //                 instructionType = ProcessEvents.PUT;
        //                 let temp: InstructionGeneral<T> = instr(), state: undefined | { value: IChanValue<T> | undefined | void; done?: boolean } = undefined;
        //                 while (!chan.isFull()) {
        //                     state = temp.next();
        //                     if (state.value === undefined || state.done) { temp.return(); break; }
        //                     chan.add(state.value);
        //                 }
        //                 if (!state || (chan.isFull() && !state.done)) { buffer.unboundedUnshift(temp); }
        //                 else { instructionType = undefined; temp.return(); }
        //                 break;
        //             }
        //             else if (instr.event === ProcessEvents.TAKE) {
        //                 let temp: InstructionGeneral<T> = instr();
        //                 let done: boolean | undefined = false;
        //                 if (instr.channel === chan) { temp.next(); }
        //                 instructionType = ProcessEvents.TAKE;
        //                 while (buffer.length) { let sleeper = buffer.pop(); if (sleeper && sleeper.event === ProcessEvents.SLEEP) { (sleeper as unknown as InstructionCallback<boolean>)(); } }
        //                 if (chan.count() === 0) { buffer.unboundedUnshift(temp); }
        //                 else {
        //                     let val: IChanValue<T> | undefined, i: number = 0;
        //                     while (chan.count()) {
        //                         if (done) { break; }
        //                         val = chan.last();
        //                         if (isChan(val)) {
        //                             if (val.closed && val.count() === 0) { chan.remove(); }
        //                             else { setImmediate(queueRecursiveAdd, CSP().get(val), this, temp, 'add'); instructionType = undefined; break; }
        //                         }
        //                         else { done = temp.next(val).done; chan.remove(); }
        //                     }
        //                     if (!done) { if (!val || !isChan(val)) { buffer.unboundedUnshift(temp); } } else { instructionType = undefined; return; }
        //                 }
        //             }
        //                 break;
        //             default: if (buffer.length) {
        //                 let instruction: InstructionGeneral<T> = instr(), state: IChanValue<T> | void | undefined, instrDone: boolean = false;
        //                 if (instruction.event === ProcessEvents.TAKE && instruction.channel === chan) { instruction.next(); }
        //                 switch (instructionType) {
        //                     case ProcessEvents.TAKE:
        //                         let othersDone: number[] = [], siOrSo: Instruction<T, InstrTypes>, i: number = 0;
        //                         const filterFn: (instr: Instruction<T, InstrTypes>, index: number) => boolean = (_, ind) => !othersDone.includes(ind);
        //                         while (!instrDone) {
        //                             i = 0;
        //                             state = instruction.next().value;
        //                             if (state === undefined) {
        //                                 instrDone = true;
        //                                 if (!buffer.length) {
        //                                     instructionType = undefined;
        //                                 }
        //                                 break;
        //                             }
        //                             if (!buffer.length && !instrDone) { buffer.unboundedUnshift(instruction); instructionType = instr.event; break; }
        //                             if (isChan(state)) {
        //                                 if (!state.closed) {
        //                                     for (siOrSo of buffer) {
        //                                         if (othersDone.includes(i)) { continue; }
        //                                         if (siOrSo!.INSTRUCTION === InstrTypes.CALLBACK) {
        //                                             setImmediate(queueRecursiveAdd, CSP().get(state), this, siOrSo, 'addCallback');
        //                                             othersDone.push(i);
        //                                         }
        //                                         else if (siOrSo!.INSTRUCTION === InstrTypes.GENERAL) {
        //                                             setImmediate(queueRecursiveAdd, CSP().get(state), this, siOrSo, 'add');
        //                                             othersDone.push(i);
        //                                         }
        //                                         i++;
        //                                     }
        //                                 }
        //                             }
        //                             else {
        //                                 for (siOrSo of buffer) {
        //                                     if (othersDone.includes(i)) { continue; }
        //                                     else if (siOrSo!.INSTRUCTION === InstrTypes.CALLBACK) {
        //                                         (siOrSo as InstructionCallback<T>)(state);
        //                                         othersDone.push(i);
        //                                     }
        //                                     else if (siOrSo!.INSTRUCTION === InstrTypes.GENERAL) {
        //                                         if (!!(siOrSo as InstructionGeneral<T>)!.next(state).done) { othersDone.push(i); };
        //                                     }
        //                                     i++;
        //                                 }
        //                             }
        //                             if (othersDone.length) { buffer.cleanup(filterFn); }
        //                         }
        //                         if (instrDone && !buffer.length) { instructionType = undefined; }
        //                         break;
        //                     default:
        //                         let otherDone = false;
        //                         instrDone = false;
        //                         if (chan.count() && instr.event === ProcessEvents.TAKE) {
        //                             let state: IChanValue<T> | undefined;
        //                             while (!instrDone) {
        //                                 if (!chan.count()) { break; }
        //                                 state = chan.last();
        //                                 if (isChan(state)) {
        //                                     instrDone = true;
        //                                     setImmediate(queueRecursiveAdd, CSP().get(state), this, instruction, 'add');
        //                                     break;
        //                                 }
        //                                 else {
        //                                     instrDone = !!instruction.next(state).done;
        //                                     chan.remove();
        //                                 }
        //                             }
        //                         }
        //                         while (!instrDone) {
        //                             let siOrSo: Instruction<T, InstrTypes> | undefined = buffer.last();
        //                             if (!instrDone && otherDone && !buffer.length) { buffer.cleanup(() => false); buffer.unboundedUnshift(instruction); instructionType = instr.event; return; }
        //                             else if (otherDone && !instrDone) { buffer.pop(); siOrSo = buffer.last(); otherDone = false; }
        //                             // siOrSo!.next();
        //                             if (siOrSo!.INSTRUCTION === InstrTypes.CALLBACK) {
        //                                 if (siOrSo!.event === ProcessEvents.SLEEP) { (siOrSo as InstructionCallback<T>)!(); }
        //                                 else if (siOrSo!.event === ProcessEvents.PUT) {
        //                                     const state = (siOrSo as InstructionCallback<T>)();
        //                                     if (state !== undefined) {
        //                                         if (isChan(state)) {
        //                                             setImmediate(queueRecursiveAdd, CSP().get(state), this, instruction, 'add');
        //                                         }
        //                                         else {
        //                                             instrDone = !!instruction.next(state).done;
        //                                         }
        //                                     }
        //                                     if ((siOrSo as InstructionCallback<T>).close) { chan.close(); }
        //                                 }
        //                                 otherDone = true;
        //                             }
        //                             else {
        //                                 while (!instrDone && !otherDone) {
        //                                     if (instr.event === ProcessEvents.TAKE) {
        //                                         state = (siOrSo as InstructionGeneral<T>)!.next().value;
        //                                         if (state === undefined) { otherDone = true; buffer.pop(); break; }
        //                                         if (isChan(state)) {
        //                                             setImmediate(queueRecursiveAdd, CSP().get(state), this, instruction, 'add');
        //                                             break;
        //                                         }
        //                                     }
        //                                 }
        //                             }
        //                             // if (!buffer.length && !otherDone) { buffer.push(siOrSo!); }
        //                         }
        //                 }
        //             }
        //         }
        //     }
        // },
        flush: {
            value() {
                let instr: Instruction<T, InstrTypes>;
                if (!chan.closed) { chan.close(); }
                // if (!buffer.length && !chan.altFlag) { CSP().delete(chan); return; }
                switch (instructionType) {
                    case ProcessEvents.PUT: while (buffer.length) {
                        instr = buffer.pop()!;
                        if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                        else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T>)(); }
                    }
                        break;
                    case ProcessEvents.TAKE:
                        if (!chan.count()) {
                            for (instr of buffer) {
                                if (instr.channel === chan) {
                                    if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                                    else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T>)(); }
                                }
                                else {
                                    if (instr.channel.closed && instr.channel.count() === 0) {
                                        if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                                        else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T>)(); }
                                    }
                                    else {
                                        setImmediate(queueRecursiveAdd, CSP().get(instr.channel), this, instr /*, instr.INSTRUCTION === InstrTypes.GENERAL ? 'add' : 'addCallback' */);
                                    }
                                }
                            }
                        } else {
                            let val: IChanValue<T> | undefined, doneIndices: number[] = [], i: number = 0;
                            while (chan.count()) {
                                if (doneIndices.length === buffer.length) { break; }
                                val = chan.remove();
                                if (val === undefined) { break; }
                                i = 0;
                                if (isChan(val)) {
                                    for (instr of buffer) {
                                        if (doneIndices.includes(i)) { continue; }
                                        setImmediate(queueRecursiveAdd, CSP().get(val), this, instr /*, instr.INSTRUCTION === InstrTypes.GENERAL ? 'add' : 'addCallback'*/);
                                        doneIndices.push(i);
                                        i++;
                                    }
                                }
                                else {
                                    for (instr of buffer) {
                                        if (doneIndices.includes(i)) { continue; }
                                        else if (instr.channel === chan) {
                                            if (instr.INSTRUCTION === InstrTypes.GENERAL) { let done = (instr as InstructionGeneral<T>).next(val).done; if (done) { doneIndices.push(i); } }
                                            else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T>)(val); doneIndices.push(i); }
                                        }
                                        else {
                                            if (instr.channel.closed && instr.channel.count() === 0) {
                                                if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                                                else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T>)(); }
                                            }
                                            else {
                                                setImmediate(queueRecursiveAdd, CSP().get(instr.channel), this, instr /*, instr.INSTRUCTION === InstrTypes.GENERAL ? 'add' : 'addCallback'*/);
                                            }
                                        }
                                        i++;
                                    }
                                }
                            }
                            // if (chan.count()) { do { chan.remove(); } while (chan.count()) }
                            if (buffer.length !== doneIndices.length) {
                                i = 0;
                                for (instr of buffer) {
                                    if (!doneIndices.includes(i)) {
                                        if (instr !== undefined) {
                                            if (instr.channel === chan) {
                                                if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                                                else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T>)(); }
                                            }
                                            else {
                                                if (instr.channel.closed && instr.channel.count() === 0) {
                                                    if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T>).return(); }
                                                    else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T>)(); }
                                                }
                                                else {
                                                    setImmediate(queueRecursiveAdd, CSP().get(instr.channel), this, instr /*, instr.INSTRUCTION === InstrTypes.GENERAL ? 'add' : 'addCallback' */);
                                                }
                                            }
                                        }
                                    }
                                    i += 1;
                                }
                            }
                        }
                        buffer.cleanup(() => false);
                        break;
                    default: if (buffer.length) {
                        for (instr of buffer) {
                            if (instr !== undefined) { (instr as InstructionCallback<T>)(); }
                        }
                        buffer.cleanup(() => false);
                        break;
                    }
                }
                if (!chan.count() && !!!chan.altFlag) { CSP().delete(chan); }
            },
        }
    });
    return ret;
}

// Global registry of processes
export interface IGoordinator extends WeakMap<IChan<IStream>, ProcessEventQ<IStream>> {
    register<T extends IStream>(this: IGoordinator, process: IProc<T>): ProcessEventQ<T>;
    terminate(this: IGoordinator, proc: IProc<IStream>): void;
};
// registry functions
function register<T extends IStream>(this: IGoordinator, process: IProc<T>): void {
    let event: IProcE<ProcessEvents, T>;
    for (event of process.events)
        if (!this.has(event.channel)) {
            this.set(event.channel, createQ<T>(event.channel as IChan<T>));
        }
}

// close function
function terminate(this: IGoordinator, process: IProc<IStream>): void {
    // process.coordinator.push(KILL);
    setImmediate(() => KILL.call(process));
}

function instruction<T extends IStream>(event: IProcE<ProcessEvents.PUT | ProcessEvents.TAKE, T>, ch: IChan<T>, thread: Generator<undefined, void, undefined>): (() => InstructionGeneral<T>) & {
    readonly INSTRUCTION: InstrTypes.GENERAL;
    readonly event: ProcessEvents;
    readonly channel: IChan<T>;
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
                    if (value === undefined || done) { event.return(); break; }
                    yield value;
                }
            }
            else if (event.event === ProcessEvents.TAKE) {
                if (ch === event.channel) { event.next(); }
                let state: IChanValue<T> | undefined;
                while (true) {
                    state = yield;
                    // if (event.altFlag) { ch.altFlag = false; }
                    if (state === undefined || state === CLOSED) { event.return(); break; }
                    event.next(state as IChanValue<T>);
                    if (event.altFlag) { setImmediate(queueNextOnThread, thread); event.return(); break; }
                }
            }
        }
        finally {
            setImmediate(queueNextOnThread, thread);
            event.return();
        }
    }
    Object.defineProperties(instr, { INSTRUCTION: { get() { return InstrTypes.GENERAL; } }, channel: { get() { return ch; } }, event: { get() { return event.event; } }, thread: { get() { return thread; } } });
    Object.defineProperties(instr.prototype, { INSTRUCTION: { get() { return InstrTypes.GENERAL; } }, channel: { get() { return ch; } }, event: { get() { return event.event; } }, thread: { get() { return thread; } } });
    return instr as (() => InstructionGeneral<T>) & {
        readonly INSTRUCTION: InstrTypes.GENERAL;
        readonly event: ProcessEvents;
        readonly channel: IChan<T>;
    };
}

function instructionCallback<T extends IStream>(event: ProcessEvents, ch: IChan<T>, cb: IProcSleepE | ((val?: IChanValue<T>) => IChanValue<T> | void), thread: Generator<undefined, void, undefined>, altFlag?: boolean): InstructionCallback<T> {
    let ret: ((val?: T) => T | void);
    ch.altFlag = !!altFlag;
    switch (event) {
        case ProcessEvents.SLEEP:
            let ceeBee: Exclude<typeof ret, IProcSleepE> = () => { return true as T; }
            ceeBee['close'] = true;
            ret = () => {
                const a: (() => void) = () => {
                    // CSP().get(ch)!.addCallback(
                    //     instructionCallback(
                    //         ProcessEvents.PUT,
                    //         ch,
                    //         ceeBee as ((val?: T) => T | void),
                    //         thread
                    //     ));
                    CSP().get(ch)!.add(
                        instructionCallback(
                            ProcessEvents.PUT,
                            ch,
                            ceeBee as ((val?: T) => T | void),
                            thread
                        ));
                    if (!ch.altFlag) { ch.close(); }
                };
                (cb as IProcSleepE)(a);
            };
            break;
        case ProcessEvents.TAKE: ret = (myVal: T) => { (cb as Exclude<typeof ret, IProcSleepE>)(myVal); setImmediate(queueNextOnThread, thread); };
            break;
        default: ret = (() => { setImmediate(queueNextOnThread, thread); const ret: T = (cb as () => T)() as T; return ret; }); Object.defineProperties(ret, { close: { get() { return cb['close'] ? cb['close'] : false; } } }); break;
    }
    Object.defineProperties(ret, {
        channel: { get() { return ch; } },
        event: { get() { return event; } },
        INSTRUCTION: { get() { return InstrTypes.CALLBACK; } },
        thread: { get() { return thread; } },
        altFlag: { get() { return !!altFlag; } }
    });
    return ret as InstructionCallback<T>;
}

// process creation function.
function createProcess<T extends IStream>(...procEventsArgs: IProcE<ProcessEvents, T>[]): IProc<T> {
    //TODO: Add backPressure queue
    // const coordinator: typeof KILL[] = new Array(1);
    let procEvents = procEventsArgs.reverse();
    function* makeThread(procInstance: IProc<T>): Generator<undefined, void, undefined | Generator<undefined, void, undefined>> {
        let proc: IProcE<ProcessEvents, T>;
        if (!procEvents.length || procEvents.every(proc => proc.isDone)) { // coordinator.push(KILL.bind(procInstance));
            KILL.call(procInstance);
        }
        const thread: undefined | Generator<undefined, void, undefined> = yield;
        if (!thread) { throw new Error("coroutine thread instance not provided"); }
        try {
            while (procEvents.length) {
                proc = procEvents[procEvents.length - 1];
                if (!CSP().has(proc.channel)) { break; }
                // if (proc.event === ProcessEvents.SLEEP) { CSP().get(proc.channel)!.addCallback(instructionCallback(ProcessEvents.SLEEP, proc.channel, proc, thread)); }
                if (proc.event === ProcessEvents.SLEEP) { CSP().get(proc.channel)!.add(instructionCallback(ProcessEvents.SLEEP, proc.channel, proc, thread)); }
                else {
                    CSP().get(proc.channel)!.add(instruction(proc, proc.channel, thread));
                }
                yield;
                procEvents.pop();
            }
        }
        finally {
            if (!procEvents.length || procEvents.every(proc => proc.isDone)) { KILL.call(procInstance); }
        }
    }
    let ret: IProc<T> = Object.create({}, {
        events: { get() { return procEvents; } },
        // coordinator: { get() { return coordinator; } },
        kill: {
            value() {
                let proc: IProcE<ProcessEvents, T>;
                for (proc of procEvents) {
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


let CSPInstance: IGoordinator;
export function CSP(): IGoordinator {
    if (!CSPInstance) {
        let ret = new WeakMap<IChan<IStream>, ProcessEventQ<IStream>>();
        Object.defineProperties(ret, {
            register: { value: register },
            terminate: { value: terminate }
        })
        CSPInstance = ret as IGoordinator;
    }
    return CSPInstance;
}




export function chan<T extends IStream>(buff?: number): IChan<T> {
    const buffer = buff || 1;
    let alt: boolean = false;
    let lastVal: IChanValue<T> | undefined;
    let queue: FixedBuffer<T> = fixed<T>(buffer);
    let isClosed = false;
    const ret: IChan<T> = Object.create(queue, {
        remove: { value() { const ret: IChanValue<T> | undefined = queue.remove(); if (!queue.count()) { lastVal = ret; }; if (isClosed && !queue.count() && !alt) { return CLOSED; } return ret === undefined ? CLOSED : ret; } },
        closed: { get() { return isClosed; } },
        close: {
            value() {
                if (!isClosed) {
                    isClosed = true;
                    if (CSP().has(this)) {
                        setImmediate(queueFlushChannel, this);
                    }
                }
            }
        },
        count: { value() { return queue.count(); } },
        last: {
            value() {
                if (queue.last() !== undefined) { return queue.last(); } else if (!queue.count() && lastVal && isClosed && alt) {
                    // if (alt && isClosed && isChan(lastVal)) { return lastVal.last(); }
                    return lastVal;
                }
                return CLOSED;
            }
        },
        altFlag: { get() { return alt; }, set(val: boolean) { alt = val; } },
        sneak: { get() { return lastVal; } }
    });
    return ret;
}

function isChan<T extends IStream>(obj: any): obj is IChan<T> {
    if (obj instanceof FixedBuffer) {
        if ("close" in obj && "count" in obj) { return true; }
    }
    return false;
}

function put<T extends IStream>(chan: IChan<T>, source: IChan<T> | (() => Generator<IChanValue<T>, any, any>), altFlag?: boolean): IProcPutE<T> {
    let isDone: boolean = false;
    let newSource = isChan(source) ? function* () { yield source as IChanValue<T>; } : source;
    function* proc() {
        const push: Generator<IChanValue<T>, IChanValue<T>, any> = newSource();
        let state: { value: IChanValue<T>; done?: boolean | undefined; } = push.next();
        if (isChan(source)) { yield state.value; push.return(state.value); isDone = true; return; }
        if (state.done) { push.return(state.value); isDone = true; return; }
        while (!state.done) {
            yield state.value;
            state = push.next();
            if (!!state.done) { break; }
        }
        isDone = true;
    }
    Object.defineProperties(proc.prototype, { isDone: { get() { return isDone; } }, channel: { get() { return chan; } }, event: { get() { return ProcessEvents.PUT; } }, altFlag: { get() { return !!altFlag; } } });
    return proc() as IProcPutE<T>;
}


function take<T extends IStream>(chan: IChan<T>, sink?: () => Generator<undefined, any, IChanValue<T>>, altFlag?: boolean, pred?: (arg?: IChanValue<T>) => boolean): IProcTakeE<T> {
    let isDone: boolean = false;
    function* proc() {
        const pull: Generator<undefined, void, IChanValue<T>> | undefined = sink ? sink() : undefined;
        let done = false;
        let state: IChanValue<T> | undefined;
        pull?.next();
        while (!done) {
            state = yield;
            if (state === undefined || state === CLOSED) { if (pull) { pull.return(); } isDone = true; break; }
            if (pred && !pred(state)) { if (pull) { pull.return(); } isDone = true; break; }
            if (pull) { done = !!pull.next(state).done; }
            // else { yield state; }
        }
        if (!done && pull) { pull.return(); }
        isDone = true;
    }
    Object.defineProperties(proc.prototype, { isDone: { get() { return isDone; } }, channel: { get() { return chan; } }, event: { get() { return ProcessEvents.TAKE; } }, altFlag: { get() { return !!altFlag; } } });
    return proc() as IProcTakeE<T>;
}


function sleep(chan: IChan<boolean>, msecs: number): IProcSleepE {
    let isDone: boolean = false;
    const cb = (someCb: (() => void)) => { isDone = true; someCb(); };
    const ret = (someCb: (() => void)) => { setTimeout(cb, msecs, someCb); }
    Object.defineProperties(ret, { isDone: { get() { return isDone; } }, channel: { get() { return chan; } }, event: { get() { return ProcessEvents.SLEEP; } } });
    return ret as IProcSleepE;
}

export const Ops: Map<Symbol, (this: IChan<IStream>, ...rest) => IProcE<ProcessEvents, IStream>> = new Map();
Ops.set(Symbol.for('>!'), function (this: IChan<IStream>, source: () => Generator<IChanValue<IStream>, IChanValue<IStream>, any>) { return put(this, source); });
Ops.set(Symbol.for('<!'), function (this: IChan<IStream>, sink?: () => Generator<undefined, void, IChanValue<IStream>>, pred?: () => boolean) { return take(this, sink, false, pred); });

export function go<T extends IStream = IStream>(strings: TemplateStringsArray, ...args): typeof KILL {
    let chan: IChan<T>, operand: () => Generator<any, any, any>;
    let pred: (() => boolean) | undefined = undefined;
    let argVals = [...args];
    const processEvs: IProcE<ProcessEvents, T>[] = [];
    const procLength = strings.join('').split(';').length;
    let check: number = 1, stringsArr: string[] = [];
    for (let i = 0; i < strings.length; i++) {
        if (strings[i].replace(/\s+/, '') === '') { continue; }
        if (strings[i].match(/;/)) {
            stringsArr.push(';'); stringsArr.push(...strings[i].split(';'));
            continue;
        }
        stringsArr.push(strings[i]);
    }
    for (let i = 0; i < stringsArr.length; i++) {
        let op = stringsArr[i].trim();
        if (op === '>!') {
            chan = argVals.shift();
            if (stringsArr[i + 1] !== undefined && stringsArr[i + 1].trim() === '?:') {
                operand = alts.apply(null, argVals.shift());
            } else {
                operand = argVals.shift();
            }
            if (operand === undefined || chan === undefined) { throw new Error("Something's wrong with the put syntax here"); }
            processEvs.push(Ops.get(Symbol.for('>!'))!.apply(chan, [operand]));
        }
        else if (op === '<!') {
            if (stringsArr[i - 1] && stringsArr[i - 1] === '>!') { continue; }
            chan = argVals.shift();
            if (i === stringsArr.length - 1) {
                if (argVals.length) { operand = argVals.shift(); }
                if (argVals.length) { pred = argVals.shift(); }
            }
            else if (stringsArr[i + 1] && stringsArr[i + 1].indexOf(';') === -1) {
                operand = argVals.shift();
            }
            else { operand = function* () { while (true) { yield; } }; }
            processEvs.push(Ops.get(Symbol.for('<!'))!.apply(chan, [operand!, pred]));
        }
        // else if (op === '?!') {
        //     alts.apply(null, argVals.shift());
        // }
        else if (stringsArr[i].indexOf(';') !== -1) { check++; }
        else { continue; }
    }
    if (check !== procLength) { throw new Error("number of processes mismatch with the syntax"); }
    const process: IProc<T> = createProcess<T>(...processEvs);
    process.run();
    return process.kill;
}

export function timeout(msec: number): IChan<boolean> {
    const ch = chan<boolean>();
    const proc = createProcess<boolean>(sleep(ch, msec));
    register.apply(CSP(), [proc]);
    proc.run();
    return ch;
}

function* pseudoSourceSink<T extends IStream>(ev: ProcessEvents.PUT | ProcessEvents.TAKE, winVal: { readonly val: IChanValue<T> | undefined; done?: boolean; setVal(val: IChanValue<T>): void }, val?: IChanValue<T>) {
    switch (ev) {
        case ProcessEvents.PUT: yield val!; if (!!!winVal.done) { winVal.done = true; winVal.setVal(val!); } break;
        case ProcessEvents.TAKE: const st = yield; if (!!!winVal.done) { winVal.done = true; winVal.setVal(st); } break;
        default: throw new Error("How did you end up here?");
    }
}

function alts(...args: (IChan<IStream> | [IChan<IStream>, IChanValue<IStream>])[]): IChan<IStream> {
    let processEvs: IProcE<ProcessEvents, IStream>[] = [];
    let winningVal: IChanValue<IStream> | undefined;
    let altFlag: boolean = true;
    const winVal: { readonly val: IChanValue<IStream> | undefined; done?: boolean; setVal(val: IChanValue<IStream>): void } = Object.create({ done: false }, {
        val: { get() { return winningVal; } },
        setVal: { value(val: IChanValue<IStream>) { winningVal = val; } }
    });
    const returnChan = chan();
    function* makeThread(procInst: IProc<IStream>): Generator<undefined, void, undefined | Generator<undefined, void, undefined>> {
        let proc: IProcE<ProcessEvents, IStream>;
        const thread: undefined | Generator<undefined, void, undefined> = yield;
        if (!thread) { throw new Error("coroutine thread instance not provided"); }
        try {
            for (proc of procInst.events) {
                if (!CSP().has(proc.channel)) { break; }
                if (proc.event === ProcessEvents.SLEEP) { continue; }
                CSP().get(proc.channel)!.add(instruction(proc, proc.channel, thread));
            }
            yield;
            const winner: IProcE<ProcessEvents, IStream> | undefined = procInst.events.filter(ev => ev.isDone).pop();
            if (winner === undefined) { throw new Error("Unable to make a selection"); }
            if (winner.event === ProcessEvents.SLEEP) { throw new Error("Sleep is not a valid event for select operation"); }
            // CSP().get(returnChan)!.addCallback(instructionCallback(ProcessEvents.PUT, returnChan, () => winner!.channel, thread));
            altFlag = false;
            if (winner.channel.closed && !winner.channel.altFlag) {
                CSP().get(returnChan)!.add(instructionCallback(ProcessEvents.PUT, returnChan, () => winVal.val, thread, false));
            }
            else {
                if (winner.event === ProcessEvents.TAKE) {
                    CSP().get(winner!.channel)!.add(instructionCallback(ProcessEvents.PUT, returnChan, () => winVal.val, makeFakeThread(), false));
                }
                CSP().get(returnChan)!.add(instructionCallback(ProcessEvents.PUT, returnChan, () => winner!.channel, thread, false));
            }
            yield;
        }
        finally {
            KILL.call(procInst);
        }
    }
    for (let arg of Array.from(args)) {
        if (Array.isArray(arg) && arg.length === 2) {
            const [chan, val] = arg;
            processEvs.push(put(chan, () => pseudoSourceSink(ProcessEvents.PUT, winVal, val) as Generator<IChanValue<IStream>, void, undefined>, altFlag));
        }
        else if (isChan(arg)) {
            const chan = arg;
            processEvs.push(take(chan, () => pseudoSourceSink(ProcessEvents.TAKE, winVal) as Generator<undefined, void, IChanValue<IStream>>, altFlag));
        }
        else {
            throw new Error("Invalid syntax");
        }
    }
    const proc: IProc<IStream> = Object.create({}, {
        events: {
            get() { return processEvs; }
        },
        kill: {
            value() {
                let proc: IProcE<ProcessEvents, IStream>;
                for (proc of processEvs) {
                    if (!proc.isDone) {
                        setImmediate(queueImmediately, proc);
                    }
                }
                processEvs = [];
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
    proc.run();
    return returnChan;
}

function* makeFakeThread() { yield; }

export function putAsync<T extends IStream>(ch: IChan<T>, val: T, close?: boolean, cb?: () => any | void): void {
    if (!CSP().has(ch)) { console.log('noo'); return; }
    else {
        // CSP().get(ch)!.addCallback(instructionCallback(ProcessEvents.PUT, ch, () => { cb && cb(); return val; }, makeFakeThread()));
        const mainCB = () => { cb && cb(); return val; };
        Object.defineProperty(mainCB, 'close', { get() { return !!close; } });
        CSP().get(ch)!.add(instructionCallback(ProcessEvents.PUT, ch, mainCB, makeFakeThread()));
    }
}

export function takeAsync<T extends IStream>(ch: IChan<T>): Promise<T> {
    if (!CSP().has(ch)) { console.log('oh noooo'); throw new Error("oh nooo"); }
    else {
        const ret: Promise<T> = new Promise<T>(resolve => {
            // CSP().get(ch)!.addCallback(instructionCallback(ProcessEvents.TAKE, ch, resolve as ((val: T) => T), makeFakeThread()));
            CSP().get(ch)!.add(instructionCallback(ProcessEvents.TAKE, ch, resolve as ((val: T) => T), makeFakeThread()));
        });
        return ret;
    }
}

// scheduling functions
function queueImmediately<T extends IStream>(proc: IProcE<ProcessEvents, T>) { (proc as IProcPutE<T> | IProcTakeE<T>).return(); }
function queueNextOnThread<T extends IStream>(thread: Generator<undefined, void, undefined>) {
    thread.next();
}
function queueRecursiveAdd<T extends IStream>(toPQ: ProcessEventQ<T | T & IStream>, fromPQ: ProcessEventQ<T>, instr: Instruction<T, InstrTypes>): void {
    toPQ.channel.altFlag = fromPQ.channel.altFlag;
    switch (instr.INSTRUCTION) {
        case InstrTypes.GENERAL: const instruction = () => (instr as InstructionGeneral<T>);
            Object.defineProperties(instruction, {
                INSTRUCTION: { get() { return instr.INSTRUCTION; } },
                event: { get() { return instr.event; } },
                channel: { get() { return fromPQ.channel; } },
            });
            toPQ.add(instruction as (() => InstructionGeneral<T>) & {
                readonly INSTRUCTION: InstrTypes.GENERAL;
                readonly event: ProcessEvents;
                readonly channel: IChan<T>;
            }); break;
        default:
            if (fromPQ.channel === instr.channel) {
                // toPQ.addCallback(instr as InstructionCallback<T>);
                toPQ.add(instr as InstructionCallback<T>);
            }
            else {
                const instrCallback = function () { return (instr as InstructionCallback<T>).apply(instr, ...Array.from(arguments)); }
                Object.defineProperties(instrCallback, {
                    INSTRUCTION: { get() { return instr.INSTRUCTION; } },
                    event: { get() { return instr.event; } },
                    // check here
                    channel: { get() { return fromPQ.channel; } }
                });
                // toPQ.addCallback(instrCallback as InstructionCallback<T>);
                toPQ.add(instrCallback as InstructionCallback<T>);
            }
            break;
    }
}
function queueFlushChannel<T extends IStream>(chan: IChan<T>) {
    if (CSP().has(chan)) {
        CSP().get(chan)!.flush();
    }
};
