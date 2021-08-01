/* @flow */

import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize, hyphenate } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex
} from '../helpers'

// 匹配以字符 @ 或 v-on: 开头的字符串，主要作用是检测标签属性名是否是监听事件的指令
export const onRE = /^@|^v-on:/

// 匹配以字符 v- 或 @ 或 : 开头的字符串，主要作用是检测标签属性名是否是指令
// # 是 v-slot 缩写
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/

// 该正则包含三个分组，第一个分组为 ([^]*?)，该分组是一个惰性匹配的分组，它匹配的内容为任何字符，包括换行符等。第二个分组为 (?:in|of)，该分组用来匹配字符串 in 或者 of，并且该分组是非捕获的分组。第三个分组为 ([^]*)，与第一个分组类似，不同的是第三个分组是非惰性匹配。同时每个分组之间都会匹配至少一个空白符 \s+。通过以上说明可知，正则 forAliasRE 用来匹配 v-for 属性的值，并捕获 in 或 of 前后的字符串。
// <div v-for="obj of list"></div> 那么正则 forAliasRE 用来匹配字符串 'obj of list'，并捕获到两个字符串 'obj' 和 'list'
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/

// 匹配 forAliasRE 第一个捕获组所捕获到的字符串
// <div v-for="(value, key, index) in object"></div> forIteratorRE 正则的第一个捕获组将捕获到字符串 'key'，但第二个捕获组将捕获到字符串 'index'
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/

// 捕获要么以字符 ( 开头，要么以字符 ) 结尾的字符串
// 用于去掉 v-for 内容中的括号
const stripParensRE = /^\(|\)$/g
const dynamicArgRE = /^\[.*\]$/

// 匹配指令中的参数
const argRE = /:(.*)$/

// 匹配以字符 : 或字符串 v-bind: 开头的字符串，主要用来检测一个标签的属性是否是绑定(v-bind)
export const bindRE = /^:|^\.|^v-bind:/
const propBindRE = /^\./

// 匹配修饰符
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g

// 匹配 v-slot 指令
const slotRE = /^v-slot(:|$)|^#/

// 匹配换行回车
const lineBreakRE = /[\r\n]/

// 匹配空白符
const whitespaceRE = /\s+/g

const invalidAttributeRE = /[\s"'<>\/=]/

// console.log(he.decode('&#x26;'))  // &#x26; -> '&'
// he 为第三方的库，he.decode 函数用于 HTML 字符实体的解码工作
// 将 he.decode 变成可以缓存结果的函数
const decodeHTMLCached = cached(he.decode)

export const emptySlotScopeToken = `_empty_`

// configurable state
export let warn: any
let delimiters
let transforms
let preTransforms
let postTransforms
let platformIsPreTag
let platformMustUseProp
let platformGetTagNamespace
let maybeComponent

/**
 * 为指定元素创建 AST 对象
 * @param {*} tag 标签名
 * @param {*} attrs 属性数组，[{ name: attrName, value: attrVal, start, end }, ...]
 * @param {*} parent 父元素
 * @returns { type: 1, tag, attrsList, attrsMap: makeAttrsMap(attrs), rawAttrsMap: {}, parent, children: []}
 */

/**
 * {
    type: 1, // 节点类型
    tag, // 标签名
    attrsList: attrs, // 标签的属性数组 [{name, value, start, end}...]
    attrsMap: makeAttrsMap(attrs), // 标签的属性对象 { attrName: attrVal, ... }
    rawAttrsMap: {}, // 原始属性对象，和 attrsMap 一样
    parent: el, // 父元素
    children: [], // 子元素
    ns: '', // 命名空间 svg 标签或者 math 标签或者它们两个的子节点标签才会有命名空间
    forbidden: false, // 当前标签是否是被禁止的，例如 script 和 style
    pre: true, // 是否有 v-pre 指令
    plain: true, // 有 v-pre 指令的标签的子节点，如果没有属性，则设置为 plain:true
    processed: true， // 当前标签是否已经被处理过了
    for: 'list'， // v-for 要迭代的那个数据对象，例：v-for="item in list"
    alias: 'item', // v-for 迭代出的每个数据的别名，例：v-for="item in list"
    iterator1: 'key', // v-for 迭代出的键名，例如 v-for="(item, key) in list"
    iterator2: 'index', // v-for 迭代出的索引，例如 v-for="(item, key, index) in list"
    ifConditions: [{exp, block}], // 带有 v-if 指令的元素会拥有 ifConditions，里面存放所有与之相关的条件指令的值和元素对象
    elseif: elseifConditions, // v-else-if 指令的值
    else: true, // 是否有 v-else
    once: true, // 是否有 v-once
    key: '', // key 属性的值
    ref: '', // ref 属性的值
    refInFor: Boolean, // 当前 ref 元素是否在 v-for 循环中
    slotName: '', // 具名插槽的名称
    component: '', // 动态组件 is 属性的值
    inlineTemplate: true, // 组件是否使用了 inline-template 内联模板



    // input 元素类型
    type: 'checkbox'
    // 插槽
    slotTarget: 插槽名，
    slotTargetDynamic: 是否动态插槽,
    slotScope: 作用域插槽的值,
    scopedSlots: {
      name: {
        slotTarget: 插槽名，
        slotTargetDynamic: boolean,
        children: [插槽内所有子元素],
        slotScope: 作用域插槽的值
      }
    }
    // class
    staticClass: className,
    classBinding: className,
    // style
    staticStyle: xxx,
    styleBinding: xxx,
    // 事件
    nativeEvents: {},
    events: {
      name: [{value, dynamic, modifiers, start, end}]
    },
    // props
    props: [{name, value,dynamic, start, end}],
    // attrs
    dynamicAttrs: [],
    attrs: [{name, value, dynamic, start, end}],
    // 其他指令
    directives: [{name,rawName,value,arg,isDynamicArg,modifiers}],

    parent,
  }
 */
export function createASTElement (
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    // 节点类型
    type: 1,
    // 标签名
    tag,
    // 标签的属性数组 [{name, value, start, end}...]
    attrsList: attrs,
    // 标签的属性对象 { attrName: attrVal, ... }
    attrsMap: makeAttrsMap(attrs),
    // 原始属性对象， 和 attrsMap 一样
    rawAttrsMap: {},
    // 父父元素
    parent,
    // 存放所有子元素
    children: []
  }
}

