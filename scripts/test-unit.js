/**
 * Unit test runner: bundles test/unit/*.spec.js with webpack (so the specs can
 * use the same ESM/alias setup as the renderer) and runs them with Mocha in Node.
 *
 * Usage: node scripts/test-unit.js
 */
const fs = require('fs')
const path = require('path')
const webpack = require('webpack')
const Mocha = require('mocha')
const chai = require('chai')
const { JSDOM } = require('jsdom')
const rendererConfig = require('../webpack.renderer.config')

const root = path.resolve(__dirname, '..')
const specDir = path.join(root, 'test/unit')
// Inside the project so the bundles can resolve externals from node_modules
const outDir = path.join(root, 'node_modules/.cache/unit-tests')
fs.rmSync(outDir, { recursive: true, force: true })

const specs = fs.readdirSync(specDir).filter(f => f.endsWith('.spec.js'))
const entry = Object.fromEntries(
  specs.map(f => [f.replace(/\.js$/, ''), path.join(specDir, f)])
)

const compiler = webpack({
  mode: 'development',
  devtool: 'inline-source-map',
  target: 'node',
  context: root,
  entry,
  output: { path: outDir, filename: '[name].js', libraryTarget: 'commonjs2' },
  module: { rules: rendererConfig.module.rules.filter(r => !String(r.test).includes('css')) },
  resolve: rendererConfig.resolve,
  // Load npm packages (and electron, which resolves to a path string outside
  // Electron) straight from node_modules instead of bundling them.
  externals: [({ request }, callback) => {
    if (/^[a-z@][^:]*$/i.test(request) && !request.startsWith('@/') && !request.startsWith('@common')) {
      return callback(null, `commonjs ${request}`)
    }
    callback()
  }],
  plugins: rendererConfig.plugins.filter(p => p.constructor.name === 'DefinePlugin')
})

compiler.run((err, stats) => {
  if (err || stats.hasErrors()) {
    console.error(err || stats.toString({ colors: true, all: false, errors: true }))
    process.exit(1)
  }

  global.expect = chai.expect
  const mocha = new Mocha({ timeout: 10000 })
  for (const name of Object.keys(entry)) mocha.addFile(path.join(outDir, `${name}.js`))

  // Load the specs before creating the DOM: libraries such as Prism pick a
  // browser or Node mode at import time and break with a partial DOM. Code that
  // needs a window lazily (DOMPurify in utils/markdown.js) gets it afterwards.
  mocha.loadFiles()
  mocha.lazyLoadFiles(true)
  global.window = new JSDOM('<!doctype html><html><body></body></html>').window

  mocha.run(failures => {
    process.exitCode = failures ? 1 : 0
  })
})
