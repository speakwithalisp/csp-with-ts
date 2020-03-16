import { CLOSED, MAX_DIRTY, InstrTypes, InstructionTakeStates, InstructionPutStates, IStream, ProcessEvents } from './constants';
import { Instruction, InstructionGeneral, InstructionCallback, IChan, IChanValue, ProcessEventQ } from './interfaces';
import { RingBuffer, ring } from './buffers';
import { isChan } from './channels';
import { instructionCallback } from './instructions';
import { queueRecursiveAdd, queueFlushChannel } from './scheduler';
import { makeFakeThread } from './utils';
import { CSP } from './service';

function drainToChan<T extends IStream>(chan: IChan<T, any>, source: Instruction<T, InstrTypes, any>): InstructionPutStates {
    if (source.event !== ProcessEvents.PUT) { return InstructionPutStates.NO_PUT_DEFAULT; }
    if (chan.isFull()) { return InstructionPutStates.NO_PUT_CHAN_FULL; }
    let value: IChanValue<T> | undefined | void, done: boolean | undefined;
    switch (source.INSTRUCTION) {
        case InstrTypes.CALLBACK:
            value = (source as InstructionCallback<T, any>)();
            if (value === undefined) { return InstructionPutStates.DONE; }
            else {
                chan.add(value);
                return InstructionPutStates.DONE;
            }
        case InstrTypes.GENERAL:
            if (!chan.isFull()) {
                ({ value, done } = (source as InstructionGeneral<T, any>).next());
                if (done || value === undefined) { return InstructionPutStates.DONE; }
                chan.add(value);
                return !!done ? InstructionPutStates.DONE : InstructionPutStates.NOT_DONE;
            }
            else { return InstructionPutStates.NO_PUT_CHAN_FULL; }
        default: return InstructionPutStates.NO_PUT_DEFAULT;
    }
}

function takeFromChan<T extends IStream>(chan: IChan<any, T>, sink: Instruction<any, InstrTypes, T>): InstructionTakeStates {
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
                        setImmediate(queueRecursiveAdd, CSP().get<typeof chan extends IChan<infer S, infer _> ? S : never, T>(chan), CSP().get(chan), instructionCallback(ProcessEvents.PUT, chan, () => tempCBVal, makeFakeThread()));
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
            (sink as InstructionCallback<any, T>)(value);
            return InstructionTakeStates.DONE;
        case InstrTypes.GENERAL:
            done = !!(sink as InstructionGeneral<any, T>).next(value).done;
            return done ? InstructionTakeStates.DONE : InstructionTakeStates.NOT_DONE;
    }
}

