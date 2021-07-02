/* @flow */

import config from 'core/config'
import { warn, cached } from 'core/util/index'
import { mark, measure } from 'core/util/perf'

import Vue from './runtime/index'
import { query } from './util/index'
import { compileToFunctions } from './compiler/index'
import { shouldDecodeNewlines, shouldDecodeNewlinesForHref } from './util/compat'

// 此文件在 运行时版本 的 Vue 上添加 compiler

const idToTemplate = cached(id => { // 获取元素的 innerHTML，并且将结果缓存起来
  const el = query(id)
  return el && el.innerHTML
})

/**
 * 编译器的入口
 * 运行时的 Vue.js 包就没有这部分的代码，通过 打包器 结合 vue-loader + vue-compiler-utils 进行预编译，将模版编译成 render 函数
 *
 * 就做了一件事情，得到组件的渲染函数，将其设置到 this.$options 上
 */
const mount = Vue.prototype.$mount // 将 runtime only 的 $mount 备份，重新定义 $mount ，因为带 compiler 的 $mount 方法与之不同
Vue.prototype.$mount = function (
  el?: string | Element,
  hydrating?: boolean
): Component {

  // 挂载点 query 方法获取到 el 对应的 dom 元素
  el = el && query(el)

  /* istanbul ignore if */
    // 挂载点不能是 body 或者 html
  if (el === document.body || el === document.documentElement) {
    process.env.NODE_ENV !== 'production' && warn(
      `Do not mount Vue to <html> or <body> - mount to normal elements instead.`
    )
    return this
  }

  // 配置项
  const options = this.$options
  // resolve template/el and convert to render function
  /**
   * 如果用户提供了 render 配置项，则直接跳过编译阶段，否则进入编译阶段
   *   解析 template 和 el，并转换为 render 函数
   *   优先级：render > template > el
   */
  /**
   * 面试题：如果选项中同时设置了 el, template, render ，它们优先级是怎样的？
   * 它们的优先级 render > template > el
   */
  if (!options.render) {
    let template = options.template
    if (template) {
      // 处理 template 选项
      if (typeof template === 'string') {
        if (template.charAt(0) === '#') {
          // { template: '#app' }，template 是一个 id 选择器，则获取该元素的 innerHtml 作为模版
          template = idToTemplate(template)
          /* istanbul ignore if */
          if (process.env.NODE_ENV !== 'production' && !template) {
            warn(
              `Template element not found or is empty: ${options.template}`,
              this
            )
          }
        }
      } else if (template.nodeType) {
        // template 是一个正常的元素，获取其 innerHtml 作为模版
        template = template.innerHTML
      } else {
        // template 既不是字符串也不是 Dom 节点，报错返回
        if (process.env.NODE_ENV !== 'production') {
          warn('invalid template option:' + template, this)
        }
        return this
      }
    } else if (el) {
      // 设置了 el 选项，获取 el 选择器的 outerHtml 作为模版
      template = getOuterHTML(el)
    }

    // 模版就绪，进入编译阶段
    // 对字符串形式的 template 进行处理，将其变成 render 方法
    if (template) {
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile')
      }

      // 编译模版，得到 动态渲染函数和静态渲染函数
      const { render, staticRenderFns } = compileToFunctions(template, {
        // 在非生产环境下，编译时记录标签属性在模版字符串中开始和结束的位置索引
        outputSourceRange: process.env.NODE_ENV !== 'production',
        shouldDecodeNewlines,
        shouldDecodeNewlinesForHref,
        // 界定符，默认 {{}}
        delimiters: options.delimiters,
        // 是否保留注释
        comments: options.comments
      }, this)
      // 将两个渲染函数放到 this.$options 上
      options.render = render
      options.staticRenderFns = staticRenderFns

      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile end')
        measure(`vue ${this._name} compile`, 'compile', 'compile end')
      }
    }
  }

  // 执行挂载
  return mount.call(this, el, hydrating)
}

/**
 * Get outerHTML of elements, taking care
 * of SVG elements in IE as well.
 */
function getOuterHTML (el: Element): string { // 获取 el 对应元素的序列化 html 片段
  if (el.outerHTML) {
    return el.outerHTML
  } else {
    const container = document.createElement('div')
    container.appendChild(el.cloneNode(true))
    return container.innerHTML
  }
}

Vue.compile = compileToFunctions

export default Vue
