/* @flow */

const validDivisionCharRE = /[\w).+\-_$\]]/

// 解析绑定的属性中的过滤器
// <div v-bind:id="id | myfilter"></div>
export function parseFilters (exp: string): string {
  let inSingle = false // 标识当前读取的字符是否在由单引号包裹的字符串中
  let inDouble = false // 标识当前读取的字符是否在由 双引号 包裹的字符串中
  let inTemplateString = false // 标识当前读取的字符是否在 模板字符串中
  let inRegex = false // 标识当前读取的字符是否在 正则表达式中
  let curly = 0 // 每遇到一个左花括号({)，则 curly 变量的值就会加一，每遇到一个右花括号(})，则 curly 变量的值就会减一
  let square = 0 // 每遇到一个左方括号([)，则 square 变量的值就会加一，每遇到一个右方括号(])，则 square 变量的值就会减一
  let paren = 0 // 每遇到一个左圆括号(()，则 paren 变量的值就会加一，每遇到一个右圆括号())，则 paren 变量的值就会减一

  // lastFilterIndex 属性值字符串中字符的索引，将会被用来确定过滤器的位置
  // c 当前字符对应的 ASCII 码
  // prev 当前字符的前一个字符所对应的 ASCII 码
  // i 当前读入字符的位置索引
  // expression parseFilters 函数的返回值
  // filters 一个数组，保存所有过滤器函数名
  let lastFilterIndex = 0
  let c, prev, i, expression, filters

  for (i = 0; i < exp.length; i++) {
    // 每次循环的开始，都会将上一次读取的字符所对应的 ASCII 码赋值给 prev 变量，然后再将变量 c 的值设置为当前读取字符所对应的 ASCII 码。
    prev = c
    c = exp.charCodeAt(i)


    if (inSingle) { // 如果当前读取的字符存在于由单引号包裹的字符串内，则会执行这里的代码
      // 当前字符是单引号 0x27(')，并且当前字符的前一个字符不是反斜杠 0x5C(\)，也就是说当前字符(单引号)就是字符串的结束。则将 inSingle 变量的值设置为 false，代表接下来的解析工作已经不处于由单引号所包裹的字符串环境中了
      if (c === 0x27 && prev !== 0x5C) inSingle = false
    } else if (inDouble) { // 如果当前读取的字符存在于由双引号包裹的字符串内，则会执行这里的代码
      // 当前字符是双引号 0x22(")，并且前一个字符不是转义字符 0x5C(\)。这说明当前字符(双引号)就应该是字符串的结束，此时会将变量 inDouble 的值设置为 false，代表接下来的解析工作已经不处于由双引号所包裹的字符串环境中了
      if (c === 0x22 && prev !== 0x5C) inDouble = false
    } else if (inTemplateString) { // 如果当前读取的字符存在于模板字符串内，则会执行这里的代码
      // 当前字符是 0x60(`)，并且前一个字符不是转义字符 0x5C(\)。这说明当前字符(`)就应该是模板字符串的结束，此时会将变量 inTemplateString 的值设置为 false，代表接下来的解析工作已经不处于模板字符串环境中了
      if (c === 0x60 && prev !== 0x5C) inTemplateString = false
    } else if (inRegex) { // 如果当前读取的字符存在于正则表达式内，则会执行这里的代码
      // 当前字符是 0x2f(/)，并且前一个字符不是转义字符 0x5C(\)。这说明当前字符(/)就应该是正则表达式的结束，此时会将变量 inRegex 的值设置为 false，代表接下来的解析工作已经不处于正则表达式的环境中了
      if (c === 0x2f && prev !== 0x5C) inRegex = false
    } else if (
      c === 0x7C && // pipe
      exp.charCodeAt(i + 1) !== 0x7C &&
      exp.charCodeAt(i - 1) !== 0x7C &&
      !curly && !square && !paren
    ) { // 如果当前读取的字符是过滤器的分界线，则会执行这里的代码

      // 1、当前字符所对应的 ASCII 码必须是 0x7C，即当前字符必须是管道符。
      // 2、该字符的后一个字符不能是管道符。
      // 3、该字符的前一个字符不能是管道符。
      // 4、该字符不能处于花括号、方括号、圆括号之内

      if (expression === undefined) {
        // first filter, end of expression
        lastFilterIndex = i + 1 // 管道符的下一个位置，也就是过滤器的开始位置
        expression = exp.slice(0, i).trim() // 截取表达式
      } else {
        pushFilter()
      }
    } else { // 其他情况

      // 如果当前字符为双引号(")，则将 inDouble 变量的值设置为 true。
      // 如果当前字符为单引号(‘)，则将 inSingle 变量的值设置为 true。
      // 如果当前字符为模板字符串的定义字符(`)，则将 inTemplateString 变量的值设置为 true。
      // 如果当前字符是左圆括号(()，则将 paren 变量的值加一。
      // 如果当前字符是右圆括号())，则将 paren 变量的值减一。
      // 如果当前字符是左方括号([)，则将 square 变量的值加一。
      // 如果当前字符是右方括号(])，则将 square 变量的值减一。
      // 如果当前字符是左花括号({)，则将 curly 变量的值加一。
      // 如果当前字符是右花括号(})，则将 curly 变量的值减一。

      switch (c) {
        case 0x22: inDouble = true; break         // "
        case 0x27: inSingle = true; break         // '
        case 0x60: inTemplateString = true; break // `
        case 0x28: paren++; break                 // (
        case 0x29: paren--; break                 // )
        case 0x5B: square++; break                // [
        case 0x5D: square--; break                // ]
        case 0x7B: curly++; break                 // {
        case 0x7D: curly--; break                 // }
      }
      if (c === 0x2f) { // /
        // 判断是否进入正则表达式
        let j = i - 1
        let p
        // find first non-whitespace prev char
        // 循环找到 / 符号之前的不为空格的字符
        for (; j >= 0; j--) {
          p = exp.charAt(j)
          if (p !== ' ') break
        }
        // 如果前面没有其他字符，或者不属于 字母、数字、)、.、+、-、_、$、] 之一，则说明当前 / 是正则表达式的开始，而不是除号
        if (!p || !validDivisionCharRE.test(p)) {
          inRegex = true
        }
      }
    }
  }

  // 循环结束了 expression 还没有生成就截取生成，如果已经有 expression 了，lastFilterIndex 不为 0 则说明有过滤器，提取出来存入 filters 数组
  if (expression === undefined) {
    expression = exp.slice(0, i).trim()
  } else if (lastFilterIndex !== 0) {
    pushFilter()
  }

  // 提取过滤器存入 filters 数组
  function pushFilter () {
    (filters || (filters = [])).push(exp.slice(lastFilterIndex, i).trim())
    lastFilterIndex = i + 1
  }

  if (filters) {
    for (i = 0; i < filters.length; i++) {
      expression = wrapFilter(expression, filters[i])
    }
  }

  return expression
}

// <div :key="id | a | b"></div>
// 将被解析成
// _f("b")(_f("a")(id))
function wrapFilter (exp: string, filter: string): string {
  const i = filter.indexOf('(')
  if (i < 0) {
    // _f: resolveFilter
    return `_f("${filter}")(${exp})`
  } else {
    const name = filter.slice(0, i)
    const args = filter.slice(i + 1)
    return `_f("${name}")(${exp}${args !== ')' ? ',' + args : args}`
  }
}
