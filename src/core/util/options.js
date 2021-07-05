/* @flow */

import config from '../config'
import { warn } from './debug'
import { set } from '../observer/index'
import { unicodeRegExp } from './lang'
import { nativeWatch, hasSymbol } from './env'

import {
  ASSET_TYPES,
  LIFECYCLE_HOOKS
} from 'shared/constants'

import {
  extend,
  hasOwn,
  camelize,
  toRawType,
  capitalize,
  isBuiltInTag,
  isPlainObject
} from 'shared/util'

/**
 * Option overwriting strategies are functions that handle
 * how to merge a parent option value and a child option
 * value into the final value.
 */
const strats = config.optionMergeStrategies

/**
 * Options with restrictions
 */

// el 和 propsData 的合并不论是开发环境还是生产环境都使用默认策略，只是在开发环境下增加了一个警告提示
if (process.env.NODE_ENV !== 'production') {
  strats.el = strats.propsData = function (parent, child, vm, key) {
    // 这里的 vm 参数是调用 mergeOptions 时传入的，mergeOptions 除了 vue 实例初始化的时候调用，还会在 Vue.extend() 创建子类的时候调用，创建字类的时候是不会传递 vm 参数的
    // 在策略函数中通过判断是否存在 vm 就能够得知 mergeOptions 是在实例化时调用(使用 new 操作符走 _init 方法)还是在继承时调用(Vue.extend)，而子组件的实现方式就是通过实例化子类完成的，子类又是通过 Vue.extend 创造出来的，所以我们就能通过对 vm 的判断而得知是否是子组件了。
    if (!vm) {
      warn(
        `option "${key}" can only be used during instance ` +
        'creation with the `new` keyword.'
      )
    }
    return defaultStrat(parent, child)
  }
}

/**
 * Helper that recursively merges two data objects together.
 */
// to 对应的是 childVal 产生的纯对象，from 对应 parentVal 产生的纯对象
// 将 from 对象的属性混合到 to 对象中，也可以说是将 parentVal 对象的属性混合到 childVal 中，最后返回的是处理后的 childVal 对象
function mergeData (to: Object, from: ?Object): Object {
  // 没有 from 直接返回 to
  if (!from) return to
  let key, toVal, fromVal

  const keys = hasSymbol
    ? Reflect.ownKeys(from)
    : Object.keys(from)

  // 遍历 from 的 key
  for (let i = 0; i < keys.length; i++) {
    key = keys[i]
    // in case the object is already observed...
    if (key === '__ob__') continue
    toVal = to[key]
    fromVal = from[key]
    // 如果 from 对象中的 key 不在 to 对象中，则使用 set 函数为 to 对象设置 key 及相应的值
    if (!hasOwn(to, key)) {
      set(to, key, fromVal)
      // 如果 from 对象中的 key 也在 to 对象中，且这两个属性的值都是纯对象则递归进行深度合并
    } else if (
      toVal !== fromVal &&
      isPlainObject(toVal) &&
      isPlainObject(fromVal)
    ) {
      mergeData(toVal, fromVal)
    }
    // 其他情况什么都不做
  }
  return to
}

/**
 * Data
 */
