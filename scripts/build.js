const webpack = require('webpack')
const path = require('path')
const mainConfig = require('../webpack.main.config')
const rendererConfig = require('../webpack.renderer.config')

function build() {
  console.log('Building main process...')
  
  return new Promise((resolve, reject) => {
    webpack({
      ...mainConfig,
      mode: 'production'
    }, (err, stats) => {
      if (err) {
        reject(err)
        return
      }

      if (stats.hasErrors()) {
        reject(new Error(stats.toString({ colors: true })))
        return
      }

      console.log(stats.toString({
        colors: true,
        modules: false,
        children: false
      }))

      console.log('Main process built successfully\n')
      resolve()
    })
  }).then(() => {
    console.log('Building renderer process...')
    
    return new Promise((resolve, reject) => {
      webpack({
        ...rendererConfig,
        mode: 'production'
      }, (err, stats) => {
        if (err) {
          reject(err)
          return
        }

        if (stats.hasErrors()) {
          reject(new Error(stats.toString({ colors: true })))
          return
        }

        console.log(stats.toString({
          colors: true,
          modules: false,
          children: false
        }))

        console.log('Renderer process built successfully\n')
        console.log('Build complete!')
        resolve()
      })
    })
  })
}

build().catch(err => {
  console.error('Build failed:', err)
  process.exit(1)
})
