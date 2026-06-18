const path = require("path");
const TerserPlugin = require('terser-webpack-plugin');
const CompressionPlugin = require('compression-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const shouldCompress = env && env.compress;
  
  return {
    mode: isProduction ? 'production' : 'development',
    entry: {
      main: "./src/index.js",
      builder: "./src/environmentBuilder/index.js",
    },
    output: {
      filename: "[name].bundle.js",
      path: path.resolve(__dirname, "static/dist"),
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_console: isProduction,
              drop_debugger: isProduction
            }
          }
        })
      ],
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          // Don't extract shared *source* modules into common chunks. Our HTML
          // templates load a fixed bundle list per page, so a shared src chunk
          // (e.g. Composer, imported by both the main and builder entries) would
          // be silently missing on the main page. Keep src inside each entry.
          default: false,
          react: {
            test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
            name: 'react',
            chunks: 'all',
            priority: 10
          },
          // Isolate Blockly into its own chunk so it only loads on the
          // builder page and never bloats the main Composer bundle.
          blockly: {
            test: /[\\/]node_modules[\\/]blockly[\\/]/,
            name: 'blockly',
            chunks: 'all',
            priority: 20
          },
          vendors: {
            test: /[\\/]node_modules[\\/](?!(react|react-dom|blockly)[\\/])/,
            name: 'vendors',
            chunks: 'all',
            priority: -10
          },
        },
      },
    },
    plugins: [
      ...(shouldCompress ? [
        new CompressionPlugin({
          test: /\.js$/,
          algorithm: 'gzip'
        })
      ] : [])
    ],
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          include: [path.resolve(__dirname, "src")],
          use: {
            loader: "babel-loader",
            options: {
              presets: [
                ["@babel/preset-env", {
                  modules: false,
                  useBuiltIns: "usage",
                  corejs: 3
                }],
                "@babel/preset-react"
              ],
              plugins: isProduction ? [
                "transform-react-remove-prop-types"
              ] : []
            }
          }
        },

	{
	  test: /\.ya?ml$/,
	  use: 'yaml-loader'
	}
      ],
    },
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      '@config': path.resolve(__dirname, 'config.yml'),
      '@composer_index': path.resolve(__dirname, 'src/composer', 'index.js')
    },
  },

  };
};
