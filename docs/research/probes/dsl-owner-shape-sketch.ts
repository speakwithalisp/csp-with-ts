// TYPE-ONLY sketch of the owner's shape: go(...ops); ops = take/put/sleep/alts; handlers wrapped by convert; pipe threads plain functions
interface Chan<In, Out = In> { readonly __in?: (x: In) => void; readonly __out?: () => Out }
declare function chan<T>(): Chan<T>;
declare const STOP: unique symbol; type Stop = typeof STOP;           // a stage may return STOP to end the op
type Ctl = { stop(): void; readonly i: number };

// convert: plain function -> something go() can run (internally a generator *function*, so each run gets a fresh one)
interface Sink<T> { readonly __sink?: (v: T) => void }
interface Source<T> { readonly __src?: () => T }
declare function convert<T>(fn: (val: T, ctl: Ctl) => unknown): Sink<T>;          // consumer
declare function source<T>(fn: (ctl: Ctl) => T | Stop): Source<T>;               // producer (for put)

// ops are descriptions; go() instantiates them, so one op list can run in many go blocks
interface Op { readonly __op: true }
declare function take<T>(ch: Chan<any, T>, sink?: Sink<T>): Op;                  // no sink = wait for one value
declare function put<T>(ch: Chan<T, any>, v: T | Source<T>): Op;
declare function sleep(ms: number): Op;                                          // armed when reached
declare function alts<A, B>(chs: [Chan<any, A>, Chan<any, B>], sink: Sink<A | B>): Op;
declare function go(...ops: Op[]): () => void;                                   // = `op1; op2; …`
declare function loop(...ops: Op[]): () => void;

// pipe threads plain functions (ramda-style); STOP short-circuits
declare function pipe<A, B, C>(f: (a: A, c: Ctl) => B | Stop, g: (b: B, c: Ctl) => C | Stop): (a: A, c: Ctl) => C | Stop;
declare function pipe<A, B, C, D>(f: (a: A, c: Ctl) => B | Stop, g: (b: B, c: Ctl) => C | Stop, h: (c0: C, c: Ctl) => D | Stop): (a: A, c: Ctl) => D | Stop;

type Point = { x: number; y: number };
const untilUp = (e: MouseEvent) => (e.type === 'mouseup' ? STOP : e);
const toPoint = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });
const render = (p: Point) => { document.title = `${p.x},${p.y}`; };
const mouse = chan<MouseEvent>(), points = chan<Point>(), names = chan<string>();

go(take(mouse, convert(pipe(untilUp, toPoint, render))));                       // ✓ consume until mouseup
loop(sleep(16), take(mouse, convert(pipe(toPoint, render))));                   // ✓ timeout re-armed each iteration
go(put(points, { x: 1, y: 2 }), take(names, convert((s: string, ctl) => { if (s === 'q') ctl.stop(); })));
const dragOps = [take(mouse, convert(pipe(untilUp, toPoint, render)))] as const;
go(...dragOps); go(...dragOps);                                                  // ✓ same description, two go blocks

go(take(names, convert(pipe(untilUp, toPoint, render))));                       // ✗ string chan, MouseEvent pipeline
go(take(mouse, convert(pipe(toPoint, (s: string) => s.length))));                // ✗ Point → string stage mismatch
go(put(points, 'x'));                                                            // ✗ string into Point chan