export function mergeDataOrFn (
  parentVal: any,
  childVal: any,
  vm?: Component
): ?Function {
  // 没有 vm 实例，说明是 Vue.extend()，处理的是子组件的 data 选项合并
  if (!vm) {
    // in a Vue.extend merge, both should be functions
    // Vue.extend({}) 如果我们使用 Vue.extend 函数创建子类的时候传递的子组件选项是一个空对象，即没有 data 选项，那么此时 parentVal 实际上就是 Vue.options，由于 Vue.options 上也没有 data 这个属性，所以压根就不会执行 strats.data 策略函数，也就更不会执行 mergeDataOrFn 函数，有的同学可能会问：既然都没有执行，那么这里的 return parentVal 是不是多余的？当然不多余，因为 parentVal 存在有值的情况。那么什么时候才会出现 childVal 不存在但是 parentVal 存在的情况呢？请看如下代码
    /**
     * const Parent = Vue.extend({
          data: function () {
            return {
              test: 1
            }
          }
        })

        const Child = Parent.extend({})
     */
    // childVal 和 parentVal 必定会有其一，否则便不会执行 strats.data 策略函数，所以上面判断的意思就是：如果没有子选项则使用父选项，没有父选项就直接使用子选项，且这两个选项都能保证是函数，如果父子选项同时存在，则代码继续进行
    if (!childVal) {
      return parentVal
    }
    if (!parentVal) {
      return childVal
    }
    // when parentVal & childVal are both present,
    // we need to return a function that returns the
    // merged result of both functions... no need to
    // check if parentVal is a function here because
    // it has to be a function to pass previous merges.
    // strats.data 在处理子组件 data 合并时返回的是一个函数
    return function mergedDataFn () {
      // mergeData 接收两个纯对象
      return mergeData(
        typeof childVal === 'function' ? childVal.call(this, this) : childVal,
        typeof parentVal === 'function' ? parentVal.call(this, this) : parentVal
      )
    }
  } else {// 处理非子组件的 data 合并也返回一个函数
    return function mergedInstanceDataFn () {
      // instance merge
      const instanceData = typeof childVal === 'function'
        ? childVal.call(vm, vm)
        : childVal
      const defaultData = typeof parentVal === 'function'
        ? parentVal.call(vm, vm)
        : parentVal
      if (instanceData) {
        // mergeData 接收两个纯对象
        return mergeData(instanceData, defaultData)
      } else {
        return defaultData
      }
    }
  }
}

// data 选项的合并策略
// data 选项最终被 mergeOptions 函数处理成了一个函数，当合并处理的是子组件的选项时 data 函数可能是以下几种之一：

// 1. data 选项本身，一个函数

/**
 * 因为如下代码，mergeDataOrFn 在处理子组件 data 合并的时候，是有可能直接返回 childVal 或者 parentVal 本身
 *
 *export function mergeDataOrFn (
    parentVal: any,
    childVal: any,
    vm?: Component
  ): ?Function {

    if (!vm) {

      if (!childVal) {
        return parentVal
      }
      if (!parentVal) {
        return childVal
      }
      ...
    } else {
      ...
    }
  }
 */

  // 2. 合并子组件 data 时返回 mergedDataFn 函数，合并非子组件时返回 mergedInstanceDataFn 函数
  /**
   * export function mergeDataOrFn (
      parentVal: any,
      childVal: any,
      vm?: Component
    ): ?Function {
      if (!vm) {

        ...

        return function mergedDataFn () {
          return mergeData(
            typeof childVal === 'function' ? childVal.call(this, this) : childVal,
            typeof parentVal === 'function' ? parentVal.call(this, this) : parentVal
          )
        }

      } else {

        return function mergedInstanceDataFn () {
          // instance merge
          const instanceData = typeof childVal === 'function'
            ? childVal.call(vm, vm)
            : childVal
          const defaultData = typeof parentVal === 'function'
            ? parentVal.call(vm, vm)
            : parentVal
          if (instanceData) {
            return mergeData(instanceData, defaultData)
          } else {
            return defaultData
          }
        }
      }
    }
   */

  // 综上，无论最终合并的 data 是什么函数，这些函数的执行结果就是最终的数据 data

strats.data = function (
  parentVal: any,
  childVal: any,
  vm?: Component
): ?Function {

  // 通过 el 和 propsData 的分析，我们知道 mergeOptions 的时候如果没有传递第三个参数 vm ，则说明此时是 Vue.extend() 在扩展子组件
  if (!vm) {
    if (childVal && typeof childVal !== 'function') {
      // 子组件的 data 选项必须是一个函数
      process.env.NODE_ENV !== 'production' && warn(
        'The "data" option should be a function ' +
        'that returns a per-instance value in component ' +
        'definitions.',
        vm
      )

      return parentVal
    }
    return mergeDataOrFn(parentVal, childVal)
  }

  return mergeDataOrFn(parentVal, childVal, vm)
}

/**
 * Hooks and props are merged as arrays.
 */
// 生命周期函数的合并策略
// 从源码看可以知道声明周期函数是可以写成数组形式的，数组里的元素是函数
/**
 * new Vue({
    created: [
      function () {
        console.log('first')
      },
      function () {
        console.log('second')
      },
      function () {
        console.log('third')
      }
    ]
  })
 */
