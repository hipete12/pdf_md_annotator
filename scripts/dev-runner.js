const { spawn } = require('child_process')
const path = require('path')
const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')
const mainConfig = require('../webpack.main.config')
const rendererConfig = require('../webpack.renderer.config')

let electronProcess = null

function startRenderer() {
  return new Promise((resolve, reject) => {
    const compiler = webpack(rendererConfig)
    
    const server = new WebpackDevServer({
      static: {
        directory: path.join(__dirname, '../dist/renderer')
      },
      port: 9080,
      hot: true
    }, compiler)

    server.start().then(() => {
      console.log('Renderer dev server started at http://localhost:9080')
      resolve()
    }).catch(reject)
  })
}

function startMain() {
  return new Promise((resolve, reject) => {
    const compiler = webpack({
      ...mainConfig,
      mode: 'development'
    })

    compiler.watch({}, (err, stats) => {
      if (err) {
        console.error(err)
        return
      }

      console.log(stats.toString({
        colors: true,
        modules: false,
        children: false
      }))

      if (electronProcess) {
        electronProcess.kill()
        electronProcess = null
      }

      startElectron()
      resolve()
    })
  })
}

function startElectron() {
  const electronPath = require('electron')
  
  electronProcess = spawn(electronPath, [
    '--inspect=5858',
    path.join(__dirname, '../dist/main/main.js'),
    '--dev'
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DEV_SERVER_URL: 'http://localhost:9080'
    }
  })

  electronProcess.on('close', () => {
    process.exit()
  })
}

async function start() {
  try {
    await startRenderer()
    await startMain()
  } catch (err) {
    console.error('Failed to start dev environment:', err)
    process.exit(1)
  }
}

start()
