# Vendored WebAssembly

`claude-spore draw` lays out and pictures a workflow with these, so the person installs no
Graphviz and the helper downloads nothing (docs/spec.md, p.24). Each folder is one npm
package's built files, unmodified, beside its licence.

| Folder | Package | Version | Files | Licence |
|---|---|---|---|---|
| `graphviz/` | [`@hpcc-js/wasm-graphviz`](https://github.com/hpcc-systems/hpcc-js-wasm) | 1.29.2 (Graphviz 16.1.0) | `graphviz.js` is `dist/index.js`, the WebAssembly inlined | Apache-2.0 (`LICENSE`); Graphviz itself is EPL-1.0, [graphviz.org/license](https://graphviz.org/license/) |
| `resvg/` | [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js) | 2.6.2 | `resvg.mjs` is `index.mjs`, `resvg.wasm` is `index_bg.wasm` | MPL-2.0 (`LICENSE`); the source is the package's repository at that version |

To update one, install the package in a scratch folder (`bun add <package>@<version>`), copy the
files named above over these, change the version here, and run `bun test plugins/ml-workflow/test`.
