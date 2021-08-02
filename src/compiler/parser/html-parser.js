/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'

// Regular Expressions for parsing tags and attributes
// 匹配标签的属性
// 第一个捕获组 ([^\s"'<>\/=]+) 用来匹配属性名，第二个捕获组 (=) 用来匹配等于号，第三 "([^"]*)"+ 、第四 '([^']*)'+、第五个 ([^\s"'=<>`]+) 捕获组都是用来匹配属性值的
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/

// 匹配标签动态属性
const dynamicArgAttribute = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/

// ncname 不包含冒号(:)的 XML 名称
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`

// qnameCapture 合法的标签名称，它是由可选项的 前缀、冒号 以及 名称 组成
const qnameCapture = `((?:${ncname}\\:)?${ncname})`

// < 以及后面的 标签名称
const startTagOpen = new RegExp(`^<${qnameCapture}`)

// 捕获开始标签结束部分的斜杠：/
const startTagClose = /^\s*(\/?)>/

// 匹配结束标签
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
const doctype = /^<!DOCTYPE [^>]+>/i

// #7298: escape - to avoid being passed as HTML comment when inlined in page
// 匹配注释节点
const comment = /^<!\--/

// 匹配条件注释节点
const conditionalComment = /^<!\[/

// Special Elements (can contain anything)
// 检测给定的标签名字是不是纯文本标签
export const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// #5992
// 判断是否应该忽略标签内容的第一个换行符的，如果满足：标签是 pre 或者 textarea 且 标签内容的第一个字符是换行符，则返回 true，否则为 false。
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

// 将 html 实体转为对应的字符
function decodeAttr (value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

  // 解析 html 模版字符串，处理所有标签以及标签上的属性
  // 这里的 parseHTMLOptions 在后面处理过程中用到，再进一步解析
  // 提前解析的话容易让大家岔开思路
  /**
 * 通过循环遍历 html 模版字符串，依次处理其中的各个标签，以及标签上的属性
 * @param {*} html html 模版
 * @param {*} options 配置项
 */
export function parseHTML (html, options) {
  // 栈结构，碰到起始标签入栈，碰到对应结束标签出栈
  // 用来判断是否有的标签没有结束标签
  const stack = []
  const expectHTML = options.expectHTML
  // 是否是自闭合标签
  const isUnaryTag = options.isUnaryTag || no
  // 检测一个标签是否是可以省略闭合标签的非一元标签
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  // 记录当前在原始 html 字符串中的开始位置
  let index = 0
  // last 存储剩余还未解析的 html 字符串；lastTag 始终存储着位于 stack 栈顶的元素
  let last, lastTag

  while (html) {
    last = html
    // Make sure we're not in a plaintext content element like script/style
    // 确保不是在 script、style、textarea 这样的纯文本元素中
    if (!lastTag || !isPlainTextElement(lastTag)) {
      // 找第一个 < 字符
      let textEnd = html.indexOf('<')

      // textEnd === 0 说明 html 第一个字符就是 <
      /**
       * 1、可能是注释节点：<!-- -->
        2、可能是条件注释节点：<![ ]>
        3、可能是 doctype：<!DOCTYPE >
        4、可能是结束标签：</xxx>
        5、可能是开始标签：<xxx>
        6、可能只是一个单纯的字符串：<abcdefg
       */
      // 分别处理可能找到的注释标签、条件注释标签、Doctype、开始标签、结束标签
      // 每处理完一种情况，就会截断（continue）循环，并且重置 html 字符串，将处理过的标签截掉，下一次循环处理剩余的 html 字符串模版
      if (textEnd === 0) {
        // Comment:
        // 处理注释标签 <!-- xx -->
        if (comment.test(html)) {
          // 注释标签的结束索引
          const commentEnd = html.indexOf('-->')

          if (commentEnd >= 0) {
            // 是否应该保留 注释
            if (options.shouldKeepComment) {
              // 得到：注释内容、注释的开始索引、结束索引
              options.comment(html.substring(4, commentEnd), index, index + commentEnd + 3)
            }
            // 调整 html 和 index 变量
            advance(commentEnd + 3)
            continue
          }
        }
        // 处理条件注释标签：<!--[if IE]> 直接去掉不要
        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        if (conditionalComment.test(html)) {
          // 找到结束位置
          const conditionalEnd = html.indexOf(']>')

          if (conditionalEnd >= 0) {
            // 调整 html 和 index 变量
            advance(conditionalEnd + 2)
            continue
          }
        }

        // 处理 Doctype，<!DOCTYPE html> 直接去掉不要
        // Doctype:
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        /**
         * 处理开始标签和结束标签是这整个函数中的核心部分，其它的不用管
         * 这两部分就是在词法分析，然后调用 start 和 end 构造 element ast
         */

        // 处理结束标签
        /**
         * <div></div>
         * endTagMatch = [
            '</div>',
            'div'
          ]
         */
        const endTagMatch = html.match(endTag)
        if (endTagMatch) {
          const curIndex = index
          advance(endTagMatch[0].length)
          // 处理结束标签
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
         // 处理开始标签，比如 <div id="app">，
         // startTagMatch = { tagName: 'div', attrs: [[xx], ...], start: index, end: index }
         // parseStartTag 函数解析开始标签，如果解析成功了说明的确是开始标签，然后才会走下面的逻辑
         /**
          * parseStartTag() 举例子
          *
          * <div v-if="isSucceed" v-for="v in map"></div>
          *
          * 经过 parseStartTag 处理后返回：
          *
          * match = {
              tagName: 'div',
              attrs: [
                [
                  ' v-if="isSucceed"',
                  'v-if',
                  '=',
                  'isSucceed',
                  undefined,
                  undefined
                ],
                [
                  ' v-for="v in map"',
                  'v-for',
                  '=',
                  'v in map',
                  undefined,
                  undefined
                ]
              ],
              start: index,
              unarySlash: undefined,
              end: index
            }
          */
        const startTagMatch = parseStartTag()
        if (startTagMatch) {
          // 进一步处理上一步得到结果，并最后调用 options.start 方法
          // 真正的解析工作都是在这个 start 方法中做的
          handleStartTag(startTagMatch)
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          continue
        }
      }

      let text, rest, next
      if (textEnd >= 0) {
        // 能走到这儿，说明虽然在 html 中匹配到到了 <xx，但是这不属于上述几种情况，
        // 它就只是一个普通的一段文本：<我是文本
        // 于是从 html 中找到下一个 <，直到 <xx 是上述几种情况的标签，则结束，
        // 在这整个过程中一直在调整 textEnd 的值，作为 html 中下一个有效标签的开始位置

        // 截取 html 模版字符串中 textEnd 之后的内容，rest = <xx
        rest = html.slice(textEnd)
        // 这个 while 循环就是处理 <xx 之后的纯文本情况
        // 截取文本内容，并找到有效标签的开始位置（textEnd）
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          // 则认为 < 后面的内容为纯文本，然后在这些纯文本中再次找 <
          next = rest.indexOf('<', 1)
          // 如果没找到 <，则直接结束循环
          if (next < 0) break
          // 走到这儿说明在后续的字符串中找到了 <，索引位置为 textEnd
          textEnd += next
          // 截取 html 字符串模版 textEnd 之后的内容赋值给 rest，继续判断之后的字符串是否存在标签
          rest = html.slice(textEnd)
        }
        // 走到这里，说明遍历结束，有两种情况，一种是 < 之后就是一段纯文本，要不就是在后面找到了有效标签，截取文本
        text = html.substring(0, textEnd)
      }

      // 如果 textEnd < 0，说明 html 中就没找到 <，那说明 html 就是一段文本
      if (textEnd < 0) {
        text = html
      }

      // 将文本内容从 html 模版字符串上截取掉
      if (text) {
        advance(text.length)
      }

      // 处理文本
      // textEnd >= 0 或 textEnd < 0 的时候的普通文本会被处理
      if (options.chars && text) {
        options.chars(text, index - text.length, index)
      }
    } else {
      // 处理 script、style、textarea 标签中的内容，对于纯文本标签的处理宗旨就是将其内容作为纯文本对待

      // endTagLength 变量用来保存纯文本标签闭合标签的字符长度
      let endTagLength = 0
      // 开始标签的小写形式
      const stackedTag = lastTag.toLowerCase()

      // 匹配纯文本标签的内容以及结束标签
      // 第一个捕获分组开启了懒惰模式，匹配的是纯文本标签的文字内容
      // 第二个捕获分组匹配 stackedTag 对应的结束标签
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))


      // 匹配并处理开始标签和结束标签之间的所有文本，比如 <script>xx</script>
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }

        // 忽略 <pre> 标签和 <textarea> 标签的内容中的第一个换行符
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }

        // 将纯文本标签的内容全部作为纯文本对待
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    // 如果两者相等，则说明字符串 html 在经历循环体的代码之后没有任何改变，此时会把 html 字符串作为纯文本对待
    if (html === last) {
      options.chars && options.chars(html)
      // stack 被清空了，但是还有内容，说明是不合法的标签格式， 例如 <div></div><a
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, { start: index + html.length })
      }
      break
    }
  }

  // Clean up any remaining tags
  parseEndTag()

  /**
 * 重置 html，html = 从索引 n 位置开始的向后的所有字符
 * index 为 html 在 原始的 模版字符串 中的的开始索引，也是下一次该处理的字符的开始位置
 * @param {*} n 索引
 */
  function advance (n) {
    index += n
    html = html.substring(n)
  }

  /**
 * 解析开始标签，比如：<div id="app">
 * @returns { tagName: 'div', attrs: [[xx], ...], start: index, end: index }
 */
  function parseStartTag () {
    // 匹配 < 以及后面的 标签名称
    const start = html.match(startTagOpen)
    // 如果匹配到了，说明是开始标签
    /**
     * <div></div>
     * 则匹配结果如下
     * start = ['<div', 'div']
     */
    if (start) {
      // 处理结果
      const match = {
        // 标签名
        tagName: start[1],
        // 属性，占位符
        attrs: [],
        // 标签的开始位置
        start: index
      }
      /**
       * 调整 html 和 index，比如：
       *   html = ' id="app">'
       *   index = 此时的索引
       *   start[0] = '<div'
       */
      advance(start[0].length)
      let end, attr
      // 处理 开始标签 内的各个属性，并将这些属性放到 match.attrs 数组中
      // 没有匹配到开始标签的结束部分，并且匹配到了开始标签中的属性 这个时候循环体将被执行，直到遇到开始标签的结束部分为止
      /**
       * <div v-for="v in map"></div>
       * 属性将被匹配为
       * attr = [
          ' v-for="v in map"',
          'v-for',
          '=',
          'v in map',
          undefined,
          undefined
        ]
       */
      while (!(end = html.match(startTagClose)) && (attr = html.match(dynamicArgAttribute) || html.match(attribute))) {
        attr.start = index
        advance(attr[0].length)
        attr.end = index
        match.attrs.push(attr)
      }
      // 开始标签的结束，end = '>' 或 end = ' />'
      /**
       * <br /> startTagClose 匹配结果：end = ['/>', '/']
       * <div>  startTagClose 匹配结果：end = ['>', undefined]
       */
      if (end) {
        match.unarySlash = end[1] // 如果 end[1] 有值说明是一元标签
        advance(end[0].length)
        match.end = index
        return match
      }
    }
  }

  /**
 * 进一步处理开始标签的解析结果 ——— match 对象
 *  处理属性 match.attrs，如果不是自闭合标签，则将标签信息放到 stack 数组，待将来处理到它的闭合标签时再将其弹出 stack，表示该标签处理完毕，这时标签的所有信息都在 element ast 对象上了
 *  接下来调用 options.start 方法处理标签，并根据标签信息生成 element ast，
 *  以及处理开始标签上的属性和指令，最后将 element ast 放入 stack 数组
 *
 * @param {*} match { tagName: 'div', attrs: [[xx], ...], start: index, end: index }
 */
  function handleStartTag (match) {
    const tagName = match.tagName
    const unarySlash = match.unarySlash

    if (expectHTML) {
      /**
       * 最近一次遇到的开始标签是 p 标签，并且当前正在解析的开始标签不能段落式内容(Phrasing content) 模型，这时候 if 语句块的代码才会执行，即调用 parseEndTag(lastTag)。
       *
       * 每一个 html 元素都拥有一个或多个内容模型(content model)，其中 p 标签本身的内容模型是 流式内容(Flow content)，并且 p 标签的特性是只允许包含 段落式内容(Phrasing content)。所以条件成立的情况如下：
       *
       * <p><h2></h2></p>
       *
       * 在解析上面这段 html 字符串的时候，首先遇到 p 标签的开始标签，此时 lastTag 被设置为 p，紧接着会遇到 h2 标签的开始标签，由于 h2 标签的内容模型属于非 段落式内容(Phrasing content) 模型，所以会立即调用 parseEndTag(lastTag) 函数闭合 p 标签，此时由于强行插入了 </p> 标签，所以解析后的字符串将变为如下内容：
       *
       * <p></p><h2></h2></p>
       *
       * 接着，继续解析该字符串，会遇到 <h2></h2> 标签并正常解析之，最后解析器会遇到一个单独的 p 标签的结束标签，即：</p>。这个时候就回到了我们前面讲过的，当解析器遇到 p 标签或者 br 标签的结束标签时会补全他们，最终 <p><h2></h2></p> 这段 html 字符串将被解析为：
       *
       * <p></p><h2></h2><p></p>
       *
       * 而这也就是浏览器的行为，以上是第一个 if 分支的意义。
       */
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag)
      }

      // 当前正在解析的标签是一个可以省略结束标签的标签，并且与上一次解析到的开始标签相同
      /**
       * <p>one
        <p>two

        p 标签是可以省略结束标签的标签，所以当解析到一个 p 标签的开始标签并且下一次遇到的标签也是 p 标签的开始标签时，会立即关闭第二个 p 标签。即调用：parseEndTag(tagName) 函数，然后由于第一个 p 标签缺少闭合标签所以会 Vue 会给你一个警告。
       */
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }

    // 是否是一元标签，比如 <hr />
    const unary = isUnaryTag(tagName) || !!unarySlash

  // for 循环的作用是：格式化 match.attrs 数组，并将格式化后的数据存储到常量 attrs 中
  // 处理 match.attrs，得到 attrs = [{ name: attrName, value: attrVal, start: xx, end: xx }, ...]
  // 比如 attrs = [{ name: 'id', value: 'app', start: xx, end: xx }, ...]
    const l = match.attrs.length
    const attrs = new Array(l)

    for (let i = 0; i < l; i++) {
      const args = match.attrs[i]
      // handleStartTag 处理的是 parseStartTag 返回的 match 结果，通过 parseStartTag 的代码我们知道正则匹配的第 3 4 5 位置是属性的值，其中只有一项是有值的，其他捕获分组是 undefined
      const value = args[3] || args[4] || args[5] || ''
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines

      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
      // 非生产环境，记录属性的开始和结束索引
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }

    // 如果开始标签是非一元标签，则将该开始标签的信息入栈，即 push 到 stack 数组中，并将 lastTag 的值设置为该标签名
    // 如果是自闭合标签，则标签信息就没必要进入 stack 了，直接处理众多属性，将他们都设置到 element ast 对象上，就没有处理 结束标签的那一步了，这一步在处理开始标签的过程中就进行了
    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs, start: match.start, end: match.end })
      lastTag = tagName
    }

      /**
   * 调用 start 方法，主要做了以下 6 件事情:
   *   1、创建 AST 对象
   *   2、处理存在 v-model 指令的 input 标签，分别处理 input 为 checkbox、radio、其它的情况
   *   3、处理标签上的众多指令，比如 v-pre、v-for、v-if、v-once
   *   4、如果根节点 root 不存在则设置当前元素为根节点
   *   5、如果当前元素为非自闭合标签则将自己 push 到 stack 数组，并记录 currentParent，在接下来处理子元素时用来告诉子元素自己的父节点是谁
   *   6、如果当前元素为自闭合标签，则表示该标签要处理结束了，让自己和父元素产生关系，以及设置自己的子元素
   */
    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }

  /**
   * <body>
      </br>
      </p>
    </body>

    上面的 html 片段中，我们分别写了 </br>、</p> 的结束标签，但注意我们并没有写起始标签，而浏览器是能够正常解析他们的，其中 </br> 标签被正常解析为 <br> 标签，而 </p> 标签被正常解析为 <p></p>。除了 br 与 p 其他任何标签如果你只写了结束标签那么浏览器都将会忽略。所以为了与浏览器的行为相同，parseEndTag 函数也需要专门处理 br 与 p 的结束标签，即：</br> 和 </p>。
   */
  /**
   * 调用 parseEndTag() 函数时不传递任何参数，也就是说此时 tagName 参数也不存在。由于 tagName 不存在，所以此时 pos 为 0，我们知道在这段代码之后会遍历 stack 栈，并将 stack 栈中元素的索引与 pos 作对比。由于 pos 为 0，所以 i >= pos 始终成立，这个时候 stack 栈中如果有剩余未处理的标签，则会逐个警告缺少闭合标签，并调用 options.end 将其闭合。
   */
  /**
 * 解析结束标签，比如：</div>
 * 最主要的事就是：
 *   1、处理 stack 数组，从 stack 数组中找到当前结束标签对应的开始标签，然后调用 options.end 方法
 *   2、处理完结束标签之后调整 stack 数组，保证在正常情况下 stack 数组中的最后一个元素就是下一个结束标签对应的开始标签
 *   3、处理一些异常情况，比如 stack 数组最后一个元素不是当前结束标签对应的开始标签，还有就是
 *      br 和 p 标签单独处理
 * @param {*} tagName 标签名，比如 div
 * @param {*} start 结束标签的开始索引
 * @param {*} end 结束标签的结束索引
 */
  function parseEndTag (tagName, start, end) {
    let pos, lowerCasedTagName
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    // 倒序遍历 stack 数组，找到第一个和当前结束标签相同的标签，该标签就是结束标签对应的开始标签的描述对象
    // 理论上，不出异常，stack 数组中的最后一个元素就是当前结束标签的开始标签的描述对象
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    // 如果在 stack 中一直没有找到相同的标签名，则 pos 就会 < 0，进行后面的 else 分支
    if (pos >= 0) {
      // Close all the open elements, up the stack
      // 这个 for 循环负责关闭 stack 数组中索引 >= pos 的所有标签
      // 为什么要用一个循环，上面说到正常情况下 stack 数组的最后一个元素就是我们要找的开始标签，
      // 但是有些异常情况，就是有些元素没有给提供结束标签，比如：
      // stack = ['span', 'div', 'span', 'h1']，当前处理的结束标签 tagName = div
      // 匹配到 div，pos = 1，那索引为 2 和 3 的两个标签（span、h1）说明就没提供结束标签
      // 这个 for 循环就负责关闭 div、span 和 h1 这三个标签，
      // 并在开发环境为 span 和 h1 这两个标签给出 ”未匹配到结束标签的提示”
      for (let i = stack.length - 1; i >= pos; i--) {
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`,
            { start: stack[i].start, end: stack[i].end }
          )
        }
        if (options.end) {
          // 走到这里，说明上面的异常情况都处理完了，调用 options.end 处理正常的结束标签
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
    // 将刚才处理的那些标签从数组中移除，保证数组的最后一个元素就是下一个结束标签对应的开始标签
      stack.length = pos
      lastTag = pos && stack[pos - 1].tag
    } else if (lowerCasedTagName === 'br') {
      // 当前处理的标签为 <br /> 标签
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      // p 标签
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        // 处理 </p> 标签
        options.end(tagName, start, end)
      }
    }
  }
}
