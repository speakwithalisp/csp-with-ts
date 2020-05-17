import { IStream, ProcessEvents } from './constants';
import { IChan, IChanValue, IProcE, IProcPutE, IProcTakeE, IProc, IAltsArgs, IAltsArgsPut } from './interfaces';
import { chan, isChan, } from './channels';
import { take, put, sleep, } from './processEvents';
import { CSP } from './service';
import { createAlts, createProcess, register, isProcess } from './process';


export const Ops: Map<Symbol, <T extends IStream = IStream, S extends IStream = T>(this: IChan<T, S>, ...rest: any[]) => IProcPutE<T, S> | IProcTakeE<T, S>> = (function () {
    const ret = new Map<Symbol, <T extends IStream = IStream, S extends IStream = T>(this: IChan<T, S>, ...rest: any[]) => IProcPutE<T, S> | IProcTakeE<T, S>>();
    ret.set(Symbol.for('>!'), function <T extends IStream = IStream, S extends IStream = T>(this: IChan<T, S>, source: (() => Generator<IChanValue<T>, IChanValue<T>, any>) | IChan<T, any>): IProcPutE<T, S> { return put<T, S>(this, source); });
    ret.set(Symbol.for('<!'), function <T extends IStream = IStream, S extends IStream = T>(this: IChan<T, S>, sink?: () => Generator<undefined, void, IChanValue<S>>, pred?: (val?: IChanValue<S>) => boolean): IProcTakeE<T, S> { if (pred !== undefined) { return take(this, sink, false, pred); } return take(this, sink); });
    return ret;
})();


type IGoArgs<T extends IStream, S extends IStream = T> = IChan<T, S> | (() => Generator<any, any, any>) | IAltsArgs<T, S>[] | (() => boolean) | ((val: IChanValue<T>) => any) | IProc;

export function go<T extends IStream = IStream, S extends IStream = T>(this: void | ((val: IChanValue<S>) => void), strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]): IProc {
    const hook = this;
    let chann: IChan<T, S> | IChan<S> | IChan<T>, operand: (() => Generator<any, any, any>) | IChan<T, S> | IChan<T> | IChan<S> | IProc | null = null;
    let pred: (() => boolean) | undefined = undefined;
    let argVals = [...args];
    const processEvs: (IProcE<ProcessEvents, T | S, S | T> | IProc)[] = [];
    const procLength = strings.join('').split(';').length;
    let check: number = 1, stringsArr: string[] = [];
    for (let i = 0; i < strings.length; i++) {
        if (strings[i].replace(/\s+/, '') === '') { continue; }
        if (strings[i].match(/;/)) {
            stringsArr.push(';'); stringsArr.push(...strings[i].split(';').filter(s => s !== ''));
            continue;
        }
        stringsArr.push(strings[i]);
    }
    const strLen = stringsArr.length - 1;
    for (let i = 0; i < strLen + 1; i++) {
        let op = stringsArr[i].trim();
        if (op === 'eval') {
            const startCondn: boolean = i === 0 && (stringsArr[i + 1] !== ';');
            const endCondn: boolean = i > 0 && i === strLen && (stringsArr[i - 1] !== ';');
            const genCondn: boolean = i > 0 && i < strLen && !(stringsArr[i - 1] === ';' && stringsArr[i + 1] === ';');
            const singletonCondn: boolean = i === 0 && strLen === 0;
            if (!singletonCondn && (startCondn || endCondn || genCondn)) {
                throw new Error("malformed syntax for eval. Eval processes can only exist as a single statement");
            }
            else {
                const oprnd: IProc = argVals.shift()! as IProc;
                //   console.log(oprnd);
                if (!isProcess(oprnd)) {
                    throw new Error("malformed syntax for eval. No process was passed after eval keyword");
                }
                else {
                    processEvs.push(oprnd);
                }
            }
        }
        else if (op === '>!') {
            chann = argVals.shift()! as IChan<T, S>;
            if (stringsArr[i + 1] !== undefined && stringsArr[i + 1].trim() === '?:') {
                let localAltsArgs: IAltsArgs<T, S>[] | undefined = argVals.shift() as IAltsArgs<T, S>[] | undefined;
                if (localAltsArgs !== undefined) { const { process, channel }: { process: IProc; channel: IChan<S> } = alts.apply<null, IAltsArgs<T, S>[], { process: IProc; channel: IChan<S>; }>(null, localAltsArgs); operand = channel; processEvs.push(process); }
            } else {
                operand = argVals.shift()! as IChan<T> | (() => Generator<IChanValue<T>, any, undefined>);
            }
            if (operand === null || chann === undefined) { throw new Error("Something's wrong with the put syntax here"); }
            processEvs.push((Ops.get(Symbol.for('>!'))! as (this: IChan<T, S>, ...args: any[]) => IProcPutE<T, S>).apply<IChan<T, S>, [(() => Generator<IChanValue<T>, IChanValue<T>, any>) | IChan<any, T>], IProcPutE<T, S>>(chann, [operand as (() => Generator<IChanValue<T>, IChanValue<T>, any>) | IChan<any, T>]));
        }
        else if (op === '<!') {
            if (stringsArr[i - 1] && stringsArr[i - 1] === '>!') { continue; }
            chann = argVals.shift()! as IChan<T, S>;
            if (i === stringsArr.length - 1) {
                if (argVals.length) { operand = argVals.shift()! as () => Generator<undefined, any, IChanValue<S>>; }
                if (argVals.length) { pred = argVals.shift() as () => boolean; }
            }
            // Changed (untested )from
            // else if (stringsArr[i + 1] && stringsArr[i + 1].indexOf(';') === -1) {
            //     operand = argVals.shift()! as () => Generator<undefined, any, IChanValue<T>>;
            // }
            else if (stringsArr[i + 1] && stringsArr[i + 1].indexOf(';') !== -1) {
                operand = argVals.shift()! as () => Generator<undefined, any, IChanValue<T>>;
            }
            // Changed (untested )from
            // else { operand = function* () { while (true) { yield; } }; }
            else { operand = function* () { yield; }; }
            processEvs.push((Ops.get(Symbol.for('<!'))! as (this: IChan<T, S>, ...args: any[]) => IProcTakeE<T, S>).apply<IChan<T, S>, any[], IProcTakeE<T, S>>(chann, [operand!, pred]));
        }
        else if (op === '?:' && (i === 0 || stringsArr[i - 1].indexOf(';') !== -1)) {
            const tmp: { process: IProc; channel: IChan<S> } = alts.apply<null, IAltsArgs<T, S>[], { process: IProc; channel: IChan<S>; }>(null, argVals.shift()! as IAltsArgs<T, S>[]);
            chann = tmp.channel;
            const callback = argVals.shift()! as (val: IChanValue<S>) => any;
            operand = function* () { const val = yield; callback(val); chann.close(); if (hook) { hook!(val); }; }
            processEvs.push(tmp.process);
            processEvs.push((Ops.get(Symbol.for('<!'))! as <R extends IStream>(this: IChan<R>, ...args: any[]) => IProcTakeE<R>).apply<IChan<S>, any[], IProcTakeE<S>>(chann, [operand]));
        }
        else if (stringsArr[i].indexOf(';') !== -1) { check++; }
        else { continue; }
    }
    if (check !== procLength) { throw new Error("number of processes mismatch with the syntax"); }
    const process: IProc = createProcess(...processEvs);
    // return process.kill.bind(process);
    return process;
}

