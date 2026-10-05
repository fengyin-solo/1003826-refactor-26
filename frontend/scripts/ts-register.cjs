// 纯 JS 的 TS 加载器：用 typescript.transpileModule + 简易 @ 别名解析，无需原生依赖。
const Module = require('module')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  let resolved = request
  if (request.startsWith('@/')) {
    resolved = path.join(SRC, request.slice(2))
  } else if (request.startsWith('.') && parent && parent.filename) {
    resolved = path.resolve(path.dirname(parent.filename), request)
  }
  if (resolved.endsWith('.ts') || (resolved.startsWith(SRC) && fs.existsSync(resolved + '.ts'))) {
    const file = resolved.endsWith('.ts') ? resolved : resolved + '.ts'
    const source = fs.readFileSync(file, 'utf8')
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      fileName: file,
    })
    const mod = new Module(file, parent)
    mod.filename = file
    mod.paths = Module._nodeModulePaths(path.dirname(file))
    mod._compile(out.outputText, file)
    return mod.exports
  }
  return originalLoad.call(this, request, parent, isMain)
}
