const path = require('path')

module.exports = {
  entry: './src/main/main.js',
  target: 'electron-main',
  output: {
    path: path.resolve(__dirname, 'dist/main'),
    filename: 'main.js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.json']
  },
  node: {
    __dirname: false,
    __filename: false
  },
  externals: {
    'electron-store': 'commonjs electron-store',
    'electron-log': 'commonjs electron-log'
  }
}
