import { CSP as csp } from './impl/service';
import { IStream as IStreamInternal } from './impl/constants';
import { BufferType as BT, DroppingBuffer as DB, SlidingBuffer as SB, FixedBuffer as FB } from './impl/buffers';
import { IChan as IntChan, IProc as IP, IChanValue as IntChanV, IAltsArgs as IAA, IGoordinator } from './impl/interfaces';
import { ITransducer as IT, Reduced as R, IXForm as IX } from './impl/utils';

//type declarations
export declare type BufferType<T extends IStream> = BT<T>;
export declare type FixedBuffer<T extends IStream> = FB<T>;
export declare type SlidingBuffer<T extends IStream> = SB<T>;
export declare type DroppingBuffer<T extends IStream> = DB<T>;
export declare type ITransducer<A = any, B = any, C = any> = IT<A, B, C>;
export declare type IXForm<A = any, B = any> = IX<A, B>;
export declare type Reduced<A = any> = R<A>;
export declare type IStream = IStreamInternal;
export declare type IChan<T extends IStream = IStream, S extends IStream = T> = IntChan<T, S>;
export declare type IChanValue<T extends IStream> = IntChanV<T>;
export declare type IProc = IP;
export declare type IAltsArgs<T extends IStream = IStream, S extends IStream = T> = IAA<T, S>;
export declare type IGoArgs<T extends IStream, S extends IStream = T> = IChan<T, S> | (() => Generator<any, any, any>) | IAltsArgs<T, S>[] | (() => boolean) | ((val: IChanValue<T>) => any);

// var declarations
export declare var CSP: (reg?: ((this: IGoordinator, process: IProc) => void)) => IGoordinator;
export declare var isReduced: <A = any >(val: any) => val is Reduced<A>;
export declare var chan: <T extends IStream, Q extends IStream = T> (buf?: number | BufferType<Q extends T ? T : Q>, xform?: ITransducer<IChanValue<T>, IChanValue<Q>, BufferType<Q>>, exHandler?: Function) => (IChan<T> | IChan<T, Q>);
export declare var isChan: <T extends IStream, Q extends IStream = T>(obj: any) => obj is IChan<T, Q>;
export declare var dropping: <T extends IStream = IStream>(n: number) => DroppingBuffer<T>;
export declare var sliding: <T extends IStream = IStream>(n: number) => SlidingBuffer<T>;
export declare var fixed: <T extends IStream = IStream>(n: number) => FixedBuffer<T>;
export declare var putAsync: <T extends IStream = IStream, S extends IStream = T>(ch: IChan<T, S>, val: T, close?: boolean, cb?: () => any | void) => void;
export declare var takeAsync: <T extends IStream = IStream, S extends IStream = T>(ch: IChan<T, S>) => Promise<IChanValue<S>>;
export declare var go: <T extends IStream = IStream, S extends IStream = IStream> (strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]) => (() => void);
export declare var timeout: (msec: number) => IChan<boolean>;


// relevant function imports and assigns
CSP = function (): IGoordinator { return csp(register); };
import { register } from './impl/process';
import { isReduced as iR } from './impl/utils';
isReduced = iR;
import { dropping as d, fixed as f, sliding as sl } from './impl/buffers';
dropping = d; fixed = f; sliding = sl;
import { chan as ch, isChan as isCh } from './impl/channels';
chan = ch; isChan = isCh;
import { putAsync as pA, takeAsync as tA } from './impl/processEvents';
putAsync = pA; takeAsync = tA;
import { go as g, timeout as t } from './impl/go';
go = g; timeout = t;
