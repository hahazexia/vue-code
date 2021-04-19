/* @flow */

import config from 'core/config'
import { warn, cached } from 'core/util/index'
import { mark, measure } from 'core/util/perf'

import Vue from './runtime/index'
import { query } from './util/index'
import { compileToFunctions } from './compiler/index'
import { shouldDecodeNewlines, shouldDecodeNewlinesForHref } from './util/compat'

const idToTemplate = cached(id => { // 获取元素的 innerHTML，并且将结果缓存起来
  const el = query(id)
  return el && el.innerHTML
})

const mount = Vue.prototype.$mount // 将 runtime only 的 $mount 存下，重新定义 $mount ，因为带 compiler 的 $mount 方法与之不同
Vue.prototype.$mount = function (
  el?: string | Element,
  hydrating?: boolean
): Component {
  el = el && query(el) // query 方法获取到 el 对应的 dom 元素

  /* istanbul ignore if */
  if (el === document.body || el === document.documentElement) { // 判断 el 对应 dom 元素是否是 html 和 body ，如果是就警告
    process.env.NODE_ENV !== 'production' && warn(
      `Do not mount Vue to <html> or <body> - mount to normal elements instead.`
    )
    return this
  }

  const options = this.$options
  // resolve template/el and convert to render function
  if (!options.render) { // 如果没有定义 render 方法
    let template = options.template // template 参数
    if (template) {
      if (typeof template === 'string') { // 如果 template 参数是字符串
        if (template.charAt(0) === '#') { // 如果值以 # 开始，则它将被用作选择符，并使用匹配元素的 innerHTML 作为模板。
          template = idToTemplate(template) // 根据选择符获取元素的 innerHTML
          /* istanbul ignore if */
          if (process.env.NODE_ENV !== 'production' && !template) { // 如果获取不到元素就警告
            warn(
              `Template element not found or is empty: ${options.template}`,
              this
            )
          }
        }
      } else if (template.nodeType) { // 如果 template 是 dom 节点，直接获取 innerHtml
        template = template.innerHTML
      } else {// template 不是字符串也不是节点，报错返回
        if (process.env.NODE_ENV !== 'production') {
          warn('invalid template option:' + template, this)
        }
        return this
      }
    } else if (el) {// 如果没有定义 template 属性，获取字符串形式的 html 片段
      template = getOuterHTML(el)
    }
    if (template) { // 对字符串形式的 template 进行处理，将其变成 render 方法
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile')
      }

      const { render, staticRenderFns } = compileToFunctions(template, {
        outputSourceRange: process.env.NODE_ENV !== 'production',
        shouldDecodeNewlines,
        shouldDecodeNewlinesForHref,
        delimiters: options.delimiters,
        comments: options.comments
      }, this)
      options.render = render // 添加 template 编译好的 render 方法到 $options 上
      options.staticRenderFns = staticRenderFns

      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile end')
        measure(`vue ${this._name} compile`, 'compile', 'compile end')
      }
    }
  }
  return mount.call(this, el, hydrating) // 调用 runtime only 时定义的 $mount 方法
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
