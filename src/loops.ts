import { CSP, go as _go_, IStream, IGoArgs, IProc, createProcess, instructionCallback, ProcessEvents, IChanValue, Process } from './impl/index';

export function loopFor(times: number) {
    if (typeof times === 'number' && (!Number.isInteger(times) || times <= 0)) {
        throw new Error(`argument must be positive integer. Got ${times}`);
    }
    return <T extends IStream = IStream, S extends IStream = T>(strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]): IProc => {
        const cloneArgs: IGoArgs<T, S>[] = [...args];
        let proc: IProc = _go_<T, S>(strings, ...cloneArgs);
        let i: number = 0, processes: IProc[] = [];
        for (i; i < times; i++) {
            processes.push(proc);
            proc = _go_<T, S>(strings, ...cloneArgs);
        }
        const ret: IProc = createProcess(...processes);
        return ret;
    };
}
export function loop<T extends IStream = IStream, S extends IStream = IStream>(strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]): IProc {
    function* loop(procInst: IProc) {
        let thread: Generator<undefined, void, undefined>;
        thread = yield;
        const cloneArgs: IGoArgs<T, S>[] = [...args];
        let proc: IProc = _go_<T, S>(strings, ...cloneArgs);
        try {
            while (true) {
                if (!procInst.isLive) { break; }
                proc.run();
                if (proc.channel.closed) {
                    proc = _go_<T, S>(strings, ...cloneArgs)
                }
                else {
                    setImmediate(() => (CSP().get(proc.channel)!).add(instructionCallback(ProcessEvents.TAKE, proc.channel, ((_?: boolean) => { }) as ((val?: IChanValue<boolean>) => IChanValue<boolean> | void), thread)));
                    yield;
                    proc = _go_<T, S>(strings, ...cloneArgs);
                }
            }
        }
        finally {
            if (proc && !proc.channel.closed) { proc.kill(); };
            if (procInst.isLive) { procInst.kill(); }
        }
    }
    const mainProcess: IProc = new Process({
        events: [],
        thread: loop
    });
    return mainProcess;
}

export function loopWhile(pred?: ((val: any) => boolean)) {
    if (pred === undefined) { return loop; }
    return <T extends IStream = IStream, S extends IStream = IStream>(strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]): IProc => {
        function* loop(procInst: IProc) {
            let thread: Generator<undefined, void, undefined>;
            thread = yield;
            const cloneArgs: IGoArgs<T, S>[] = [...args];
            const hook: ((val: IChanValue<S>) => void) = function (val: IChanValue<S>) { if (pred!(val)) { thread.return(); } };
            let proc: IProc = _go_.apply<typeof hook, any[], IProc>(hook, [strings, ...cloneArgs]);
            try {
                while (true) {
                    if (!procInst.isLive) { break; }
                    proc.run();
                    if (proc.channel.closed) {
                        proc = _go_.apply<typeof hook, any[], IProc>(hook, [strings, ...cloneArgs]);
                    }
                    else {
                        setImmediate(() => (CSP().get(proc.channel)!).add(instructionCallback(ProcessEvents.TAKE, proc.channel, ((_: boolean) => { }) as ((val?: IChanValue<boolean>) => IChanValue<boolean> | void), thread)));
                        yield;
                        proc = _go_.apply<typeof hook, any[], IProc>(hook, [strings, ...cloneArgs]);
                    }
                }
            }
            finally {
                if (proc && !proc.channel.closed) { proc.kill(); };
                if (procInst.isLive) { procInst.kill(); }
            }
        }
        const mainProcess: IProc = new Process({
            events: [],
            thread: loop
        });
        return mainProcess;
    };
}
