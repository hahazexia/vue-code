/* @flow */

import { warn } from 'core/util/index'

export * from './attrs'
export * from './class'
export * from './element'

/**
 * Query an element selector if it's not an element already.
 */
export function query (el: string | Element): Element { // 获取 el 参数对应的 dom 元素
  if (typeof el === 'string') {
    const selected = document.querySelector(el) // 如果 el 参数是字符串，用 document.querySelector 获取
    if (!selected) { // 如果找不到 el 对应 dom 元素，报出警告，然后返回一个新建的 div 元素
      process.env.NODE_ENV !== 'production' && warn(
        'Cannot find element: ' + el
      )
      return document.createElement('div')
    }
    return selected
  } else { // 如果 el 不是字符串，直接返回
    return el
  }
}