function mergeHook (
  parentVal: ?Array<Function>,
  childVal: ?Function | ?Array<Function>
): ?Array<Function> { // 生命周期的合并，最后会返回一个数组
  const res = childVal
    ? parentVal
      ? parentVal.concat(childVal) // 子和父都定义了就把子和父连接成数组
      : Array.isArray(childVal) // 子定义了就看父，如果父没有定义，就判断子是不是数组，如果是数组直接返回，如果不是数组就变成一个数组
        ? childVal
        : [childVal]
    : parentVal // 子没有定义，直接取父
    /**
     * return (是否有 childVal，即判断组件的选项中是否有对应名字的生命周期钩子函数)
      ? 如果有 childVal 则判断是否有 parentVal
        ? 如果有 parentVal 则使用 concat 方法将二者合并为一个数组
        : 如果没有 parentVal 则判断 childVal 是不是一个数组
          ? 如果 childVal 是一个数组则直接返回
          : 否则将其作为数组的元素，然后返回数组
      : 如果没有 childVal 则直接返回 parentVal
     */
  return res
    ? dedupeHooks(res)
    : res
}

function dedupeHooks (hooks) {
  const res = []
  for (let i = 0; i < hooks.length; i++) {
    if (res.indexOf(hooks[i]) === -1) {
      res.push(hooks[i])
    }
  }
  return res
}

LIFECYCLE_HOOKS.forEach(hook => { // LIFECYCLE_HOOKS 是生命周期字符串组成的数组
  strats[hook] = mergeHook
})

/**
 * Assets
 *
 * When a vm is present (instance creation), we need to do
 * a three-way merge between constructor options, instance
 * options and parent options.
 */
function mergeAssets (
  parentVal: ?Object,
  childVal: ?Object,
  vm?: Component,
  key: string
): Object {
  // 以 parentVal 为原型创建对象 res，然后判断是否有 childVal，如果有的话使用 extend 函数将 childVal 上的属性混合到 res 对象上并返回。如果没有 childVal 则直接返回 res
  /**
   * Vue.options = {
      components: {
        KeepAlive,
        Transition,
        TransitionGroup
      },
      directives: Object.create(null),
      directives:{
        model,
        show
      },
      filters: Object.create(null),
      _base: Vue
    }

    这里的 parentVal 就是 Vue.options，最后合并后的结果如下

    res = {
      ChildComponent
      __proto__: {
        KeepAlive,
        Transition,
        TransitionGroup
      }
    }
   */
  const res = Object.create(parentVal || null)
  if (childVal) {
    process.env.NODE_ENV !== 'production' && assertObjectType(key, childVal, vm)
    return extend(res, childVal)
  } else {
    return res
  }
}

ASSET_TYPES.forEach(function (type) {
  strats[type + 's'] = mergeAssets
})

/**
 * Watchers.
 *
 * Watchers hashes should not overwrite one
 * another, so we merge them as arrays.
 */
// watch 选项合并策略
// 被合并处理后的 watch 选项下的每个键值，有可能是一个数组，也有可能是一个函数
strats.watch = function (
  parentVal: ?Object,
  childVal: ?Object,
  vm?: Component,
  key: string
): ?Object {
  // work around Firefox's Object.prototype.watch...
  // 火狐浏览器中实现了 Object.prototype.watch 实例方法，所以如果和原生 watch 方法相等，则说明用户没有设置 watch
  if (parentVal === nativeWatch) parentVal = undefined
  if (childVal === nativeWatch) childVal = undefined
  /* istanbul ignore if */
  // 如果没有 childVal，就使用 parentVal 为原型创建对象
  if (!childVal) return Object.create(parentVal || null)
  if (process.env.NODE_ENV !== 'production') {
    assertObjectType(key, childVal, vm)
  }
  // 如果没有 parentVal ，直接使用用户提供的 watch 选项
  if (!parentVal) return childVal

  // 定义 ret 常量，其值为一个对象
  const ret = {}
  // 将 parentVal 的属性混合到 ret 中，后面处理的都将是 ret 对象，最后返回的也是 ret 对象
  extend(ret, parentVal)
  // 遍历 childVal 检测子选项中的值是否也在父选项中，如果在的话将父子选项合并到一个数组，否则直接把子选项变成一个数组返回
  for (const key in childVal) {
    // 由于遍历的是 childVal，所以 key 是子选项的 key，父选项中未必能获取到值，所以 parent 未必有值
    let parent = ret[key]
    // child 是肯定有值的，因为遍历的就是 childVal 本身
    const child = childVal[key]
    // 这个 if 分支的作用就是如果 parent 存在，就将其转为数组
    if (parent && !Array.isArray(parent)) {
      parent = [parent]
    }
    ret[key] = parent
    // 最后，如果 parent 存在，此时的 parent 应该已经被转为数组了，所以直接将 child concat 进去
      ? parent.concat(child)
      // 如果 parent 不存在，直接将 child 转为数组返回
      : Array.isArray(child) ? child : [child]
  }
  // 最后返回新的 ret 对象
  return ret
}

