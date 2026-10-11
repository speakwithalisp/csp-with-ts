// Type declarations for the operation DSL (types only, no runtime code yet).
// Decided shape (docs/plans/open-design-decisions.md, D1-D4): go/loop take a list of operations and return
// a kill function; take/put pair a channel with a wrapped user function (sink/source).
// Open items (dynamic alts arms, alts handler shape, put result) are deliberately not declared here.
import { IStream } from '../impl/constants';
import { IChan } from '../impl/interfaces';

/** Stops a running go/loop block. go/loop return it, so it can be a React `useEffect` cleanup. */
export type Kill = () => void;

/** Ends the repeating take or put it is passed to (like `break` in Go's `for v := range ch`). */
export type Done = () => void;

/** A repeating consumer: called once per taken value until `done()` is called or the channel closes. */
export interface Sink<T extends IStream> {
    readonly kind: 'sink';
    readonly fn: (value: T, done: Done) => void;
}

/** A repeating producer: called whenever the channel can accept a value; returns the value to put. */
export interface Source<T extends IStream> {
    readonly kind: 'source';
    readonly fn: (done: Done) => T;
}

/** A description of one step of a go/loop block. Created by take/put; run (instantiated) by go/loop. */
export interface Op {
    readonly kind: 'take' | 'put';
}

export type SinkFn = <T extends IStream>(fn: (value: T, done: Done) => void) => Sink<T>;
export type SourceFn = <T extends IStream>(fn: (done: Done) => T) => Source<T>;

export interface TakeFn {
    /** Wait for one value, then continue with the next operation (sequencing on an event). */
    <T extends IStream>(ch: IChan<any, T>): Op;
    /** Consume values with `sink` until it calls `done()` or the channel closes. */
    <T extends IStream>(ch: IChan<any, T>, sink: Sink<NoInfer<T>>): Op;
}

/**
 * Put values from `source` (transduced by the channel's transducer) until it calls `done()`.
 * `NoInfer` makes the value type come from the channel only. Without it, a wrong source type could still
 * compile, because `IChan.add` is declared with method syntax and TypeScript checks method parameters
 * bivariantly (needs TypeScript >= 5.4).
 */
export type PutFn = <T extends IStream>(ch: IChan<T, any>, source: Source<NoInfer<T>>) => Op;

/** Run the operations once, in order. */
export type GoFn = (...ops: Op[]) => Kill;

/** Repeat the operations until killed, or until a channel it takes from closes (D3). */
export type LoopFn = (...ops: Op[]) => Kill;
