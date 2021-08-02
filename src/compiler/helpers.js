/* @flow */

import { emptyObject } from 'shared/util'
import { parseFilters } from './parser/filter-parser'

type Range = { start?: number, end?: number };

/* eslint-disable no-unused-vars */
export function baseWarn (msg: string, range?: Range) {
  console.error(`[Vue compiler]: ${msg}`)
}
/* eslint-enable no-unused-vars */

export function pluckModuleFunction<F: Function> (
  modules: ?Array<Object>,
  key: string
): Array<F> {
  return modules
    ? modules.map(m => m[key]).filter(_ => _)
    : []
}

export function addProp (el: ASTElement, name: string, value: string, range?: Range, dynamic?: boolean) {
  (el.props || (el.props = [])).push(rangeSetItem({ name, value, dynamic }, range))
  el.plain = false
}

export function addAttr (el: ASTElement, name: string, value: any, range?: Range, dynamic?: boolean) {
  const attrs = dynamic
    ? (el.dynamicAttrs || (el.dynamicAttrs = []))
    : (el.attrs || (el.attrs = []))
  attrs.push(rangeSetItem({ name, value, dynamic }, range))
  el.plain = false
}

// add a raw attr (use this in preTransforms)
// 在 el.attrsMap 和 el.attrsList 中添加指定属性 name
export function addRawAttr (el: ASTElement, name: string, value: any, range?: Range) {
  el.attrsMap[name] = value
  el.attrsList.push(rangeSetItem({ name, value }, range))
}

/**
 * 
 * @param {*} el ast 对象
 * @param {*} name 指令的名字，例如 v-custom 则 name 为 custom
 * @param {*} rawName 原始属性名字，例如 v-custom:arg.prevent
 * @param {*} value  属性值，例如 v-custom="customFun" 则 value 为 customFun
 * @param {*} arg 指令指定的参数
 * @param {*} isDynamicArg 参数是否是动态的参数名
 * @param {*} modifiers 修饰符组成的对象
 * @param {*} range 原 el.attrsList 中的对象
 */
export function addDirective (
  el: ASTElement,
  name: string,
  rawName: string,
  value: string,
  arg: ?string,
  isDynamicArg: boolean,
  modifiers: ?ASTModifiers,
  range?: Range
) {
  (el.directives || (el.directives = [])).push(rangeSetItem({
    name,
    rawName,
    value,
    arg,
    isDynamicArg,
    modifiers
  }, range))
  el.plain = false
}

function prependModifierMarker (symbol: string, name: string, dynamic?: boolean): string {
  return dynamic
    ? `_p(${name},"${symbol}")`
    : symbol + name // mark the event as captured
}

/**
 * 处理事件属性，将事件属性添加到 el.events 对象或者 el.nativeEvents 对象中，格式：
 * el.events[name] = [{ value, start, end, modifiers, dynamic }, ...]
 * 其中用了大量的篇幅在处理 name 属性带修饰符 (modifier) 的情况
 * @param {*} el 当前 ast 对象
 * @param {*} name v-on 绑定的属性名，即事件名
 * @param {*} value v-on 绑定的属性值，有可能是事件回调函数名字，有可能是内联语句，有可能是函数表达式
 * @param {*} modifiers 修饰符组成的对象
 * @param {*} important 可选参数，是一个布尔值，代表着添加的事件侦听函数的重要级别，如果为 true，则该侦听函数会被添加到该事件侦听函数数组的头部，否则会将其添加到尾部，
 * @param {*} warn 日志
 * @param {*} range
 * @param {*} dynamic 属性名是否为动态属性名
 */