/**
 * Convert HTML string to AST.
 */
/**
 *
 * 将 HTML 字符串转换为 AST
 * @param {*} template HTML 模版
 * @param {*} options 平台特有的编译选项
 * @returns root
 */
export function parse (
  template: string,
  options: CompilerOptions
): ASTElement | void {
  // 打印警告信息
  warn = options.warn || baseWarn

  // 函数，检测是否为 pre 标签
  platformIsPreTag = options.isPreTag || no
  // 函数，检测一个属性在标签中是否要使用元素对象原生的 prop 进行绑定
  platformMustUseProp = options.mustUseProp || no
  // 函数，获取标签的命名空间
  platformGetTagNamespace = options.getTagNamespace || no
  // 函数，是否是保留标签（html + svg)
  const isReservedTag = options.isReservedTag || no
  // 函数，判断一个元素是否为一个组件
  maybeComponent = (el: ASTElement) => !!el.component || !isReservedTag(el.tag)

  // 分别获取 options.modules 下的 class、model、style 三个模块中的 transformNode、preTransformNode、postTransformNode 方法
  // 负责处理元素节点上的 class、style、v-model
  transforms = pluckModuleFunction(options.modules, 'transformNode') // 中置处理
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode') // 前置处理
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode') // 后置处理

  // 界定符，比如: {{}}
  delimiters = options.delimiters

  // 解析的中间结果放这里，ast对象，用来修正当前正在解析元素的父级
  const stack = []
  // 是否放弃标签之间的空格
  const preserveWhitespace = options.preserveWhitespace !== false
  const whitespaceOption = options.whitespace

  // 根节点，以 root 为根，处理后的节点都会按照层级挂载到 root 下，最后 return 的就是 root，一个 ast 语法树
  let root
  // 当前元素的父元素
  let currentParent
  // 当前解析的标签是否在拥有 v-pre 的标签之内
  let inVPre = false
  // 当前正在解析的标签是否在 <pre></pre> 标签之内
  let inPre = false
  let warned = false

  function warnOnce (msg, range) {
    if (!warned) {
      warned = true
      warn(msg, range)
    }
  }
/**
 * 主要做了 3 件事：
 *   1、如果元素没有被处理过，即 el.processed 为 false，则调用 processElement 方法处理节点上的众多属性
 *   2、让自己和父元素产生关系，将自己放到父元素的 children 数组中，并设置自己的 parent 属性为 currentParent
 *   3、设置自己的子元素，将自己所有非插槽的子元素放到自己的 children 数组中
 */
  function closeElement (element) {
    // 移除节点末尾的空格，当前 pre 标签内的元素除外
    trimEndingWhitespace(element)

    // 当前元素不在 v-pre 节点内部，并且也没有被处理过
    if (!inVPre && !element.processed) {
      // 分别处理元素节点的 key、ref、插槽、自闭合的 slot 标签、动态组件、class、style、v-bind、v-on、其它指令和一些原生属性
      // processElement 是一系列 process* 函数集合
      element = processElement(element, options)
    }
    // 处理根节点上存在 v-if、v-else-if、v-else 指令的情况
    // 如果根节点存在 v-if 指令，则必须还提供一个具有 v-else-if 或者 v-else 的同级别节点，防止根元素不存在
    // tree management
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      if (root.if && (element.elseif || element.else)) {
        if (process.env.NODE_ENV !== 'production') {
          // 检查根元素
          checkRootConstraints(element)
        }
        // 给根元素设置 ifConditions 属性，root.ifConditions = [{ exp: element.elseif, block: element }, ...]
        addIfCondition(root, {
          exp: element.elseif,
          block: element
        })
      } else if (process.env.NODE_ENV !== 'production') {
        // 提示，表示不应该在 根元素 上只使用 v-if，应该将 v-if、v-else-if 一起使用，保证组件只有一个根元素
        warnOnce(
          `Component template should contain exactly one root element. ` +
          `If you are using v-if on multiple elements, ` +
          `use v-else-if to chain them instead.`,
          { start: element.start }
        )
      }
    }
    // 让自己和父元素产生关系
    // 将自己放到父元素的 children 数组中，然后设置自己的 parent 属性为 currentParent
    if (currentParent && !element.forbidden) {
      if (element.elseif || element.else) {
        processIfConditions(element, currentParent)
      } else {
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          // 如果一个元素使用了 slot-scope 特性，那么该元素的描述对象会被添加到父级元素的 scopedSlots 对象下，不会作为父级元素的子节点
          const name = element.slotTarget || '"default"'
          ;(currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        }
        // 将元素自己放入父元素中，children数组
        currentParent.children.push(element)
        // 在自己身上记录 parent 属性，标记自己的父元素是谁
        element.parent = currentParent
      }
    }

    // final children cleanup
    // filter out scoped slots
    // 设置自己的子元素
    // 将自己的所有非插槽的子元素设置到 element.children 数组中
    element.children = element.children.filter(c => !(c: any).slotScope)
    // remove trailing whitespace node again
    trimEndingWhitespace(element)

    // check pre state
    if (element.pre) {
      inVPre = false
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    // 分别为 element 执行 model、class、style 三个模块的 postTransform 方法
    // 但是 web 平台没有提供该方法
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options)
    }
  }

/**
 * 删除元素中空白的文本节点，比如：<div> </div>，删除 div 元素中的空白节点，将其从元素的 children 属性中移出去
 */
  function trimEndingWhitespace (el) {
    // remove trailing whitespace node
    if (!inPre) {
      let lastNode
      while (
        (lastNode = el.children[el.children.length - 1]) &&
        lastNode.type === 3 &&
        lastNode.text === ' '
      ) {
        el.children.pop()
      }
    }
  }