export function timeout(msec: number): IChan<boolean> {
    const ch = chan<boolean>();
    const proc = createProcess(sleep(ch, msec));
    register.apply(CSP(), [proc]);
    proc.run();
    return ch;
}

function* pseudoSourceSink<S extends IStream>(ev: ProcessEvents.PUT | ProcessEvents.TAKE, winVal: { readonly val: IChanValue<S> | undefined; done?: boolean; setVal(val: IChanValue<S>): void }, val?: IChanValue<S>) {
    switch (ev) {
        case ProcessEvents.PUT: yield val!; if (!!!winVal.done) { winVal.done = true; winVal.setVal(val!); } break;
        case ProcessEvents.TAKE: const st = yield; if (!!!winVal.done) { winVal.done = true; winVal.setVal(st); } break;
        default: throw new Error("How did you end up here?");
    }
}

function isAltsPut<T extends IStream, S extends IStream = T>(val: any): val is IAltsArgsPut<T, S> {
    if (Array.isArray(val) && val.length === 2) { return true; }
    return false;
}

export function alts<T extends IStream = IStream, S extends IStream = T>(...args: IAltsArgs<T, S>[]): { process: IProc; channel: IChan<S> } {
    let processEvs: IProcE<ProcessEvents, T, S>[] = [];
    let winningVal: IChanValue<S> | undefined;
    let altFlag: boolean = true;
    const winVal: { readonly val: IChanValue<S> | undefined; done?: boolean; setVal(val: IChanValue<S>): void } = Object.create({ done: false }, {
        val: { get() { return winningVal; } },
        setVal: { value(val: IChanValue<S>) { winningVal = val; } }
    });
    const returnChan = chan<S>();
    for (let arg of Array.from(args)) {
        if (isAltsPut<T, S>(arg)) {
            const [chan, val] = arg as IAltsArgsPut<T, S>;
            processEvs.push(put<T, S>(chan, () => pseudoSourceSink(ProcessEvents.PUT, winVal, val) as Generator<IChanValue<T>, void, undefined>, altFlag));
        }
        else if (isChan(arg)) {
            const chan: IChan<T, S> = arg as IChan<T, S>;
            processEvs.push(take<T, S>(chan, () => pseudoSourceSink(ProcessEvents.TAKE, winVal) as Generator<undefined, void, IChanValue<IStream>>, altFlag));
        }
        else {
            throw new Error("Invalid syntax");
        }
    }
    const proc: IProc = createAlts(returnChan, winVal, altFlag, ...processEvs);
    return { process: proc, channel: returnChan };
}
