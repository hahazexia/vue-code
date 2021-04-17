const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const rollup = require('rollup')
const terser = require('terser')

if (!fs.existsSync('dist')) { //如果根目录不存在 dist 文件夹，就生成 dist 文件夹（rollup构建的目标目录都在 dist 文件夹）
  fs.mkdirSync('dist')
}

let builds = require('./config').getAllBuilds()
// 从 ./script/config.js 文件获取所有的不同构建目标的 rollup 打包配置，builds 是一个数组

// filter builds via command line arg
// 过滤构建的时候命令行传入的参数
//process.argv 返回 nodejs 进程运行的时候的命令行参数，是一个数组。数组的第一个元素是 nodejs 可执行程序的路径，第二个元素是被执行的 js 文件的路径，从第三个参数开始才是真正的命令行参数，也就是 process.argv[2]
if (process.argv[2]) { // 如果有命令行参数
  const filters = process.argv[2].split(',')
  // 参数是逗号分隔的 构建目标name，例如 npm run build -- web-full-prod,web-server-basic-renderer
  // 根据命令行参数过滤掉 rollup 配置中不需要的项
  builds = builds.filter(b => {
    return filters.some(f => b.output.file.indexOf(f) > -1 || b._name.indexOf(f) > -1)
  })
} else { // 如果没有命令行参数，默认过滤掉 weex 构建
  // filter out weex builds by default
  builds = builds.filter(b => {
    return b.output.file.indexOf('weex') === -1
  })
}

build(builds) // 调用 build 开始构建

function build (builds) {
  let built = 0
  const total = builds.length
  const next = () => { //递归调用 next 将 builds 数组中所有 rollup 配置都进行构建
    buildEntry(builds[built]).then(() => {
      built++
      if (built < total) {
        next()
      }
    }).catch(logError)
  }

  next()
}

function buildEntry (config) { // 调用 rollup 进行构建
  const output = config.output
  const { file, banner } = output
  const isProd = /(min|prod)\.js$/.test(file)
  return rollup.rollup(config)
    .then(bundle => bundle.generate(output))
    .then(({ output: [{ code }] }) => {
      if (isProd) { // 如果是生产包，调用 terser 将代码压缩
        const minified = (banner ? banner + '\n' : '') + terser.minify(code, {
          toplevel: true,
          output: {
            ascii_only: true
          },
          compress: {
            pure_funcs: ['makeMap']
          }
        }).code
        return write(file, minified, true) // 写入文件
      } else {
        return write(file, code) // 写入文件
      }
    })
}

function write (dest, code, zip) {
  return new Promise((resolve, reject) => {
    function report (extra) { //打印当前工作目录，和文件输入路径，还有输出文件大小
      console.log(blue(path.relative(process.cwd(), dest)) + ' ' + getSize(code) + (extra || ''))
      resolve()
    }

    fs.writeFile(dest, code, err => {//将打包好的代码写入文件，如果需要压缩，调用 nodejs 模块 zlib 进行 hxip 压缩
      if (err) return reject(err)
      if (zip) {
        zlib.gzip(code, (err, zipped) => {
          if (err) return reject(err)
          report(' (gzipped: ' + getSize(zipped) + ')')
        })
      } else {
        report()
      }
    })
  })
}

function getSize (code) {
  return (code.length / 1024).toFixed(2) + 'kb'
}

function logError (e) {
  console.log(e)
}

function blue (str) {
  return '\x1b[1m\x1b[34m' + str + '\x1b[39m\x1b[22m'
}
