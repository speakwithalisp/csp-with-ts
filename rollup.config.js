import typescript from 'rollup-plugin-typescript2'
import pkg from './package.json'
import tscc from '@tscc/rollup-plugin-tscc';
import resolve from "@rollup/plugin-node-resolve";

const override = {
    compilerOptions: {
        module: "esnext",
        "declaration": true,
        "declarationMap": true,
        "declarationDir": "lib/",
        "removeComments": true
    }
};

export default {
    input: 'src/index.ts',
    output: [{
        name: "./lib/index.js",
        format: 'commonjs',
        dir: 'lib'
    }
    ],
    external: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
    ],
    plugins: [
        resolve(),
        tscc({
            specFile: "./tscc.spec.json"
        }),
        typescript({
            useTsconfigDeclarationDir: true,
            tsconfigOverride: override,
            typescript: require('typescript')
        })
    ]
}
