| driver | first value after load (ms) | whole process wall (ms) | wall minus empty process (ms) |
|---|---|---|---|
| (empty process) | - | 52.6 | 0.0 |
| immediate | 3.37 | 61.0 | 8.4 |
| messagechannel | 5.57 | 84.8 | 32.2 |
| timeout | 3.44 | 59.1 | 6.6 |
| microtask | 3.53 | 60.1 | 7.5 |

Medians of 40 fresh processes each, Node v22.23.4.
