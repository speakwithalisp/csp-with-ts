import { IGoordinator } from './impl/interfaces';
import { CSP as csp } from './impl/service';
import { register } from './impl/process';
export { dropping, fixed, sliding } from './impl/buffers';
export { chan } from './impl/channels';
export { putAsync, takeAsync } from './impl/processEvents';
export { go, timeout } from './impl/go';
export * from './impl/utils';

export function CSP(): IGoordinator { return csp(register); }