/**
 * 检查根元素：
 *   不能使用 slot 和 template 标签作为组件的根元素
 *   不能在有状态组件的 根元素 上使用 v-for 指令，因为它会渲染出多个元素
 * @param {*} el
 */
  // 首先模板必须有且仅有一个被渲染的根元素，第二不能使用 slot 标签和 template 标签作为模板的根元素。对于第二点为什么不能使用 slot 和 template 标签作为模板根元素，这是因为 slot 作为插槽，它的内容是由外界决定的，而插槽的内容很有可能渲染多个节点，template 元素的内容虽然不是由外界决定的，但它本身作为抽象组件是不会渲染任何内容到页面的，而其又可能包含多个子节点，所以也不允许使用 template 标签作为根节点。

  function checkRootConstraints (el) {
    // 不能使用 slot 和 template 标签作为组件的根元素
    if (el.tag === 'slot' || el.tag === 'template') {
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
        'contain multiple nodes.',
        { start: el.start }
      )
    }
    // 不能在有状态组件的 根元素 上使用 v-for，因为它会渲染出多个元素
    if (el.attrsMap.hasOwnProperty('v-for')) {
      warnOnce(
        'Cannot use v-for on stateful component root element because ' +
        'it renders multiple elements.',
        el.rawAttrsMap['v-for']
      )
    }
  }

  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    // 是否是自闭合标签
    isUnaryTag: options.isUnaryTag,
    // 是否可以只有开始标签
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,



/**
 *  1、start 钩子函数是当解析 html 字符串遇到开始标签时被调用的。
    2、模板中禁止使用 <style> 标签和那些没有指定 type 属性或 type 属性值为 text/javascript 的 <script> 标签。
    3、在 start 钩子函数中会调用前置处理函数，这些前置处理函数都放在 preTransforms 数组中，这么做的目的是为不同平台提供对应平台下的解析工作。
    4、前置处理函数执行完之后会调用一系列 process* 函数继续对元素描述对象进行加工。
    5、通过判断 root 是否存在来判断当前解析的元素是否为根元素。
    6、slot 标签和 template 标签不能作为根元素，并且根元素不能使用 v-for 指令。
    7、可以定义多个根元素，但必须使用 v-if、v-else-if 以及 v-else 保证有且仅有一个根元素被渲染。
    8、构建 AST 并建立父子级关系是在 start 钩子函数中完成的，每当遇到非一元标签，会把它存到 currentParent 变量中，当解析该标签的子节点时通过访问 currentParent 变量获取父级元素。
    9、如果一个元素使用了 v-else-if 或 v-else 指令，则该元素不会作为子节点，而是会被添加到相符的使用了 v-if 指令的元素描述对象的 ifConditions 数组中。
    10、如果一个元素使用了 slot-scope 特性，则该元素也不会作为子节点，它会被添加到父级元素描述对象的 scopedSlots 属性中。
    11、对于没有使用条件指令或 slot-scope 特性的元素，会正常建立父子级关系。
 */