/**
 * Other object hashes.
 */
strats.props =
strats.methods =
strats.inject =
strats.computed = function (
  parentVal: ?Object,
  childVal: ?Object,
  vm?: Component,
  key: string
): ?Object {
  // 如果存在 childVal，那么在非生产环境下要检查 childVal 的类型
  if (childVal && process.env.NODE_ENV !== 'production') {
    assertObjectType(key, childVal, vm)
  }
  // parentVal 不存在的情况下直接返回 childVal
  if (!parentVal) return childVal
  // 如果 parentVal 存在，则创建 ret 对象，然后分别将 parentVal 和 childVal 的属性混合到 ret 中，注意： childVal 将覆盖 parentVal 的同名属性
  const ret = Object.create(null)
  extend(ret, parentVal)
  if (childVal) extend(ret, childVal)
  // 最后返回 ret 对象。
  return ret
}

// provide 的合并策略和 data 相同
strats.provide = mergeDataOrFn

/**
 * Default strategy.
 */
 // 默认的合并策略 子选项有就用子选项，没有就用父选项
const defaultStrat = function (parentVal: any, childVal: any): any {
  return childVal === undefined
    ? parentVal
    : childVal
}

/**
 * Validate component names
 */
// 遍历选项中的 components ，校验组件名字是否合法
function checkComponents (options: Object) {
  for (const key in options.components) {
    validateComponentName(key)
  }
}

// 判断组件 name 是否合法
export function validateComponentName (name: string) {
  if (!new RegExp(`^[a-zA-Z][\\-\\.0-9_${unicodeRegExp.source}]*$`).test(name)) { // 组件名是否符合 h5 规范
    warn(
      'Invalid component name: "' + name + '". Component names ' +
      'should conform to valid custom element name in html5 specification.'
    )
  }
  if (isBuiltInTag(name) || config.isReservedTag(name)) { // 如果是 vue 内建组件名或原生或保留 html 标签名作为组件 name，报错
    warn(
      'Do not use built-in or reserved HTML elements as component ' +
      'id: ' + name
    )
  }
}

/**
 * Ensure all props option syntax are normalized into the
 * Object-based format.
 */
// 将 props 选项规范为对象的形式
function normalizeProps (options: Object, vm: ?Component) {
  const props = options.props
  if (!props) return
  const res = {}
  let i, val, name
  // 使用数组的写法
  if (Array.isArray(props)) {
    i = props.length
    while (i--) {
      val = props[i]
      if (typeof val === 'string') {
        // 将字符串中横线转成驼峰
        name = camelize(val)
        res[name] = { type: null }
      } else if (process.env.NODE_ENV !== 'production') {
        // 使用数组写法时 props 必须是字符串
        warn('props must be strings when using array syntax.')
      }
    }
  } else if (isPlainObject(props)) {
    // 使用对象的写法
    for (const key in props) {
      val = props[key]
      name = camelize(key)
      // 检测 props 每一个键的值，如果值是一个纯对象那么直接使用，否则将值作为 type 的值
      res[name] = isPlainObject(val)
        ? val
        : { type: val }
    }
  } else if (process.env.NODE_ENV !== 'production') {
    // 开发环境中，如果 props 既不是数组也不是对象，报错
    warn(
      `Invalid value for option "props": expected an Array or an Object, ` +
      `but got ${toRawType(props)}.`,
      vm
    )
  }
  options.props = res
}

