import { ProcessEvents, InstrTypes, IStream } from './constants';
import { IChan } from './channels';
import { IProcE, IProcPutE, IProcTakeE } from './processEvents'
import { Instruction, InstructionGeneral, InstructionCallback } from './instructions';
import { ProcessEventQ } from './processQueue';
import CSP from './service';

// scheduling functions
export function queueImmediately<T extends IStream, S extends IStream = T>(proc: IProcE<ProcessEvents, T, S>) { (proc as IProcPutE<T, S> | IProcTakeE<T, S>).return(); }

export function queueNextOnThread(thread: Generator<undefined, void, undefined>) {
    thread.next();
}
export function queueRecursiveAdd<T extends IStream>(toPQ: ProcessEventQ<T | T & IStream>, fromPQ: ProcessEventQ<T>, instr: Instruction<T, InstrTypes, any>): void {
    toPQ.channel.altFlag = fromPQ.channel.altFlag;
    switch (instr.INSTRUCTION) {
        case InstrTypes.GENERAL: const instruction = () => (instr as InstructionGeneral<T>);
            Object.defineProperties(instruction, {
                INSTRUCTION: { get() { return instr.INSTRUCTION; } },
                event: { get() { return instr.event; } },
                channel: { get() { return fromPQ.channel; } },
            });
            toPQ.add(instruction as (() => InstructionGeneral<T>) & {
                readonly INSTRUCTION: InstrTypes.GENERAL;
                readonly event: ProcessEvents;
                readonly channel: IChan<T>;
            }); break;
        default:
            if (fromPQ.channel === instr.channel) {
                // toPQ.addCallback(instr as InstructionCallback<T>);
                toPQ.add(instr as InstructionCallback<T>);
            }
            else {
                const instrCallback = function () { return (instr as InstructionCallback<T>)(...[...arguments]); }
                Object.defineProperties(instrCallback, {
                    INSTRUCTION: { get() { return instr.INSTRUCTION; } },
                    event: { get() { return instr.event; } },
                    // check here
                    channel: { get() { return fromPQ.channel; } }
                });
                // toPQ.addCallback(instrCallback as InstructionCallback<T>);
                toPQ.add(instrCallback as InstructionCallback<T>);
            }
            break;
    }
}
export function queueFlushChannel<T extends IStream>(chan: IChan<T>) {
    if (CSP().has(chan)) {
        CSP().get(chan)!.flush();
    }
};