export function addHandler (
  el: ASTElement,
  name: string,
  value: string,
  modifiers: ?ASTModifiers,
  important?: boolean,
  warn?: ?Function,
  range?: Range,
  dynamic?: boolean
) {

  // 如果当前 v-on 没有使用修饰符，则 modifiers 用一个冻结的空对象代替
  modifiers = modifiers || emptyObject

  // warn prevent and passive modifier
  /* istanbul ignore if */
  // passive 修饰符不能和 prevent 修饰符一起使用，这是因为在事件监听中 passive 选项参数就是用来告诉浏览器该事件监听函数是不会阻止默认行为的
  if (
    process.env.NODE_ENV !== 'production' && warn &&
    modifiers.prevent && modifiers.passive
  ) {
    warn(
      'passive and prevent can\'t be used together. ' +
      'Passive handler can\'t prevent default event.',
      range
    )
  }

  // normalize click.right and click.middle since they don't actually fire
  // this is technically browser-specific, but at least for now browsers are
  // the only target envs that have right/middle clicks.
  
  // 标准化 click.right 和 click.middle，它们实际上不会被真正的触发，从技术讲他们是它们
  // 是特定于浏览器的，但至少目前为止只有浏览器才具有右键和中间键的点击

  // 1. 浏览器中点击右键一般会出来一个菜单，这本质上是触发了 contextmenu 事件
  // 2. 鼠标本没有滚轮点击事件，一般我们区分用户点击的按钮是不是滚轮的方式是监听 mouseup 事件，然后通过事件对象的 event.button 属性值来判断，如果 event.button === 1 则说明用户点击的是滚轮按钮

  if (modifiers.right) { // 右键
    if (dynamic) { // 动态属性名，也就是说事件名是动态的
      // 事件名为 click 时， 事件名就为 contextmenu，否则就是 name 本身
      name = `(${name})==='click'?'contextmenu':(${name})`

    } else if (name === 'click') { // 非动态属性名，右键点击的事件名改为 contextmenu
      name = 'contextmenu'
      delete modifiers.right // 删除修饰符中的 right，因为已经标准化为 contextmenu 事件了，就不需要 .right 修饰符了
    }
  } else if (modifiers.middle) { // 中键点击
    if (dynamic) { // 动态属性名，也就是说事件名是动态的，则事件名是 mouseup 或者 name 本身
      name = `(${name})==='click'?'mouseup':(${name})`
    } else if (name === 'click') { // 非动态属性名，中键点击标准化为 mouseup
      name = 'mouseup'
    }
  }

  /**
   * 处理 capture、once、passive 这三个修饰符，通过给 name 添加不同的标记来标记这些修饰符
   */
  // check capture modifier
  if (modifiers.capture) { // 处理 capture 修饰符
    delete modifiers.capture
    // 给带有 capture 修饰符的属性（事件名），加上 ! 标记
    // 例如：@click.capture   !click
    name = prependModifierMarker('!', name, dynamic)
  }
  
  if (modifiers.once) { // 处理 once 修饰符
    delete modifiers.once
    // once 修饰符加 ~ 标记
    // 例如：@click.once  ~click
    name = prependModifierMarker('~', name, dynamic)
  }

  /* istanbul ignore if */
  if (modifiers.passive) {  // 处理 passive 修饰符
    delete modifiers.passive
    // passive 修饰符加 & 标记
    // 例如：@click.passive   &click
    name = prependModifierMarker('&', name, dynamic)
  }

  let events
  // 如果有 native 修饰符，则 el 上添加 nativeEvents；否则添加 events
  if (modifiers.native) {
    delete modifiers.native
    events = el.nativeEvents || (el.nativeEvents = {})
  } else {
    events = el.events || (el.events = {})
  }

  // 新建一个 newHandler 对象
  /**
   * {
   *    value: 绑定的事件的属性值，也就是事件回调函数名字，或者表达式,
   *    dynamic: 事件名是否是动态事件名,
   *    start: start,
   *    end: end,
   *    modifiers: 修饰符对象
   * }
   */
  const newHandler: any = rangeSetItem({ value: value.trim(), dynamic }, range)

  // 如果当前事件用了修饰符，则给 newHandler 对象加上 modifiers 属性
  if (modifiers !== emptyObject) {
    // { value, dynamic, start, end, modifiers }
    newHandler.modifiers = modifiers
  }

  // events 要么是 ast 的 el.nativeEvents 属性的引用，要么就是 ast 的 el.events 属性的引用
  const handlers = events[name]

  /* istanbul ignore if */
  if (Array.isArray(handlers)) { // 如果已经是一个数组了，根据 important 决定加到数组头部还是尾部
    important ? handlers.unshift(newHandler) : handlers.push(newHandler)
  } else if (handlers) { // 如果已经有 name 事件了，就变成一个数组，根据 important 决定顺序
    events[name] = important ? [newHandler, handlers] : [handlers, newHandler]
  } else { // 如果是第一次往其中添加 name 事件，直接就等于处理好的 newHandler
    events[name] = newHandler
  }

  el.plain = false
}

