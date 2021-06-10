/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import Dep, { pushTarget, popTarget } from '../observer/dep'
import { isUpdatingChildComponent } from './lifecycle'

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving
} from '../observer/index'

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute
} from '../util/index'

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

// 设置代理，将 key 代理到 target 上
export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

/**
 * 两件事：
 *   数据响应式的入口：分别处理 props、methods、data、computed、watch
 *   优先级：props、methods、data、computed 对象中的属性不能出现重复，优先级和列出顺序一致
 *         其中 computed 中的 key 不能和 props、data 中的 key 重复，methods 不影响
 */
export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options

  // 处理 props 对象，为 props 对象的每个属性设置响应式，并将其代理到 vm 实例上
  if (opts.props) initProps(vm, opts.props)

  // 处理 methos 对象，校验每个属性的值是否为函数
  // 判重处理，和 props 属性对比，methods 中属性不能和 props 属性重复， props 优先级 > methods 优先级
  // 将 methods 上配置赋值到 vm 上，支持通过 this.methodsKey 的方式访问方法
  if (opts.methods) initMethods(vm, opts.methods)
  /**
   * 做了三件事
   *   1、判重处理，data 对象上的属性不能和 props、methods 对象上的属性相同
   *   2、代理 data 对象上的属性到 vm 实例
   *   3、为 data 对象的上数据设置响应式
   */
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
   /**
   * 三件事：
   *   1、为 computed[key] 创建 watcher 实例，默认是懒执行
   *   2、代理 computed[key] 到 vm 实例
   *   3、判重，computed 中的 key 不能和 data、props 中的属性重复
   *   注意 computed 缓存原理
   */
  if (opts.computed) initComputed(vm, opts.computed)
  //实例化一个 watch ，返回一个 unwatch
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
  /**
   * computed 和 watch 有什么区别？
   * computed 默认懒执行，且不可更改，但是 watch 可配置
   *
   * 其实到这里也能看出，computed 和 watch 在本质是没有区别的，都是通过 watcher 去实现的响应式
   * 非要说有区别，那也只是在使用方式上的区别，简单来说：
   *   1、watch：适用于当数据变化时执行异步或者开销较大的操作时使用，即需要长时间等待的操作可以放在 watch 中
   *   2、computed：其中可以使用异步方法，但是没有任何意义。所以 computed 更适合做一些同步计算
   */
}

// 处理 props 对象，为 props 对象的每个属性设置响应式，并将其代理到 vm 实例上
function initProps (vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  // 缓存 props 的每个 key到数组里，性能优化
  const keys = vm.$options._propKeys = []
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) { // 根组件实例的 props 应该被 observe 处理，非根组件实例就会把 shouldObserve 变成 false
    toggleObserving(false)
  }
  // 遍历 props 对象
  for (const key in propsOptions) {
    // 缓存 key
    keys.push(key)
    // 获取 props[key] 的默认值
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
          config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
    // 为 props 的每个 key 是设置数据响应式
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      // 代理 key 到 vm 对象上，即可以通过 this.propsKey 的方式访问到 props
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}

/**
 * 做了三件事
 *   1、判重处理，data 对象上的属性不能和 props、methods 对象上的属性相同
 *   2、代理 data 对象上的属性到 vm 实例
 *   3、为 data 对象的上数据设置响应式
 */
