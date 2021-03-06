import { IStream, ProcessEvents, InstrTypes, CLOSED } from './constants';
import { BufferType } from './buffers';
export type IChanValue<T extends IStream> = T | IChan<T> | IChan<T, any> | Promise<T> | typeof CLOSED;

// Channel (working around circular type definitions as a Channel can accept
// another Channel as a value)
// type IChanPrimitive<T extends IStream, Q extends IStream = T> = instaceof Channel<T, Q>;
export interface IChan<T extends IStream, Q extends IStream = T> {
    buffer: BufferType<Q>;
    readonly hasXForm: boolean;
    add(val: IChanValue<T>): void;
    remove(): IChanValue<Q>;
    count(): number;
    last(): IChanValue<Q>;
    close(): void;
    isFull(): boolean;
    readonly closed: boolean;
    altFlag: boolean;
};

// ProcessEvents type definition. Each ProcessEvent has one and only one channel
// associalted with it
export interface IProcPutE<T extends IStream, S extends IStream = T> extends Generator<IChanValue<T> | undefined, void, undefined> {
    readonly event: ProcessEvents.PUT;
    readonly channel: IChan<T, S>;
    readonly isDone: boolean;
    readonly altFlag: boolean;
};
export interface IProcTakeE<T extends IStream, S extends IStream = T> extends Generator<undefined, void, IChanValue<S>> {
    readonly event: ProcessEvents.TAKE;
    readonly channel: IChan<T, S>;
    readonly isDone: boolean;
    readonly altFlag: boolean;
};
export interface IProcSleepE {
    (cb: () => void): boolean;
    readonly event: ProcessEvents.SLEEP;
    readonly channel: IChan<boolean>;
    readonly isDone: boolean;
};
export type IProcE<P extends ProcessEvents, T extends IStream, S extends IStream = T> = P extends ProcessEvents.PUT ? IProcPutE<T, S> : P extends ProcessEvents.TAKE ? IProcTakeE<T, S> : P extends ProcessEvents.SLEEP ? IProcSleepE : never;

//Instructions
export interface Instruction<T extends IStream, K extends InstrTypes, S extends IStream = T> {
    readonly INSTRUCTION: K;
    readonly event: ProcessEvents;
    readonly channel: IChan<T, S>;
    readonly thread: Generator<undefined, void, undefined>;
};
export interface InstructionCallback<T extends IStream, S extends IStream = T> extends Instruction<T, InstrTypes.CALLBACK, S> {
    (val?: IChanValue<S>): IChanValue<T> | void;
    readonly INSTRUCTION: InstrTypes.CALLBACK;
    readonly close?: boolean;
};
export interface InstructionGeneral<T extends IStream, S extends IStream = T> extends Instruction<T, InstrTypes.GENERAL, S>, Generator<IChanValue<T> | undefined, void, IChanValue<S> | undefined> {
    readonly INSTRUCTION: InstrTypes.GENERAL;
    readonly stale: boolean;
};


//EventQueue

export interface ProcessEventQ<T extends IStream, S extends IStream = T> extends Iterable<Instruction<T, InstrTypes, S>> {
    currentEventType: ProcessEvents | undefined;
    // run(): void;
    // add<T extends IStream>(instr: () => InstructionGeneral<T>): void;
    add(instr: InstructionCallback<T, S> | (() => InstructionGeneral<T, S>) & {
        readonly INSTRUCTION: InstrTypes.GENERAL;
        readonly event: ProcessEvents;
        readonly channel: IChan<T, S>;
    }): void;
    remove(): Instruction<T, InstrTypes, S> | undefined;
    // addCallback<T extends IStream>(instr: InstructionCallback<T>): void;
    flush(): void;
    readonly length: number;
    readonly channel: IChan<T, S>;
};

// Process

export interface IProc {
    readonly events: IProcEventsProp[];
    // readonly coordinator: Array<(this: IProc) => void>;
    // run(): Generator<Instruction<T>, void, IChanValue<T> | undefined>;
    readonly channel: IChan<boolean>;
    readonly isLive: boolean;
    run(): void;
    kill(): void;
    clone(): IProc;
    // [Symbol.asyncIterator](): AsyncGenerator<IProc<ProcessEvents, T>, undefined, IChanValue<T> | undefined>;
};

export type IProcEventsProp = (IProcE<ProcessEvents, IStream> | IProc);

// go blocks
export interface IAltsArgsPut<T extends IStream = IStream, S extends IStream = T> extends Iterable<IChan<T, S> | IChanValue<T>> {
    readonly length: 2;
    [0]: IChan<T, S>;
    [1]: IChanValue<T>;
};

export type IAltsArgs<T extends IStream = IStream, S extends IStream = T> = (IAltsArgsPut | IChan<T, S>);

// Global registry of processes
export interface IGoordinator extends WeakMap<IChan<IStream>, ProcessEventQ<IStream>> {
    set<T extends IStream, S extends IStream = T>(chan: IChan<T, S>, q: ProcessEventQ<T, S>): this;
    get<T extends IStream, S extends IStream = T>(chan: IChan<T, S>): ProcessEventQ<T, S>;
    register(this: IGoordinator, process: IProc): void;
};
