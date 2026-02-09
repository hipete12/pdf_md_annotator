// Karma configuration for unit tests

const webpackConfig = require('../webpack.renderer.config')

module.exports = function(config) {
  config.set({
    basePath: '..',
    
    frameworks: ['mocha', 'chai', 'webpack'],
    
    files: [
      'test/unit/**/*.spec.js'
    ],
    
    preprocessors: {
      'test/unit/**/*.spec.js': ['webpack']
    },
    
    webpack: {
      mode: 'development',
      module: webpackConfig.module,
      resolve: webpackConfig.resolve,
      plugins: webpackConfig.plugins.filter(p => 
        p.constructor.name !== 'HtmlWebpackPlugin' &&
        p.constructor.name !== 'CopyWebpackPlugin'
      ),
      // Don't need electron-specific stuff for unit tests
      target: 'web',
      externals: {
        electron: 'commonjs electron'
      }
    },
    
    reporters: ['progress', 'mocha'],
    
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['ChromeHeadless'],
    singleRun: false,
    concurrency: Infinity,
    
    client: {
      mocha: {
        timeout: 10000
      }
    }
  })
}
