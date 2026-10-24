// Bench setup: CSP_SCHEDULER=<driver> selects the driver for the whole run (scripts/bench-ab.mjs alternates drivers).
import { __resetCSP, __setTestDefaults, DriverName } from '../../src/impl/service';

const scheduler = process.env.CSP_SCHEDULER as DriverName | undefined;
if (scheduler) { __setTestDefaults({ scheduler }); }
__resetCSP();