/**
 * 主要做了以下 6 件事情:
 *   1、创建 AST 对象
 *   2、处理存在 v-model 指令的 input 标签，分别处理 input 为 checkbox、radio、其它的情况
 *   3、处理标签上的众多指令，比如 v-pre、v-for、v-if、v-once
 *   4、如果根节点 root 不存在则设置当前元素为根节点
 *   5、如果当前元素为非自闭合标签则将自己 push 到 stack 数组，并记录 currentParent，在接下来处理子元素时用来告诉子元素自己的父节点是谁
 *   6、如果当前元素为自闭合标签，则表示该标签要处理结束了，让自己和父元素产生关系，以及设置自己的子元素
 * @param {*} tag 标签名
 * @param {*} attrs [{ name: attrName, value: attrVal, start, end }, ...] 形式的属性数组
 * @param {*} unary 自闭合标签
 * @param {*} start 标签在 html 字符串中的开始索引
 * @param {*} end 标签在 html 字符串中的结束索引
 */
    start (tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      // 检查命名空间，如果存在，则继承父命名空间
      // 如果当前元素存在父级并且父级元素存在命名空间，则使用父级的命名空间作为当前元素的命名空间。如果父级元素不存在或父级元素没有命名空间，那么会通过调用 platformGetTagNamespace(tag) 函数获取当前元素的命名空间
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      /**
       * ie 11 中 <svg xmlns:feature="http://www.openplans.org/topp"></svg> 会被渲染成：
       * <svg xmlns:NS1="" NS1:xmlns:feature="http://www.openplans.org/topp"></svg>
       * 这里 guardIESVGBug 去除 xmlns:NS1="" ，并将 NS1:xmlns:feature 修改为 xmlns:feature
       */
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }

      // 创建当前标签的 AST 对象
      let element: ASTElement = createASTElement(tag, attrs, currentParent)


      // 设置命名空间
      // 如果当前解析的开始标签为 svg 标签或者 math 标签或者它们两个的子节点标签，都将会比其他 html 标签的元素描述对象多出一个 ns 属性，且该属性标识了该标签的命名空间。
      if (ns) {
        element.ns = ns
      }

      // 这段在非生产环境下会走，在 ast 对象上添加 一些 属性，比如 start、end
      if (process.env.NODE_ENV !== 'production') {
        if (options.outputSourceRange) {
          element.start = start
          element.end = end
          // 将属性数组解析成 { attrName: { name: attrName, value: attrVal, start, end }, ... } 形式的对象
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr
            return cumulated
          }, {})
        }
        // 验证属性是否有效，比如属性名不能包含: spaces, quotes, <, >, / or =.
        attrs.forEach(attr => {
          if (invalidAttributeRE.test(attr.name)) {
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
              `spaces, quotes, <, >, / or =.`,
              {
                start: attr.start + attr.name.indexOf(`[`),
                end: attr.start + attr.name.length
              }
            )
          }
        })
      }

      // 非服务端渲染的情况下，模版中不应该出现 style、script 标签
      if (isForbiddenTag(element) && !isServerRendering()) {
        element.forbidden = true
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.',
          { start: element.start }
        )
      }

      // apply pre-transforms

  /**
   * 为 element 对象分别执行 class、style、model 模块中的 preTransforms 方法
   * 不过 web 平台只有 model 模块有 preTransforms 方法
   * 用来处理存在 v-model 的 input 标签，但没处理 v-model 属性
   * 将 <input v-model="data[type]" :type="type"> 变成三个标签，因为 type 属性是动态绑定的，所以在编译阶段将其变成区分开类型的三个标签，职责更加具体
   *
   * <input v-if="type === 'checkbox'" type="checkbox" v-model="data[type]">
   * <input v-else-if="type === 'radio'" type="radio" v-model="data[type]">
   * <input v-else :type="type" v-model="data[type]">
   *
   * 分别处理了 input 为 checkbox、radio 和 其它的情况
   * input 具体是哪种情况由 el.ifConditions 中的条件来判断
   * <input v-mode="test" :type="checkbox or radio or other(比如 text)" />
   */
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element
      }

      if (!inVPre) {
        // 表示 element 是否存在 v-pre 指令，存在则设置 element.pre = true
        processPre(element)
        // 存在 v-pre 指令，则设置 inVPre 为 true
        if (element.pre) {
          inVPre = true
        }
      }

      // <pre> 标签的解析和 html 解析不同
      // 1、<pre> 标签会对其所包含的 html 字符实体进行解码
      // 2、<pre> 标签会保留 html 字符串编写时的空白
      // 如果当前处理标签是 pre 标签，则设置 inPre 为 true
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }

      if (inVPre) {
      // 说明标签上存在 v-pre 指令，这样的节点只会渲染一次，将节点上的属性都设置到 el.attrs 数组对象中，作为静态属性，数据更新时不会渲染这部分内容

      /**
       *  1、如果标签使用了 v-pre 指令，则该标签的元素描述对象的 element.pre 属性将为 true。
          2、对于使用了 v-pre 指令的标签及其子代标签，它们的任何属性都将会被作为原始属性处理，即使用 processRawAttrs 函数处理之。
          3、经过 processRawAttrs 函数的处理，会在元素的描述对象上添加 element.attrs 属性，它与 element.attrsList 数组结构相同，不同的是 element.attrs 数组中每个对象的 value 值会经过 JSON.stringify 函数处理。
          4、如果一个标签没有任何属性，并且该标签是使用了 v-pre 指令标签的子代标签，那么该标签的元素描述对象将被添加 element.plain 属性，并且其值为 true。
       */

        processRawAttrs(element)
      } else if (!element.processed) {
        // v-for、v-if/v-else-if/v-else、v-once 等指令会被认为是结构化的指令(structural directives)。这些指令在经过 processFor、processIf 以及 processOnce 等函数处理之后，会把这些指令从元素描述对象的 attrsList 数组中移除

        // structural directives
        // 处理 v-for 属性，得到 element.for = 可迭代对象 element.alias = 别名
        processFor(element)
        /**
       * 处理 v-if、v-else-if、v-else
       * 得到 element.if = "exp"，element.elseif = exp, element.else = true
       * v-if 属性会额外在 element.ifConditions 数组中添加 { exp, block } 对象
       */
        processIf(element)
        // 处理 v-once 指令，得到 element.once = true
        processOnce(element)
      }

      // 如果 root 不存在，则表示当前处理的元素为第一个元素，即组件的 根 元素
      if (!root) {
        root = element
        if (process.env.NODE_ENV !== 'production') {
          // 检查根元素，对根元素有一些限制，比如：不能使用 slot 和 template 作为根元素，也不能在有状态组件的根元素上使用 v-for 指令。这些限制都是为了保证根元素只能有一个节点，而不是多个节点
          checkRootConstraints(root)
        }
      }

      if (!unary) {
        // 每当遇到一个非一元标签都会将该元素的描述对象添加到 stack 数组，并且 currentParent 始终存储的是 stack 栈顶的元素，即当前解析元素的父级
        currentParent = element

        // 然后将 element push 到 stack 数组，将来处理到当前元素的闭合标签时再拿出来
        // 将当前标签的 ast 对象 push 到 stack 数组中，这里需要注意，在调用 options.start 方法
        // 之前也发生过一次 push 操作，那个 push 进来的是当前标签的一个基本配置信息

        stack.push(element)
      } else {
        /**
         * 说明当前元素为自闭合标签，主要做了 3 件事：
         *   1、如果元素没有被处理过，即 el.processed 为 false，则调用 processElement 方法处理节点上的众多属性
         *   2、让自己和父元素产生关系，将自己放到父元素的 children 数组中，并设置自己的 parent 属性为 currentParent
         *   3、设置自己的子元素，将自己所有非插槽的子元素放到自己的 children 数组中
         */
        closeElement(element)
      }
    },

    end (tag, start, end) {
      const element = stack[stack.length - 1]
      // pop stack
      stack.length -= 1
      currentParent = stack[stack.length - 1]
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        element.end = end
      }
      closeElement(element)
    },
    // 处理文本节点
    chars (text: string, start: number, end: number) {
      if (!currentParent) {
        if (process.env.NODE_ENV !== 'production') {
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.',
              { start }
            )
          } else if ((text = text.trim())) {
            warnOnce(
              `text "${text}" outside root element will be ignored.`,
              { start }
            )
          }
        }
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      const children = currentParent.children
      if (inPre || text.trim()) {
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text)
      } else if (!children.length) {
        // remove the whitespace-only node right after an opening tag
        text = ''
      } else if (whitespaceOption) {
        if (whitespaceOption === 'condense') {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          text = lineBreakRE.test(text) ? '' : ' '
        } else {
          text = ' '
        }
      } else {
        text = preserveWhitespace ? ' ' : ''
      }
      if (text) {
        if (!inPre && whitespaceOption === 'condense') {
          // condense consecutive whitespaces into single space
          text = text.replace(whitespaceRE, ' ')
        }
        let res
        let child: ?ASTNode
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          child = {
            type: 2,
            expression: res.expression,
            tokens: res.tokens,
            text
          }
        } else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
          child = {
            type: 3,
            text
          }
        }
        if (child) {
          if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
            child.start = start
            child.end = end
          }
          children.push(child)
        }
      }
    },
    /**
     * 处理注释节点，把注释节点变成 ast
     */
    comment (text: string, start, end) {
      // adding anyting as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored

      // 禁止将任何内容作为 root 的节点的同级进行添加，注释应该被允许，但是会被忽略
      // 如果 currentParent 不存在，说明注释和 root 为同级，忽略
      if (currentParent) {
        // 注释节点的 ast
        const child: ASTText = {
          // 节点类型
          type: 3,
          // 注释内容
          text,
          // 是否为注释
          isComment: true
        }
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          // 记录节点的开始索引和结束索引
          child.start = start
          child.end = end
        }
        // 将当前注释节点放到父元素的 children 属性中
        currentParent.children.push(child)
      }
    }
  })
  // 返回生成的 ast 对象
  return root
}
/**
 * 如果元素上存在 v-pre 指令，则设置 el.pre = true
 */
