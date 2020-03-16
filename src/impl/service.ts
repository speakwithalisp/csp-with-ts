import { IStream } from './constants';
import { IChan, ProcessEventQ, IGoordinator, IProc } from './interfaces';

let CSPInstance: IGoordinator | null = null;

export function CSP(reg?: ((this: IGoordinator, process: IProc) => void)): IGoordinator {
    if (!CSPInstance) {
        let ret = new WeakMap<IChan<IStream>, ProcessEventQ<IStream>>();
        const register: (this: IGoordinator, process: IProc) => void = reg!;
        Object.defineProperties(ret, {
            register: { value: register },
        });
        CSPInstance = ret as IGoordinator;
    }
    return CSPInstance as IGoordinator;
}