function initData (vm: Component) {
  let data = vm.$options.data
  // 保证后续处理的 data 是一个对象
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
    // 如果 data 是个函数，就调用它获取到定义的属性
  if (!isPlainObject(data)) { // 如果 data 是个对象就报一个警告
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
    /**
   * 两件事
   *   1、判重处理，data 对象上的属性不能和 props、methods 对象上的属性相同
   *   2、代理 data 对象上的属性到 vm 实例
   */
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    // 判重处理，data 中的属性不能和 props 和 methods 中的属性重复
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      // 代理 data 中的属性到 vm 上，支持通过 this.dataKey 的形式访问
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  // 为 data 对象上的数据设置响应式
  observe(data, true /* asRootData */)
}

export function getData (data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget()
  try {
    return data.call(vm, vm)
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget()
  }
}

/**
 * 三件事：
 *   1、为 computed[key] 创建 watcher 实例，默认是懒执行
 *   2、代理 computed[key] 到 vm 实例
 *   3、判重，computed 中的 key 不能和 data、props 中的属性重复
 * @param {*} computed = {
 *   key1: function() { return xx },
 *   key2: {
 *     get: function() { return xx },
 *     set: function(val) {}
 *   }
 * }
 */

const computedWatcherOptions = { lazy: true }

function initComputed (vm: Component, computed: Object) {
  // $flow-disable-line
  const watchers = vm._computedWatchers = Object.create(null)
  // computed properties are just getters during SSR
  const isSSR = isServerRendering()

 // 遍历 computed 对象
  for (const key in computed) {
    // 获取 key 对应的值，即 getter 函数
    const userDef = computed[key]
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      // 为 computed 属性创建 watcher 实例
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        // 配置项，computed 默认是懒执行
        computedWatcherOptions
      )
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.
    if (!(key in vm)) {
      // 代理 computed 对象中的属性到 vm 实例
      // 这样就可以使用 vm.computedKey 访问计算属性了
      defineComputed(vm, key, userDef)
    } else if (process.env.NODE_ENV !== 'production') {
      // 非生产环境有一个判重处理，computed 对象中的属性不能和 data、props 中的属性相同
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      }
    }
  }
}

/**
 * 代理 computed 对象中的 key 到 target（vm）上
 */
export function defineComputed (
  target: any,
  key: string,
  userDef: Object | Function
) {
  const shouldCache = !isServerRendering()
  if (typeof userDef === 'function') {
      ? createComputedGetter(key)
      : createGetterInvoker(userDef)
    sharedPropertyDefinition.set = noop
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop
    sharedPropertyDefinition.set = userDef.set || noop
  }
  if (process.env.NODE_ENV !== 'production' &&
      sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  // 将 computed 配置项中的 key 代理到 vm 上，支持通过 this.computedKey 的方式去访问 computed 中属性
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

/**
 * @returns 返回一个函数，这个函数在访问 vm.computedProperty 时会被执行，然后返回执行结果
 */
function createComputedGetter (key) {
  // computed 属性值会缓存的原理也是在这里结合 watcher.dirty、watcher.evalaute、watcher.update 实现的
  return function computedGetter () {
    // 从 vm._computedWatchers 取到computed key 对应的 watcher
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      // 计算 key 对应的值，通过执行 computed.key 的回调函数来得到
      // watcher.dirty 属性就是大家常说的 computed 计算结果会缓存的原理
      // <template>
      //   <div>{{ computedProperty }}</div>
      //   <div>{{ computedProperty }}</div>
      // </template>
      // 像这种情况下，在页面的一次渲染中，两个 dom 中的 computedProperty 只有第一个
      // 会执行 computed.computedProperty 的回调函数计算实际的值，
      // 即执行 watcher.evalaute，而第二个就不走计算过程了，
      // 因为上一次执行 watcher.evalute 时把 watcher.dirty 置为了 false，
      // 待页面更新后，wathcer.update 方法会将 watcher.dirty 重新置为 true，
      // 供下次页面更新时重新计算 computed.key 的结果
      if (watcher.dirty) {

        watcher.evaluate()
      }
      if (Dep.target) {
        watcher.depend()
      }
      return watcher.value
    }
  }
}

function createGetterInvoker(fn) {
  return function computedGetter () {
    return fn.call(this, this)
  }
}

/**
 * 做了以下三件事，其实最关键的就是第三件事情
 *   1、校验 methoss[key]，必须是一个函数
 *   2、判重
 *         methods 中的 key 不能和 props 中的 key 相同
 *         methos 中的 key 与 Vue 实例上已有的方法重叠，一般是一些内置方法，比如以 $ 和 _ 开头的方法
 *   3、将 methods[key] 放到 vm 实例上，得到 vm[key] = methods[key]
 */
function initMethods (vm: Component, methods: Object) {
  // 获取 props 配置项
  const props = vm.$options.props
    // 遍历 methods 对象
  for (const key in methods) {
    if (process.env.NODE_ENV !== 'production') {
      if (typeof methods[key] !== 'function') {
        warn(
          `Method "${key}" has type "${typeof methods[key]}" in the component definition. ` +
          `Did you reference the function correctly?`,
          vm
        )
      }
      if (props && hasOwn(props, key)) {
        warn(
          `Method "${key}" has already been defined as a prop.`,
          vm
        )
      }
      if ((key in vm) && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
          `Avoid defining component methods that start with _ or $.`
        )
      }
    }
    // 把 methods 上所有 key 代理到 vm 上，通过 this.methodsKey 的方式访问到 定义的方法
    vm[key] = typeof methods[key] !== 'function' ? noop : bind(methods[key], vm)
  }
}