function processPre (el) {
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}
/**
 * 当标签中存在 v-pre 指令时用 processRawAttrs 将属性作为原生属性处理存入 el.attrs 数组
 * 设置 el.attrs 数组对象，每个元素都是一个属性对象 { name: attrName, value: attrVal, start, end }
 * el.attrs 和 el.attrsList 的区别，el.attrs 中每个属性的值都是 JSON.stringify 处理过的
 */
function processRawAttrs (el) {
  const list = el.attrsList
  const len = list.length
  if (len) {
    const attrs: Array<ASTAttr> = el.attrs = new Array(len)
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        value: JSON.stringify(list[i].value)
      }
      if (list[i].start != null) {
        attrs[i].start = list[i].start
        attrs[i].end = list[i].end
      }
    }
  } else if (!el.pre) {
    // 当前标签没有使用 v-pre，且没有属性。说明当前标签是使用了 v-pre 的标签的子节点
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}

/**
 * process* 函数的集合
 * 分别处理元素节点的 key、ref、插槽、自闭合的 slot 标签、动态组件、class、style、v-bind、v-on、其它指令和一些原生属性
 * 然后在 el 对象上添加如下属性：
 * el.key、ref、refInFor、scopedSlot、slotName、component、inlineTemplate、staticClass
 * el.bindingClass、staticStyle、bindingStyle、attrs
 * @param {*} element 被处理元素的 ast 对象
 * @param {*} options 配置项
 * @returns
 */
export function processElement (
  element: ASTElement,
  options: CompilerOptions
) {
  // el.key = val
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  // v-for、v-if/v-else-if/v-else、v-once 等指令会被认为是结构化的指令(structural directives)。这些指令在经过 processFor、processIf 以及 processOnce 等函数处理之后，会把这些指令从元素描述对象的 attrsList 数组中移除
  // 结构化指令处理后判断这个元素是否是一个普通的纯元素
  // 确定 element 是否为一个普通元素
  element.plain = (
    !element.key &&
    !element.scopedSlots &&
    !element.attrsList.length
  )

  // el.ref = val, el.refInFor = boolean
  processRef(element)
  // 处理作为插槽传递给组件的内容，得到  插槽名称、是否为动态插槽、作用域插槽的值，以及插槽中的所有子元素，子元素放到插槽对象的 children 属性中
  processSlotContent(element)
  // 处理自闭合的 slot 标签，得到插槽名称 => el.slotName = xx
  processSlotOutlet(element)
  // 处理动态组件，<component :is="compoName"></component>得到 el.component = compName，
  // 以及标记是否存在内联模版，el.inlineTemplate = true of false
  processComponent(element)
  // 为 element 对象分别执行 class、style、model 模块中的 transformNode 方法
  // 不过 web 平台只有 class、style 模块有 transformNode 方法，分别用来处理 class 属性和 style 属性
  // 得到 el.staticStyle、 el.styleBinding、el.staticClass、el.classBinding
  // 分别存放静态 style 属性的值、动态 style 属性的值，以及静态 class 属性的值和动态 class 属性的值
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element
  }
  /**
   * 处理元素上剩余还没处理的属性：
   * v-bind 指令变成：el.attrs 或 el.dynamicAttrs = [{ name, value, start, end, dynamic }, ...]，
   *                或者是必须使用 props 的属性，变成了 el.props = [{ name, value, start, end, dynamic }, ...]
   * v-on 指令变成：el.events 或 el.nativeEvents = { name: [{ value, start, end, modifiers, dynamic }, ...] }
   * 其它指令：el.directives = [{name, rawName, value, arg, isDynamicArg, modifier, start, end }, ...]
   * 原生属性：el.attrs = [{ name, value, start, end }]
   * 或者一些必须使用 props 的属性，变成了：el.props = [{ name, value: true, start, end, dynamic }]
   */
  processAttrs(element)
  return element
}

/**
 * 1. <div key="id"></div>   el.key = JSON.stringify('id')
 * 2. <div :key="id"></div>  el.key = 'id'
 * 3. <div :key="id | featId"></div>  el.key = '_f("featId")(id)'
 * 以上就是 key 的所有可能的值
 * 
 * 1、key 属性不能被应用到 <template> 标签。
   2、使用了 key 属性的标签，其元素描述对象的 el.key 属性保存着 key 属性的值。
 * 处理元素上的 key 属性，设置 el.key = val
 * @param {*} el
 */
function processKey (el) {
  // 拿到 key 的属性值
  const exp = getBindingAttr(el, 'key')
  if (exp) {
    // 关于 key 使用上的异常处理
    if (process.env.NODE_ENV !== 'production') {
      // template 标签不允许设置 key
      if (el.tag === 'template') {
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, 'key')
        )
      }
      // 不要在 <transition-group> 的子元素上使用 v-for 的 index 作为 key，这和没用 key 没什么区别
      if (el.for) {
        const iterator = el.iterator2 || el.iterator1
        const parent = el.parent
        if (iterator && iterator === exp && parent && parent.tag === 'transition-group') {
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
            `this is the same as not using keys.`,
            getRawBindingAttr(el, 'key'),
            true /* tip */
          )
        }
      }
    }
    // 设置 el.key = exp
    el.key = exp
  }
}

/**
 * 处理元素上的 ref 属性
 *  el.ref = refVal
 *  el.refInFor = boolean
 * @param {*} el
 */
