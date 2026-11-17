import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const cache = new Map()
function load(filename) {
  if (cache.has(filename)) return cache.get(filename)
  const nativeRequire = createRequire(filename)
  if (extname(filename) === '.json') return nativeRequire(filename)
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, crypto: globalThis.crypto,
    require(id) {
      if (id.startsWith('~~/') || id.startsWith('.')) {
        const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(filename), id)
        return load(extname(target) ? target : `${target}.ts`)
      }
      return nativeRequire(id)
    }
  }, { filename })
  cache.set(filename, module.exports)
  return module.exports
}

const { createEmptyProject, createInitialProjects, normalizeProject, buildProjectSummary } =
  load(resolve(root, 'utils/project-factory.ts'))
const publisher = '中国石油天然气股份有限公司规划总院'

test('new and seed projects use the current delivery organization', () => {
  assert.equal(createEmptyProject('新项目').owner, publisher)
  for (const project of createInitialProjects()) {
    assert.equal(project.owner, publisher)
    assert.equal(buildProjectSummary(project).owner, publisher)
  }
})

test('legacy project owners migrate without changing project contents or timestamps', () => {
  for (const owner of [
    '龙源（北京）新能源工程技术有限公司',
    '龙源 (北京) 新能源工程技术有限公司',
    ' 龙源（北京）新能源工程技术有限公司 '
  ]) {
    const project = { ...createEmptyProject('历史项目'), owner }
    const before = JSON.stringify(project)
    const normalized = normalizeProject(project)
    assert.equal(normalized.owner, publisher)
    assert.equal(buildProjectSummary(normalized).owner, publisher)
    assert.equal(JSON.stringify(project), before)
    assert.equal(JSON.stringify({ ...normalized, owner }), before)
    assert.equal(JSON.stringify(normalizeProject(normalized)), JSON.stringify(normalized))
  }
})

test('custom and current project owners remain unchanged', () => {
  for (const owner of ['项目负责人张三', publisher, '其他新能源工程技术有限公司', '']) {
    assert.equal(normalizeProject({ ...createEmptyProject('项目'), owner }).owner, owner)
  }
})
