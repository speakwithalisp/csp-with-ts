import { createRequire } from 'node:module';
import typescript from 'rollup-plugin-typescript2';
import resolve from '@rollup/plugin-node-resolve';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const override = {
    compilerOptions: {
        module: 'esnext',
        declaration: true,
        declarationMap: true,
        declarationDir: 'lib/',
        removeComments: true,
        rootDir: "src"
    }
};

export default {
    input: 'src/index.ts',
    output: [{
        format: 'commonjs',
        dir: 'lib',
        exports: 'named'
    }],
    external: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
    ],
    plugins: [
        resolve(),
        typescript({
            useTsconfigDeclarationDir: true,
            tsconfigOverride: override,
            typescript: require('typescript')
        })
    ]
};