function processRef (el) {
  const ref = getBindingAttr(el, 'ref')
  if (ref) {
    el.ref = ref
    // 判断包含 ref 属性的元素是否包含在具有 v-for 指令的元素内或后代元素中
    // 如果是，则 ref 指向的则是包含 DOM 节点或组件实例的数组
    el.refInFor = checkInFor(el)
  }
}

/**
 * 处理 v-for，将结果设置到 el 对象上，得到:
    for: 'list'， // v-for 要迭代的那个数据对象，例：v-for="item in list"
    alias: 'item', // v-for 迭代出的每个数据的别名，例：v-for="item in list"
    iterator1: 'key', // v-for 迭代出的键名，例如 v-for="(item, key) in list"
    iterator2: 'index' // v-for 迭代出的索引，例如 v-for="(item, key, index) in list"
 * @param {*} el 元素的 ast 对象
 */
export function processFor (el: ASTElement) {
  let exp
  // 获取 el 上的 v-for 属性的值
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    // 解析 v-for 的表达式，得到 { for: 可迭代对象， alias: 别名 }，比如 { for: arr, alias: item }
    const res = parseFor(exp)
    if (res) {
      // 将 res 对象上的属性拷贝到 el 对象上
      extend(el, res)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`,
        el.rawAttrsMap['v-for']
      )
    }
  }
}

type ForParseResult = {
  for: string;
  alias: string;
  iterator1?: string;
  iterator2?: string;
};

/**
 *  1、如果 v-for 指令的值为字符串 'obj in list'，则 parseFor 函数的返回值为：
    {
      for: 'list',
      alias: 'obj'
    }

    2、如果 v-for 指令的值为字符串 '(obj, index) in list'，则 parseFor 函数的返回值为：
    {
      for: 'list',
      alias: 'obj',
      iterator1: 'index'
    }

    3、如果 v-for 指令的值为字符串 '(obj, key, index) in list'，则 parseFor 函数的返回值为：
    {
      for: 'list',
      alias: 'obj',
      iterator1: 'key',
      iterator2: 'index'
    }
 */
// 解析 v-for 指令的值，得到 res = { for: iterator, allias: 别名}
export function parseFor (exp: string): ?ForParseResult {
  // 'obj in list'
  // 则匹配结果为
  // [ 'obj in list', 'obj', 'list']
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res = {}
  // for = 迭代对象
  res.for = inMatch[2].trim()
  // stripParensRE 用于去掉左右空格
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    res.alias = alias.replace(forIteratorRE, '').trim()
    res.iterator1 = iteratorMatch[1].trim()
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    res.alias = alias
  }
  return res
}


/**
 *  1、如果标签使用了 v-if 指令，则该标签的元素描述对象的 el.if 属性存储着 v-if 指令的属性值
    2、如果标签使用了 v-else 指令，则该标签的元素描述对象的 el.else 属性值为 true
    3、如果标签使用了 v-else-if 指令，则该标签的元素描述对象的 el.elseif 属性存储着 v-else-if 指令的属性值
    4、如果标签使用了 v-if 指令，则该标签的元素描述对象的 ifConditions 数组中包含“自己”
    5、如果标签使用了 v-else 或 v-else-if 指令，则该标签的元素描述对象会被添加到与之相符的带有 v-if 指令的元素描述对象的 ifConditions 数组中。
 */
/**
 * 处理 v-if、v-else-if、v-else
 * 得到 el.if = "exp"，el.elseif = exp, el.else = true
 * v-if 属性会额外在 el.ifConditions 数组中添加 { exp, block } 对象
 */
function processIf (el) {
  // 获取 v-if 属性的值，比如 <div v-if="test"></div>
  const exp = getAndRemoveAttr(el, 'v-if')
  if (exp) {
    // el.if = "test"
    el.if = exp
    // 在 el.ifConditions 数组中添加 { exp, block }
    addIfCondition(el, {
      exp: exp,
      block: el
    })
  } else {
    // 处理 v-else，得到 el.else = true
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    // 处理 v-else-if，得到 el.elseif = exp
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif
    }
  }
}

// 当一个元素使用了 v-else-if 或 v-else 指令时，它们是不会作为父级元素子节点的，而是会被添加到相符的使用了 v-if 指令的元素描述对象的 ifConditions 数组中
// 找到使用 v-else-if 和 v-else 元素 el 的前面的 v-if 元素，然后将条件加入到 v-if 元素的 ifConditions 中
function processIfConditions (el, parent) {
  // 找到 parent.children 中的相对于当前 el 的前一个元素
  const prev = findPrevElement(parent.children)
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? 'v-else-if' : 'v-else']
    )
  }
}
/**
 * 找到 children 中的前一个元素
 */
function findPrevElement (children: Array<any>): ASTElement | void {
  let i = children.length
  while (i--) {
    if (children[i].type === 1) {
      return children[i]
    } else {
      if (process.env.NODE_ENV !== 'production' && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`,
          children[i]
        )
      }
      children.pop()
    }
  }
}
/**
 * 将传递进来的条件对象放进 el.ifConditions 数组中
 */
/**
 * <div v-if="a"></div>
   <p v-else-if="b"></p>
   <span v-else></span>

   被 addIfCondition 处理后会变成：

    {
      type: 1,
      tag: 'div',
      ifConditions: [
        {
          exp: 'a',
          block: { type: 1, tag: 'div'}
        },
        {
          exp: 'b',
          block: { type: 1, tag: 'p' }
        },
        {
          exp: undefined,
          block: { type: 1, tag: 'span'}
        }
      ]
    }
 */
export function addIfCondition (el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  el.ifConditions.push(condition)
}
/**
 * 处理 v-once 指令，得到 el.once = true
 * @param {*} el
 */