export function createQ<T extends IStream, S extends IStream = T>(chan: IChan<T, S>): ProcessEventQ<T, S> {
    let buffer: RingBuffer<T, S, Instruction<T, InstrTypes, S>> = ring<T, S, Instruction<T, InstrTypes, S>>(32);
    let currentEventType: ProcessEvents | undefined = undefined;
    const ret: ProcessEventQ<T, S> = Object.create(buffer, {
        channel: { get() { return chan; } },
        length: { get() { return buffer.length; } },
        currentEventType: { get() { return currentEventType; }, set(instrType: ProcessEvents | undefined) { currentEventType = instrType; } },
        remove: { value() { return buffer.pop(); } },
        add: {
            value(instru: InstructionCallback<T, S> | (() => InstructionGeneral<T, S>) &
            {
                readonly INSTRUCTION: InstrTypes.GENERAL;
                readonly event: ProcessEvents;
                readonly channel: IChan<T, S>;
            }
            ): void {
                const instr: Instruction<T, InstrTypes, S> = instru.INSTRUCTION === InstrTypes.GENERAL ? instru() : instru;
                if (chan.closed && !chan.altFlag) {
                    if (instr.event === ProcessEvents.TAKE) {
                        if (chan.count() === 0) {
                            if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                            else { (instr as InstructionCallback<T, S>)(CLOSED); }
                            return;
                        }
                    }
                    else {
                        if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                        else { (instr as InstructionCallback<T, S>)(); }
                        return;
                    }
                }
                if (instru.channel === chan && instru.event === ProcessEvents.TAKE && instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).next(); }
                switch (currentEventType) {
                    case instr.event: if (buffer.length >= MAX_DIRTY) {
                        if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                        else { (instr as InstructionCallback<T, S>)(); }
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
                                (buffer.pop() as InstructionCallback<T, S>)();
                            }
                            let temp: InstructionPutStates;
                            do {
                                temp = drainToChan(chan, instr);
                                if (temp !== InstructionPutStates.NOT_DONE) {
                                    if (temp === InstructionPutStates.NO_PUT_CHAN_FULL) {
                                        currentEventType = ProcessEvents.PUT;
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
                                (buffer.pop() as InstructionCallback<T, S>)();
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
                                currentEventType = instr.event;
                                buffer.unboundedUnshift(instr);
                            }
                        }
                        else { buffer.unboundedUnshift(instr); }
                        break;
                    default: if (buffer.length === 0) { currentEventType = instr.event === ProcessEvents.SLEEP ? undefined : instr.event; }
                        if (instr.event === ProcessEvents.SLEEP) { (instr as InstructionCallback<T, S>)(); }
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
                            else { buffer.cleanup((_: Instruction<T, InstrTypes, S>, ind: number) => !othersDone.includes(ind)); }
                            if (buffer.length === 0) {
                                if (instrDone) { currentEventType = undefined; }
                                else {
                                    currentEventType = instr.event;
                                    buffer.unboundedUnshift(instr);
                                }
                            }
                            else if (!instrDone) { throw new Error('wtf?'); }
                        }
                        else {
                            // if (instr.INSTRUCTION === InstrTypes.GENERAL && instr.event === ProcessEvents.TAKE && instr.channel === chan) { (instr as InstructionGeneral<T>).next(); }
                            let i: number = 0, other: Instruction<T, InstrTypes, S>, othersDone: number[] = [], instrDone: boolean = false;
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
                            buffer.cleanup((_: Instruction<T, InstrTypes, S>, index: number) => !othersDone.includes(index));
                            if (instrDone) {
                                if (buffer.length === 0) { currentEventType = undefined; }
                            }
                            else if (buffer.length === 0) {
                                currentEventType = instr.event;
                                buffer.unboundedUnshift(instr);
                            }
                            else { throw new Error('why this is?'); }
                        }
                        break;
                }
            }
        },
        flush: {
            value() {
                let instr: Instruction<T, InstrTypes, S>;
                if (!chan.closed) { chan.close(); }
                // if (!buffer.length && !chan.altFlag) { CSP().delete(chan); return; }
                switch (currentEventType) {
                    case ProcessEvents.PUT: while (buffer.length) {
                        instr = buffer.pop()!;
                        if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                        else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T, S>)(); }
                    }
                        break;
                    case ProcessEvents.TAKE:
                        if (!chan.count()) {
                            for (instr of buffer) {
                                if (instr.channel === chan) {
                                    if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                                    else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T, S>)(); }
                                }
                                else {
                                    if (instr.channel.closed && instr.channel.count() === 0) {
                                        if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                                        else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T, S>)(); }
                                    }
                                    else {
                                        setImmediate(queueRecursiveAdd, CSP().get(instr.channel), this, instr /*, instr.INSTRUCTION === InstrTypes.GENERAL ? 'add' : 'addCallback' */);
                                    }
                                }
                            }
                        } else {
                            let val: IChanValue<S> | undefined, doneIndices: number[] = [], i: number = 0;
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
                                            if (instr.INSTRUCTION === InstrTypes.GENERAL) { let done = (instr as InstructionGeneral<T, S>).next(val).done; if (done) { doneIndices.push(i); } }
                                            else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T, S>)(val); doneIndices.push(i); }
                                        }
                                        else {
                                            if (instr.channel.closed && instr.channel.count() === 0) {
                                                if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                                                else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T, S>)(); }
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
                                                if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                                                else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T, S>)(); }
                                            }
                                            else {
                                                if (instr.channel.closed && instr.channel.count() === 0) {
                                                    if (instr.INSTRUCTION === InstrTypes.GENERAL) { (instr as InstructionGeneral<T, S>).return(); }
                                                    else if (instr.INSTRUCTION === InstrTypes.CALLBACK) { (instr as InstructionCallback<T, S>)(); }
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
                            if (instr !== undefined) { (instr as InstructionCallback<T, S>)(); }
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
