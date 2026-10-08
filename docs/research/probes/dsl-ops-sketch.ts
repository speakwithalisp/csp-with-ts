// type-level sketch only (no runtime) — checks that a function DSL can catch mismatches
interface Chan<In, Out = In> { readonly __in?: (x: In) => void; readonly __out?: () => Out }
declare function chan<T>(): Chan<T>;
declare const STOP: unique symbol;
type Ctl = { stop(): void; readonly i: number };
interface Sink<T> { readonly __sink?: (v: T) => void }
declare function convert<T>(fn: (v: T, ctl: Ctl) => void | typeof STOP): Sink<T>;
interface Op { readonly __op: true }
declare function take<T>(ch: Chan<any, T>, sink?: Sink<T>): Op;
declare function put<T>(ch: Chan<T, any>, v: T): Op;
declare function sleep(ms: number): Op;
declare function alts<T>(arms: Chan<any, T>[], sink: Sink<{ value: T | null; ch: Chan<any, T> }>): Op;
declare function go(...ops: Op[]): () => void;
declare function loop(...ops: Op[]): () => void;

const clicks = chan<MouseEvent>(); const nums = chan<number>();
const onClick = (e: MouseEvent, ctl: Ctl) => { if (e.button === 2) ctl.stop(); };
const onNum = (n: number) => { n.toFixed(); };

loop(sleep(500), take(clicks, convert(onClick)));             // OK: timeout re-armed every iteration, no thunk
go(take(nums, convert(onNum)), put(nums, 3));                 // OK
go(take(clicks, convert(onNum)));                             // ERROR expected: number sink on MouseEvent chan
go(put(nums, 'x'));                                           // ERROR expected: string into number chan
loop(alts([clicks, nums] as Chan<any, MouseEvent | number>[], convert(({ value }) => {})));  // OK