function processOnce (el) {
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
/**
 * 处理作为插槽传递给组件的内容，得到：
 *  slotTarget => 插槽名
 *  slotTargetDynamic => 是否为动态插槽
 *  slotScope => 作用域插槽的值
 *  直接在 <comp> 标签上使用 v-slot 语法时，将上述属性放到 el.scopedSlots 对象上，其它情况直接放到 el 对象上
 */
function processSlotContent (el) {
  let slotScope
  if (el.tag === 'template') {
    // template 标签上使用 scope 属性的提示
    // scope 已经弃用，并在 2.5 之后使用 slot-scope 代替
    // slot-scope 即可以用在 template 标签也可以用在普通标签上
    slotScope = getAndRemoveAttr(el, 'scope')
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && slotScope) {
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
        `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
        `can also be used on plain elements in addition to <template> to ` +
        `denote scoped slots.`,
        el.rawAttrsMap['scope'],
        true
      )
    }
    // el.slotScope = val
    el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
  } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
      // 元素不能同时使用 slot-scope 和 v-for，v-for 具有更高的优先级
      // 应该用 template 标签作为容器，将 slot-scope 放到 template 标签上
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
        `(v-for takes higher priority). Use a wrapper <template> for the ` +
        `scoped slot to make it clearer.`,
        el.rawAttrsMap['slot-scope'],
        true
      )
    }
    el.slotScope = slotScope
  }

  // 获取 slot 属性的值
  // slot="xxx"，老旧的具名插槽的写法
  // slot="xxx"
  const slotTarget = getBindingAttr(el, 'slot')
  if (slotTarget) {
    // el.slotTarget = 插槽名（具名插槽）
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
    // 动态插槽名
    el.slotTargetDynamic = !!(el.attrsMap[':slot'] || el.attrsMap['v-bind:slot'])
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    if (el.tag !== 'template' && !el.slotScope) {
      addAttr(el, 'slot', slotTarget, getRawBindingAttr(el, 'slot'))
    }
  }

  // 2.6 v-slot syntax
  if (process.env.NEW_SLOT_SYNTAX) {
    if (el.tag === 'template') {
      // v-slot on <template>
      // v-slot 在 tempalte 标签上，得到 v-slot 的值
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        // 异常提示
        if (process.env.NODE_ENV !== 'production') {
          if (el.slotTarget || el.slotScope) {
            // 不同插槽语法禁止混合使用
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          if (el.parent && !maybeComponent(el.parent)) {
            // <template v-slot> 只能出现在组件的根位置，比如：
            // <comp>
            //   <template v-slot>xx</template>
            // </comp>
            // 而不能是
            // <comp>
            //   <div>
            //     <template v-slot>xxx</template>
            //   </div>
            // </comp>
            warn(
              `<template v-slot> can only appear at the root level inside ` +
              `the receiving component`,
              el
            )
          }
        }
        // 得到插槽名称
        const { name, dynamic } = getSlotName(slotBinding)
        // 插槽名
        el.slotTarget = name
        // 是否为动态插槽
        el.slotTargetDynamic = dynamic
        // 作用域插槽的值
        el.slotScope = slotBinding.value || emptySlotScopeToken // force it into a scoped slot for perf
      }
    } else {
      // v-slot on component, denotes default slot
      // 处理组件上的 v-slot，<comp v-slot:header />
      // slotBinding = { name: "v-slot:header", value: "", start, end}
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        // 异常提示
        if (process.env.NODE_ENV !== 'production') {
          // el 不是组件的话，提示，v-slot 只能出现在组件上或 template 标签上
          if (!maybeComponent(el)) {
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            )
          }
          // 语法混用
          if (el.slotScope || el.slotTarget) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          // 为了避免作用域歧义，当存在其他命名槽时，默认槽也应该使用<template>语法
          if (el.scopedSlots) {
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
              `<template> syntax when there are other named slots.`,
              slotBinding
            )
          }
        }
        // add the component's children to its default slot
        // 将组件的孩子添加到它的默认插槽内
        const slots = el.scopedSlots || (el.scopedSlots = {})
        // 获取插槽名称以及是否为动态插槽
        const { name, dynamic } = getSlotName(slotBinding)
        // 创建一个 template 标签的 ast 对象，用于容纳插槽内容，父级是 el
        const slotContainer = slots[name] = createASTElement('template', [], el)
        // 插槽名
        slotContainer.slotTarget = name
        // 是否为动态插槽
        slotContainer.slotTargetDynamic = dynamic
        // 所有的孩子，将每一个孩子的 parent 属性都设置为 slotContainer
        slotContainer.children = el.children.filter((c: any) => {
          if (!c.slotScope) {
            // 给插槽内元素设置 parent 属性为 slotContainer，也就是 template 元素
            c.parent = slotContainer
            return true
          }
        })
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken
        // remove children as they are returned from scopedSlots now
        el.children = []
        // mark el non-plain so data gets generated
        el.plain = false
      }
    }
  }
}

/**
 * 解析 binding，得到插槽名称以及是否为动态插槽
 * @returns { name: 插槽名称, dynamic: 是否为动态插槽 }
 */
function getSlotName (binding) {
  let name = binding.name.replace(slotRE, '')
  if (!name) {
    if (binding.name[0] !== '#') {
      name = 'default'
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `v-slot shorthand syntax requires a slot name.`,
        binding
      )
    }
  }
  return dynamicArgRE.test(name)
    // dynamic [name]
    ? { name: name.slice(1, -1), dynamic: true }
    // static name
    : { name: `"${name}"`, dynamic: false }
}

// handle <slot/> outlets处理自闭合 slot 标签
// <slot name="header"></slot>
// 得到插槽名称，el.slotName
function processSlotOutlet (el) {
  if (el.tag === 'slot') {
    // 得到插槽名称
    el.slotName = getBindingAttr(el, 'name')
    // 提示信息，不要在 slot 标签上使用 key 属性
    if (process.env.NODE_ENV !== 'production' && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, 'key')
      )
    }
  }
}

/**
 * 1. <div is></div>   el.component = ''
 * 2. <div is="child"></div>    el.component = JSON.stringify('child')
 * 3. <div :is="child"></div>    el.component = 'child'
 * 
 * 
 * 处理动态组件，<component :is="compName"></component>
 * 得到 el.component = compName
 */
function  processComponent (el) {
  let binding
  // 解析 is 属性，得到属性值，即组件名称，el.component = compName
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }

  // <component :is="compName" inline-template>xx</component>
  // 组件上存在 inline-template 属性，进行标记：el.inlineTemplate = true
  // 表示组件开始和结束标签内的内容作为组件模版出现，而不是作为插槽别分发，方便定义组件模版
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

/**
 * 处理元素上的所有属性：
 * v-bind 指令变成：el.attrs 或 el.dynamicAttrs = [{ name, value, start, end, dynamic }, ...]，
 *                或者是必须使用 props 的属性，变成了 el.props = [{ name, value, start, end, dynamic }, ...]
 * v-on 指令变成：el.events 或 el.nativeEvents = { name: [{ value, start, end, modifiers, dynamic }, ...] }
 * 其它指令：el.directives = [{name, rawName, value, arg, isDynamicArg, modifier, start, end }, ...]
 * 原生属性：el.attrs = [{ name, value, start, end }]，或者一些必须使用 props 的属性，变成了：
 *         el.props = [{ name, value: true, start, end, dynamic }]
 */
function processAttrs (el) {
  // list = [{ name, value, start, end }, ...]
  const list = el.attrsList
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic
  for (i = 0, l = list.length; i < l; i++) {
    // 属性名
    name = rawName = list[i].name
    // 属性值
    value = list[i].value
    if (dirRE.test(name)) {
      // 说明该属性是一个指令

      // 元素上存在指令，将元素标记动态元素
      // mark element as dynamic
      el.hasBindings = true
      // modifiers，在属性名上解析修饰符，比如 xx.lazy
      modifiers = parseModifiers(name.replace(dirRE, ''))
      // support .foo shorthand syntax for the .prop modifier
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        // 为 .props 修饰符支持 .foo 速记写法
        (modifiers || (modifiers = {})).prop = true
        name = `.` + name.slice(1).replace(modifierRE, '')
      } else if (modifiers) {
        // 属性中的修饰符去掉，得到一个干净的属性名
        name = name.replace(modifierRE, '')
      }
      if (bindRE.test(name)) { // v-bind, <div :id="test"></div>
        // 处理 v-bind 指令属性，最后得到 el.attrs 或者 el.dynamicAttrs = [{ name, value, start, end, dynamic }, ...]

        // 属性名，比如：id
        name = name.replace(bindRE, '')
        // 属性值，比如：test
        value = parseFilters(value)
        // 是否为动态属性 <div :[id]="test"></div>
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          // 如果是动态属性，则去掉属性两侧的方括号 []
          name = name.slice(1, -1)
        }
        // 提示，动态属性值不能为空字符串
        if (
          process.env.NODE_ENV !== 'production' &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          )
        }

        // 存在修饰符
        if (modifiers) {
          if (modifiers.prop && !isDynamic) {
            name = camelize(name)
            if (name === 'innerHtml') name = 'innerHTML'
          }
          if (modifiers.camel && !isDynamic) {
            name = camelize(name)
          }
          // 处理 sync 修饰符
          if (modifiers.sync) {
            syncGen = genAssignmentCode(value, `$event`)
            if (!isDynamic) {
              addHandler(
                el,
                `update:${camelize(name)}`,
                syncGen,
                null,
                false,
                warn,
                list[i]
              )
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`,
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                )
              }
            } else {
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // dynamic
              )
            }
          }
        }
        if ((modifiers && modifiers.prop) || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          // 将属性对象添加到 el.props 数组中，表示这些属性必须通过 props 设置
          // el.props = [{ name, value, start, end, dynamic }, ...]
          addProp(el, name, value, list[i], isDynamic)
        } else {
          // 将属性添加到 el.attrs 数组或者 el.dynamicAttrs 数组
          addAttr(el, name, value, list[i], isDynamic)
        }
      } else if (onRE.test(name)) { // v-on, 处理事件，<div @click="test"></div>
        // 属性名，即事件名
        name = name.replace(onRE, '')
        // 是否为动态属性
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          // 动态属性，则获取 [] 中的属性名
          name = name.slice(1, -1)
        }
        // 处理事件属性，将属性的信息添加到 el.events 或者 el.nativeEvents 对象上，格式：
        // el.events = [{ value, start, end, modifiers, dynamic }, ...]
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic)
      } else { // normal directives // normal directives，其它的普通指令
        // 得到 el.directives = [{name, rawName, value, arg, isDynamicArg, modifier, start, end }, ...]

        name = name.replace(dirRE, '')
        // parse arg
        const argMatch = name.match(argRE)
        let arg = argMatch && argMatch[1]
        isDynamic = false
        if (arg) {
          name = name.slice(0, -(arg.length + 1))
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1)
            isDynamic = true
          }
        }
        addDirective(el, name, rawName, value, arg, isDynamic, modifiers, list[i])
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    } else {
      // literal attribute
      // 当前属性不是指令
      if (process.env.NODE_ENV !== 'production') {
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          )
        }
      }
      // 将属性对象放到 el.attrs 数组中，el.attrs = [{ name, value, start, end }]
      addAttr(el, name, JSON.stringify(value), list[i])
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      if (!el.component &&
          name === 'muted' &&
          platformMustUseProp(el.tag, el.attrsMap.type, name)) {
        addProp(el, name, 'true', list[i])
      }
    }
  }
}

function checkInFor (el: ASTElement): boolean {
  let parent = el
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function parseModifiers (name: string): Object | void {
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    match.forEach(m => { ret[m.slice(1)] = true })
    return ret
  }
}

// 将属性数组转换成 key-value 的形式
function makeAttrsMap (attrs: Array<Object>): Object {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== 'production' &&
      map[attrs[i].name] && !isIE && !isEdge
    ) {
      warn('duplicate attribute: ' + attrs[i].name, attrs[i])
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag (el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}

// 非服务端渲染的情况下 <style> 标签和没有指定 type 属性或虽然指定了 type 属性但其值为 text/javascript 的 <script> 标签是被禁止的
function isForbiddenTag (el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' && (
      !el.attrsMap.type ||
      el.attrsMap.type === 'text/javascript'
    ))
  )
}

const ieNSBug = /^xmlns:NS\d+/
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
function guardIESVGBug (attrs) {
  const res = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, '')
      res.push(attr)
    }
  }
  return res
}

function checkForAliasModel (el, value) {
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap['v-model']
      )
    }
    _el = _el.parent
  }
}