export function getRawBindingAttr (
  el: ASTElement,
  name: string
) {
  return el.rawAttrsMap[':' + name] ||
    el.rawAttrsMap['v-bind:' + name] ||
    el.rawAttrsMap[name]
}

/**
 * 获取 el 对象上绑定属性的值，例如 v-bind: 或其缩写 : 所定义的属性
 */
export function getBindingAttr (
  el: ASTElement,
  name: string,
  getStatic?: boolean
): ?string {
  // 获取指定属性的值
  const dynamicValue =
    getAndRemoveAttr(el, ':' + name) ||
    getAndRemoveAttr(el, 'v-bind:' + name)
  if (dynamicValue != null) {
    // 绑定的属性可以使用过滤器，parseFilters 处理过滤器
    return parseFilters(dynamicValue)
  } else if (getStatic !== false) {
    // dynamicValue 获取失败说明属性值是非绑定的
    const staticValue = getAndRemoveAttr(el, name)
    if (staticValue != null) {
      return JSON.stringify(staticValue)
    }
  }
}

// note: this only removes the attr from the Array (attrsList) so that it
// doesn't get processed by processAttrs.
// By default it does NOT remove it from the map (attrsMap) because the map is
// needed during codegen.
/**
 * 获取给定属性的值，还会将该属性从 el.attrsList 数组中移除，并可以选择性地将该属性从 el.attrsMap 对象中移除
 * 从 el.attrsList 中删除指定的属性 name
 * 如果 removeFromMap 为 true，则同样删除 el.attrsMap 对象中的该属性，
 *   比如 v-if、v-else-if、v-else 等属性就会被移除,
 *   不过一般不会删除该对象上的属性，因为从 ast 生成 代码 期间还需要使用该对象
 * 返回指定属性的值
 */
export function getAndRemoveAttr (
  el: ASTElement,
  name: string,
  removeFromMap?: boolean
): ?string {
  let val
  // 将执行属性 name 从 el.attrsList 中移除
  if ((val = el.attrsMap[name]) != null) {
    const list = el.attrsList
    for (let i = 0, l = list.length; i < l; i++) {
      if (list[i].name === name) {
        list.splice(i, 1)
        break
      }
    }
  }
  // 如果 removeFromMap 为 true，则从 el.attrsMap 中移除指定的属性 name
  // 不过一般不会移除 el.attsMap 中的数据，因为从 ast 生成 代码 期间还需要使用该对象
  if (removeFromMap) {
    delete el.attrsMap[name]
  }
  // 返回执行属性的值
  return val
}

export function getAndRemoveAttrByRegex (
  el: ASTElement,
  name: RegExp
) {
  const list = el.attrsList
  for (let i = 0, l = list.length; i < l; i++) {
    const attr = list[i]
    if (name.test(attr.name)) {
      list.splice(i, 1)
      return attr
    }
  }
}

function rangeSetItem (
  item: any,
  range?: { start?: number, end?: number }
) {
  if (range) {
    if (range.start != null) {
      item.start = range.start
    }
    if (range.end != null) {
      item.end = range.end
    }
  }
  return item
}