/**
 * 处理 watch 对象的入口，做了两件事：
 *   1、遍历 watch 对象
 *   2、调用 createWatcher 函数
 * @param {*} watch = {
 *   'key1': function(val, oldVal) {},
 *   'key2': 'this.methodName',
 *   'key3': {
 *     handler: function(val, oldVal) {},
 *     deep: true
 *   },
 *   'key4': [
 *     'this.methodNanme',
 *     function handler1() {},
 *     {
 *       handler: function() {},
 *       immediate: true
 *     }
 *   ],
 *   'key.key5' { ... }
 * }
 */
function initWatch (vm: Component, watch: Object) {
  // 遍历 watch 配置项
  for (const key in watch) {
    const handler = watch[key]
    if (Array.isArray(handler)) {
      // handler 为数组，遍历数组，获取其中的每一项，然后调用 createWatcher
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}

/**
 * 两件事：
 *   1、兼容性处理，保证 handler 肯定是一个函数
 *   2、调用 $watch
 * @returns
 */
function createWatcher (
  vm: Component,
  expOrFn: string | Function,
  handler: any,
  options?: Object
) {
    // 如果 handler 为对象，则获取其中的 handler 选项的值
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }
  // 如果 hander 为字符串，则说明是一个 methods 方法，获取 vm[handler]
  if (typeof handler === 'string') {
    handler = vm[handler]
  }
  return vm.$watch(expOrFn, handler, options)
}

export function stateMixin (Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {}
  dataDef.get = function () { return this._data }
  const propsDef = {}
  propsDef.get = function () { return this._props }
  if (process.env.NODE_ENV !== 'production') {
    dataDef.set = function () {
      warn(
        'Avoid replacing instance root $data. ' +
        'Use nested data properties instead.',
        this
      )
    }
    propsDef.set = function () {
      warn(`$props is readonly.`, this)
    }
  }
  Object.defineProperty(Vue.prototype, '$data', dataDef)
  Object.defineProperty(Vue.prototype, '$props', propsDef)

  Vue.prototype.$set = set
  Vue.prototype.$delete = del

/**
 * 创建 watcher，返回 unwatch，共完成如下 5 件事：
 *   1、兼容性处理，保证最后 new Watcher 时的 cb 为函数
 *   2、标示用户 watcher
 *   3、创建 watcher 实例
 *   4、如果设置了 immediate，则立即执行一次 cb
 *   5、返回 unwatch
 * @param {*} expOrFn key
 * @param {*} cb 回调函数
 * @param {*} options 配置项，用户直接调用 this.$watch 时可能会传递一个 配置项
 * @returns 返回 unwatch 函数，用于取消 watch 监听
 */
  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this
    // 兼容性处理，因为用户调用 vm.$watch 时设置的 cb 可能是对象
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
    // options.user 表示是用户 watcher，还有渲染 watcher，即 updateComponent 方法中实例化的 watcher
    options = options || {}
    options.user = true
    // 创建 watcher
    const watcher = new Watcher(vm, expOrFn, cb, options)
    if (options.immediate) { // 设置了 immediate 为 true，则直接会执⾏回调函数cb
      try {
        cb.call(vm, watcher.value)
      } catch (error) {
        handleError(error, vm, `callback for immediate watcher "${watcher.expression}"`)
      }
    }
    // 返回一个 unwatch 函数，用于解除监听
    return function unwatchFn () {
      watcher.teardown()
    }
  }
}
