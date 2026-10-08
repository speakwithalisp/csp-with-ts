// TYPE-ONLY: the owner's shape. take/put keep (channel, wrapped fn); sink/source encapsulate a repeating take/put.
interface Chan<In, Out = In> { readonly __in?: (x: In) => void; readonly __out?: () => Out }
declare function chan<T>(n?: number): Chan<T>;
interface Op { readonly __op: true }
interface Sink<T> { readonly __sink?: (v: T) => void }
interface Source<T> { readonly __src?: () => T }
type Kill = () => void;

/** Repeating consumer: called for every value until done() or the channel closes. Effects allowed. (≅ Go `for v := range ch`) */
declare function sink<T>(fn: (value: T, done: () => void) => void): Sink<T>;
/** Repeating producer: called whenever the channel can accept; returns the value to put (transduced by the channel). */
declare function source<T>(fn: (done: () => void) => T): Source<T>;
declare function take<T>(ch: Chan<any, T>): Op;                 // bare: wait for one value
declare function take<T>(ch: Chan<any, T>, s: Sink<T>): Op;
declare function put<T>(ch: Chan<T, any>, s: Source<T>): Op;
declare function go(...ops: Op[]): Kill;
declare function loop(...ops: Op[]): Kill;
declare function sleep(ms: number): Op;

// fake React
declare function useEffect(f: () => void | (() => void), deps: unknown[]): void;
declare function useState<S>(s: S): [S, (s: S) => void];

declare const ch: Chan<string>; declare const ready: Chan<true>; declare const out: Chan<number>;
const someCondition = (v: string) => v !== 'stop', transfx = (v: string) => v.length;
function Component() {
  const [n, setN] = useState(0);
  useEffect(() => go(take(ch, sink((v, done) => { if (someCondition(v)) setN(transfx(v)); else done(); }))), []);
  useEffect(() => go(take(ready), put(out, source(done => { if (n > 10) done(); return n; }))), [n]);
  useEffect(() => loop(sleep(16), take(ch, sink((v, done) => { setN(v.length); done(); }))), []);
  // ✗ mistakes
  useEffect(() => go(take(ch, sink((v: number) => setN(v)))), []);
  useEffect(() => go(put(out, source(() => 'x'))), []);
}
