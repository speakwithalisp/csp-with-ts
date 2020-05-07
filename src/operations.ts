import { go } from './impl/go';
import { IProc } from './impl/interfaces';
import { IStream } from './impl/constants';
import { createProcess } from './impl/process';
import { IGoArgs } from '.';

function _clone_(proc: IProc): IProc {
    const ret: IProc = createProcess(...proc.events);
    ret.run();
    return ret;
}

export function goLoop(times?: number) {
    if (times !== undefined && (!Number.isInteger(times) || times <= 0)) {
        throw new Error(`argument must be positive integer. Got ${times}`);
    }
    return <T extends IStream = IStream, S extends IStream = IStream>(strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]): () => void => {
        function* loop() {
            let proc: IProc = go(strings, ...args);
            if (times === undefined) {
                while (true) {
                    yield* proc.notify();
                    proc = _clone_(proc);
                }
            }
        }
        const runtime: Generator<undefined, void, undefined> = loop();
        return () => { runtime.return(); }
    };
}