/**
 * inject 的用法
 *
 *
 * // 子组件
const ChildComponent = {
  template: '<div>child component</div>',
  created: function () {
    // 这里的 data 是父组件注入进来的
    console.log(this.data)
  },
  inject: ['data']
}

// 父组件
var vm = new Vue({
  el: '#app',
  // 向子组件提供数据
  provide: {
    data: 'test provide'
  },
  components: {
    ChildComponent
  }
})

子组件 inject 除了字符串数组的写法，还可以用对象写法，相当于为注入的数据提供一个别名

// 子组件
const ChildComponent = {
  template: '<div>child component</div>',
  created: function () {
    console.log(this.d)
  },
  // 对象的语法类似于允许我们为注入的数据声明一个别名
  inject: {
    d: 'data'
  }
}

 */

/**
 * Normalize all injections into Object-based format
 */
// 规范化 inject 选项为对象形式
function normalizeInject (options: Object, vm: ?Component) {
  const inject = options.inject
  if (!inject) return
  const normalized = options.inject = {}
  // 数组写法
  if (Array.isArray(inject)) {
    for (let i = 0; i < inject.length; i++) {
      normalized[inject[i]] = { from: inject[i] }
    }
  } else if (isPlainObject(inject)) {
    // 对象写法
    /**
     * 下面这样的 inject 写法：
     *
     * let data1 = 'data1'

      // 这里为简写，这应该写在Vue的选项中
      inject: {
        data1,
        d2: 'data2',
        data3: { someProperty: 'someValue' }
      }

      最终被规范化为下面的形式：

      inject: {
        'data1': { from: 'data1' },
        'd2': { from: 'data2' },
        'data3': { from: 'data3', someProperty: 'someValue' }
      }

     */
    for (const key in inject) {
      const val = inject[key]
      normalized[key] = isPlainObject(val)
        ? extend({ from: key }, val)
        : { from: val }
    }
  } else if (process.env.NODE_ENV !== 'production') {
    // 开发环境下，inject 既不是数组也不是对象，报错
    warn(
      `Invalid value for option "inject": expected an Array or an Object, ` +
      `but got ${toRawType(inject)}.`,
      vm
    )
  }
}

/**
 * 指令的两种写法，对象写法和函数写法
<div id="app" v-test1 v-test2>{{test}}</div>

var vm = new Vue({
  el: '#app',
  data: {
    test: 1
  },
  // 注册两个局部指令
  directives: {
    test1: {
      bind: function () {
        console.log('v-test1')
      }
    },
    test2: function () {
      console.log('v-test2')
    }
  }
})
 */


/**
 * Normalize raw function directives into object format.
 */
// 规范化 directives 为对象形式
function normalizeDirectives (options: Object) {
  const dirs = options.directives
  if (dirs) {
    for (const key in dirs) {
      const def = dirs[key]
      // 如果是函数，转换成对象的形式
      if (typeof def === 'function') {
        dirs[key] = { bind: def, update: def }
      }
    }
  }
}

function assertObjectType (name: string, value: any, vm: ?Component) {
  if (!isPlainObject(value)) {
    warn(
      `Invalid value for option "${name}": expected an Object, ` +
      `but got ${toRawType(value)}.`,
      vm
    )
  }
}

/**
 * Merge two option objects into a new one.
 * Core utility used in both instantiation and inheritance.
 */
/**
 * 合并两个选项，出现相同配置项时，子选项会覆盖父选项的配置
 * 第一，这个函数将会产生一个新的对象；第二，这个函数不仅仅在实例化对象(即_init方法中)的时候用到，在继承(Vue.extend)中也有用到，所以这个函数应该是一个用来合并两个选项对象为一个新对象的通用程序。
 */
