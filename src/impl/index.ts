import { CSP as csp } from './service';
import { register } from './process';
import { IStream as IStreamInternal } from './constants';
import { BufferType as BT, DroppingBuffer as DB, SlidingBuffer as SB, FixedBuffer as FB } from './buffers';
import { IChan as IntChan, IProc as IP, IChanValue as IntChanV, IAltsArgs as IAA, IGoordinator } from './interfaces';
import { ITransducer as IT, Reduced as R, IXForm as IX } from './utils';

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
export declare type IGoArgs<T extends IStream, S extends IStream = T> = IChan<T, S> | (() => Generator<any, any, any>) | IAltsArgs<T, S>[] | (() => boolean) | ((val: IChanValue<T>) => any) | IProc;
export function CSP(): IGoordinator { return csp(register); }
export { isReduced } from './utils';
export { dropping, fixed, sliding } from './buffers';
export { chan, isChan } from './channels';
export { putAsync, takeAsync } from './processEvents';
export { timeout, go } from './go';
export { isProcess, createProcess, Process } from './process';
export { ProcessEvents } from './constants';
export { instructionCallback } from './instructions';
