// TYPE-ONLY: bare take overload, noop, ops usable as ports (alts result taken by another op), iterable sources, stop passed in
interface Chan<In, Out = In> { readonly __in?: (x: In) => void; readonly __out?: () => Out }
declare function chan<T>(): Chan<T>;
type Ctl = { stop(): void; readonly i: number };
interface Sink<T> { readonly __sink?: (v: T) => void }
interface Source<T> { readonly __src?: () => T }
declare function sink<T>(fn: (val: T, stop: () => void) => void): Sink<T>;
declare function source<T>(fn: (stop: () => void) => T | undefined): Source<T>;
declare function from<T>(it: Iterable<T> | (() => Iterator<T>)): Source<T>;     // explicit spread, backpressured
declare const noop: Sink<any>;

// an Op that produces values is a "port": anything that takes a channel can take it; go() wires a fresh channel per run
interface Port<T> { readonly __port?: () => T }
type In<T> = Chan<any, T> | Port<T>;
interface Op<R = void> extends Port<R> { readonly __op: true }
declare function take<T>(ch: In<T>): Op<T>;                       // bare: wait for one value (sequencing)
declare function take<T>(ch: In<T>, s: Sink<T>): Op<void>;
declare function put<T>(ch: Chan<T, any>, src: Source<T>): Op<boolean>;
declare function alts<A, B>(a: In<A>, b: In<B>): Op<{ value: A | B; from: In<A> | In<B> }>;
declare function sleep(ms: number): Op<void>;
declare function go(...ops: Op<any>[]): () => void;

const clicks = chan<MouseEvent>(), keys = chan<KeyboardEvent>(), nums = chan<number>(), ready = chan<true>();
go(take(ready), take(clicks, sink((e, stop) => { if (e.button === 2) stop(); })));       // bare take sequences
go(take(ready, noop));                                                                   // explicit no-op also fine
go(take(alts(clicks, keys), sink(({ value, from }) => { if (from === clicks) {} })));     // winner channel available
go(put(nums, from([1, 2, 3])), put(nums, from(function* () { let i = 0; for (;;) yield i++; })));  // finite + infinite
go(put(nums, source(stop => Math.random() > 0.9 ? (stop(), undefined) : 1)));

go(put(nums, from(['a', 'b'])));                                                         // ✗ strings into number chan
go(take(alts(clicks, keys), sink((v: { value: number }) => {})));                        // ✗ wrong winner shape