export function mergeOptions (
  parent: Object,
  child: Object,
  vm?: Component
): Object {
  // 开发环境下检查 components 中所有组件名字是否合法
  if (process.env.NODE_ENV !== 'production') {
    checkComponents(child)
  }

  // child 参数除了是普通的选项对象外，还可以是一个函数，如果是函数的话就取该函数的 options 静态属性作为新的 child
  // Vue 构造函数本身就拥有这个属性，其实通过 Vue.extend 创造出来的子类也是拥有这个属性的。所以这就允许我们在进行选项合并的时候，去合并一个 Vue 实例构造者的选项了。
  if (typeof child === 'function') {
    child = child.options
  }
  // 规范化 props、inject、directive 选项，方便后续程序的处理
  /**
   * 以 props 为例，props可以像下面这样用数组：
   *
   *  const ChildComponent = {
        props: ['someData']
      }

      也可以像下面这样用对象：

      const ChildComponent = {
        props: {
          someData: {
            type: Number,
            default: 0
          }
        }
      }
      规范化就是将用户用不同语法提供的选项规范成同一种形式
   */
  normalizeProps(child, vm)
  normalizeInject(child, vm)
  normalizeDirectives(child)

  // Apply extends and mixins on the child options,
  // but only if it is a raw options object that isn't
  // the result of another mergeOptions call.
  // Only merged options has the _base property.

  // 处理原始 child 对象上的 extends 和 mixins，分别执行 mergeOptions，将这些继承而来的选项合并到 parent
  // mergeOptions 处理过的对象会含有 _base 属性
  if (!child._base) {
    // { extend } 和 mixin 很类似，让你基于一个组件去扩展另外一个，不需要使用 Vue.extend
    // 任何写在 mixins 中的选项，都会使用 mergeOptions 中相应的合并策略进行处理，这就是 mixins 的实现方式
    // 对于 extends 选项，与 mixins 相同，甚至由于 extends 选项只能是一个对象，而不能是数组，反而要比 mixins 的实现更为简单，连遍历都不需要。
    if (child.extends) {
      parent = mergeOptions(parent, child.extends, vm)
    }
    if (child.mixins) {
      for (let i = 0, l = child.mixins.length; i < l; i++) {
        parent = mergeOptions(parent, child.mixins[i], vm)
      }
    }
  }

  const options = {} // 最后 return 的结果
  let key
  for (key in parent) {// 遍历 父选项
    mergeField(key)
  }
  for (key in child) {// 遍历 子选项，如果父选项不存在该配置，则合并，否则跳过，因为父子拥有同一个属性的情况在上面处理父选项时已经处理过了，用的子选项的值
    if (!hasOwn(parent, key)) {
      mergeField(key)
    }
  }

  // 合并选项，childVal 优先级高于 parentVal
  function mergeField (key) {

    // strats = Object.create(null)
    const strat = strats[key] || defaultStrat
    // 通过不同的 key 拿到不同的 strats 函数
    // strats 是对各种不同的 option 定义了对应的合并策略

    // 值为如果 childVal 存在则优先使用 childVal，否则使用 parentVal
    options[key] = strat(parent[key], child[key], vm, key)
  }
  return options
}

/**
 * Resolve an asset.
 * This function is used because child instances need access
 * to assets defined in its ancestor chain.
 */
export function resolveAsset (
  options: Object,
  type: string,
  id: string,
  warnMissing?: boolean
): any {
  /* istanbul ignore if */
  if (typeof id !== 'string') {
    return
  }
  const assets = options[type]
  // check local registration variations first
  if (hasOwn(assets, id)) return assets[id] // 如果options[type][id] 存在直接返回
  const camelizedId = camelize(id) // camelize('aa-bb-cc') "aaBbCc" 把连字符写法转换成驼峰写法
  if (hasOwn(assets, camelizedId)) return assets[camelizedId] // 用驼峰写法继续找options[type][id] 是否存在
  const PascalCaseId = capitalize(camelizedId) // 首字母大写的驼峰写法
  if (hasOwn(assets, PascalCaseId)) return assets[PascalCaseId] // 首字母大写的驼峰写法是否存在
  // fallback to prototype chain
  const res = assets[id] || assets[camelizedId] || assets[PascalCaseId]
  if (process.env.NODE_ENV !== 'production' && warnMissing && !res) {
    warn(
      'Failed to resolve ' + type.slice(0, -1) + ': ' + id,
      options
    )
  }
  return res
}
