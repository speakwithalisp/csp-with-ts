import { IStream, IProc, go as _go_, IGoArgs } from './impl/index';

interface IGoReturn {
    (): void;
};

export function go<T extends IStream = IStream, S extends IStream = IStream>(strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]): IGoReturn {
    const goProc: IProc = _go_<T, S>(strings, ...args);
    goProc.run();
    return goProc.kill.bind(goProc);
}

export { IStream, BufferType, chan, isChan, IChan, IChanValue, IProc, ITransducer, IXForm, Reduced, isReduced, timeout, putAsync, takeAsync, dropping, fixed, sliding, IAltsArgs, IGoArgs } from './impl/index';

export { loop, loopFor, loopUntil } from './loops';
