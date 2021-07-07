/* @flow */

import Dep from './dep'
import VNode from '../vdom/vnode'
import { arrayMethods } from './array'
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering
} from '../util/index'

const arrayKeys = Object.getOwnPropertyNames(arrayMethods)

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
/**
 * 观察者类，会被附加到每个被观察的对象上，value.__ob__ = this
 * 而对象的各个属性则会被转换成 getter/setter，并收集依赖和通知更新
 */
/**
 * const data = {
      a: 1
    }

    这样的对象被 Observer 处理后，变成如下

    const data = {
      a: 1,
      // __ob__ 是不可枚举的属性
      __ob__: {
        value: data, // value 属性指向 data 数据对象本身，这是一个循环引用
        dep: dep实例对象, // new Dep()
        vmCount: 0
      }
    }

 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor (value: any) {
    this.value = value
    // 这个 dep 负责对象变更通知，新增或删除属性，也就是 $set 和 $delete 之后手动调用 ob.dep.notify()
    this.dep = new Dep()
    this.vmCount = 0
    // 在 value 对象上设置 __ob__ 属性，enumerable 为 false，保证这个私有属性不会被 this.walk 遍历到
    def(value, '__ob__', this)

    if (Array.isArray(value)) {
      /**
       * value 为数组
       * hasProto = '__proto__' in {}
       * 用于判断对象是否存在 __proto__ 属性，通过 obj.__proto__ 可以访问对象的原型链
       * 但由于 __proto__ 不是标准属性，所以有些浏览器不支持，比如 IE6-10，Opera10.1
       * 为什么要判断，是因为一会儿要通过 __proto__ 操作数据的原型链
       * 覆盖数组默认的七个原型方法，以实现数组响应式
       */
      if (hasProto) {
        protoAugment(value, arrayMethods)
      } else {
        copyAugment(value, arrayMethods, arrayKeys)
      }
      this.observeArray(value)
    } else {
      // value 为对象，调用 this.walk 为对象的每个属性（包括嵌套对象）设置响应式
      this.walk(value)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  /**
   * 遍历对象上的每个可枚举的 key，为每个 key 设置响应式
   * 仅当值为对象时才会走这里
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
    /**
   * 遍历数组，为数组的每一项设置观察，处理数组元素为对象的情况
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
// 用增强的数组原型方法覆盖默认的原型方法，之后再执行那七个改变数组自身的方法时就具有了依赖通知更新的能力，以达到数组响应式的目的
function protoAugment (target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
//将增强的数组方法直接用 Object.defineProperty定义到数组上
function copyAugment (target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
/**
 * 响应式处理的真正入口
 * 为对象创建观察者实例，如果对象已经被观察过，则返回已有的观察者实例，否则创建新的观察者实例
 * @param {*} value 对象 => {}
 * @param asRootData 是否是根上的数据，所谓的根数据对象就是 data 对象
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    // 非对象和 VNode 实例不做响应式处理
    return
  }
  let ob: Observer | void

  // 如果 value 对象上存在 __ob__ 属性，则表示已经做过观察了，直接返回 __ob__ 属性
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    // 这些条件都满足的情况下才会创建 Observer 实例
    // shouldObserve 开关打开
    // !isServerRendering() 不是服务端渲染
    // (Array.isArray(value) || isPlainObject(value)) value 是对象或者数组
    // Object.isExtensible(value) value 必须是可扩展的。三个方法都可以使得一个对象变得不可扩展：Object.preventExtensions()、Object.freeze() 以及 Object.seal()
    // !value._isVue value不是 vue 实例

    // 创建观察者实例
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}

/**
 * Define a reactive property on an Object.
 */
/**
 * 拦截 obj[key] 的读取和设置操作：
 *   1、在第一次读取时收集依赖，比如执行 render 函数生成虚拟 DOM 时会有读取操作
 *   2、在更新时设置新值并通知依赖更新
 */
// shallow 参数，是否深度监测
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // 实例化 dep，一个 key 一个 dep
  const dep = new Dep()

  // 获取 obj[key] 的属性描述符，发现它是不可配置对象的话直接 return
  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  // 记录原始 getter 和 setter，获取 val 值
  //一个对象的属性很可能已经是一个访问器属性了，所以该属性很可能已经存在 get 或 set 方法。由于接下来会使用 Object.defineProperty 函数重新定义属性的 setter/getter，这会导致属性原有的 set 和 get 方法被覆盖，所以要将属性原有的 setter/getter 缓存，并在重新定义的 set 和 get 方法中调用缓存的函数，从而做到不影响属性的原有读写操作。

  const getter = property && property.get
  const setter = property && property.set

  // https://github.com/vuejs/vue/pull/7302
  // 为什么要这样判断：(!getter || setter)
  // 因为有可能用户定义的 data 中的属性原本就是拥有 getter 的，如下：
  /**
   *  const data = {}
      Object.defineProperty(data, 'getterProp', {
        enumerable: true,
        configurable: true,
        get: () => {
          return {
            a: 1
          }
        }
      })

      const ins = new Vue({
        data,
        watch: {
          'getterProp.a': () => {
            console.log('这句话不会输出')
          }
        }
      })

      属性 getterProp 是一个拥有 get 拦截器函数的访问器属性，而当 Vue 发现该属性拥有原本的 getter 时，是不会深度观测的。

      那么为什么当属性拥有自己的 getter 时就不会对其深度观测了呢？有两方面的原因，
      第一：由于当属性存在原本的 getter 时在深度观测之前不会取值，所以在深度观测语句执行之前取不到属性值从而无法深度观测。
      第二：之所以在深度观测之前不取值是因为属性原本的 getter 由用户定义，用户可能在 getter 中做任何意想不到的事情，这么做是出于避免引发不可预见行为的考虑。

   */
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }
  // 递归调用，处理 val 即 obj[key] 的值为对象的情况，保证对象中的所有 key 都被观察
  let childOb = !shallow && observe(val)

  /**
   *
    const data = {
      a: {
        b: 1
      }
    }
    observe(data)

    经过处理后变成如下数据：

    const data = {
      a: {
        b: 1
        __ob__: {a, dep, vmCount}
      }
      __ob__: {data, dep, vmCount}
    }

    // 属性 a 通过 setter/getter 通过闭包引用着 dep 和 childOb
    // 属性 b 通过 setter/getter 通过闭包引用着 dep 和 childOb
    // 这里需要注意 a 通过闭包引用的 childOb 就是 data.a.__ob__
    // 而 b 通过闭包引用的 childOb 是 undefined

   */
  // 响应式核心
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    // get 拦截对 obj[key] 的读取操作，做两件事：1.返回正确的属性值，2.收集依赖
    get: function reactiveGetter () {
      // 正确地返回属性值
      const value = getter ? getter.call(obj) : val
      /**
       * Dep.target 为 Dep 类的一个静态属性，值为 watcher，在实例化 Watcher 时会被设置
       * 实例化 Watcher 时会执行 new Watcher 时传递的回调函数（computed 除外，因为它懒执行）
       * 而回调函数中如果有 vm.key 的读取行为，则会触发这里的 读取 拦截，进行依赖收集
       * 回调函数执行完以后又会将 Dep.target 设置为 null，避免这里重复收集依赖
       */
      if (Dep.target) {
        // 依赖收集，在 dep 中添加 watcher，也在 watcher 中添加 dep
        dep.depend()
        // 对于上面举的例子，对于属性 a 来说，childOb 就是 data.a.__ob__
        // 所以 childOb.dep 就是 data.a.__ob__.dep
        // 也就是说依赖不仅要收集到 a 自己的 dep 里，也要收集到 a.__ob__.dep 里
        // 这样做的原因是因为 a.dep 和 a.__ob__.dep 里的依赖，触发更新的时机是不同的
        // 第一个触发的时机就是当 a 属性的值被改变的时候，即触发 a 的 setter 的 dep.notify()
        // 而第二个触发的时机是 $set 或 Vue.set 给对象添加新属性时触发

        /**
         * Vue.set(data.a, 'c', 1)
         * 这样设置新的属性 c 后，之所以可以触发更新，是因为其中触发了 data.a.__ob__.dep.notify()，Vue.set 代码简化后如下：
         *
         * Vue.set = function (obj, key, val) {
            defineReactive(obj, key, val)
            obj.__ob__.dep.notify()
          }

          所以 __ob__ 属性以及 __ob__.dep 的主要作用是为了添加、删除属性时有能力触发依赖更新，而这就是 Vue.set 或 Vue.delete 的原理。
         */
        if (childOb) {
          childOb.dep.depend()
          // 如果是 obj[key] 是 数组，则触发数组响应式
          if (Array.isArray(value)) {
            // 为数组项为对象的项添加依赖
            dependArray(value)
          }
        }
      }
      return value
    },
    // set 拦截对 obj[key] 的设置新值的操作，做了两件事：1.设置新值，2.触发依赖更新
    set: function reactiveSetter (newVal) {
      // 旧的 obj[key]
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      // 如果新老值一样，则直接 return，不触发响应式更新过程（判断了新老值都是 NaN 的情况）
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        // customSetter 用来打印辅助信息
        // initRender 中在定义 vm.$attrs 和 vm.$listeners 这两个属性的时候传递了这个参数
        customSetter()
      }
      // setter 不存在说明该属性是一个只读属性，直接 return
      // #7981: for accessor properties without setter
      if (getter && !setter) return
      // 设置新值
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      // 需要深度监测的时候，对新值进行观察，让新值也是响应式的，并且覆盖 childOb 为新的 __ob__ 对象
      childOb = !shallow && observe(newVal)
      // 当响应式数据更新时，依赖通知更新
      dep.notify()
    }
  })
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
/**
 * 通过 Vue.set 或者 this.$set 方法给 target 的指定 key 设置值 val
 * 如果 target 是对象，并且 key 原本不存在，则为新 key 设置响应式，然后执行依赖通知
 *
 * {
 *  data() {
 *    return {
 *      key1: val,
 *      arr: [1, 2, 3, { key: value }]
 *    }
 * },
 * methods: {
 *    change() {
 *      this.key2 = 'val'; // 这个不是响应式的
 *      Vue.set(this, 'key2', 'val'); // 这个是响应式的
 *      this.arr[3].key = 'new val' // 这个是响应式的
 *      this.arr[0] = 111; // 这个不是响应式的
 *      Vue.set(this.arr, 0, 111); // 这个是响应式的
 *    }
 * }
 * }
 */
export function set (target: Array<any> | Object, key: any, val: any): any {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }
  // 更新数组指定下标的元素，Vue.set(array, idx, val)，通过 splice 方法实现响应式更新
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key)
    target.splice(key, 1, val)
    return val
  }
  // 更新对象已有属性，Vue.set(obj, key, val)，执行更新即可
  // https://github.com/vuejs/vue/issues/6845#issuecomment-407390645
  if (key in target && !(key in Object.prototype)) {
    target[key] = val
    return val
  }
  const ob = (target: any).__ob__ // 获取到 target 对象的 __ob__ 属性（Observer 实例）

  // 不能向 Vue 实例或者 $data 动态添加响应式属性，vmCount 的用处之一，
  // this.$data 的 ob.vmCount = 1，表示根数据对象，其它嵌套的子对象的 ob.vmCount 都是 0
  // 根数据对象的 ob.vmCount = 1 ，当使用 Vue.set/$set 函数为根数据对象添加属性时，是不被允许的
  // 因为根数据对象并不是响应式的
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid adding reactive properties to a Vue instance or its root $data ' +
      'at runtime - declare it upfront in the data option.'
    )
    return val
  }
  // target 不是响应式对象，新属性会被设置，但是不会做响应式处理
  if (!ob) {
    target[key] = val
    return val
  }
  // 给对象定义新属性，通过 defineReactive 方法设置响应式，并触发依赖更新
  defineReactive(ob.value, key, val)
  ob.dep.notify()
  return val
}

/**
 * Delete a property and trigger change if necessary.
 */
/**
 * 通过 Vue.delete 或者 vm.$delete 删除 target 对象的指定 key
 * 数组通过 splice 方法实现，对象则通过 delete 运算符删除指定 key，并执行依赖通知
 */
export function del (target: Array<any> | Object, key: any) {
  if (process.env.NODE_ENV !== 'production' &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(`Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`)
  }

  // target 为数组，则通过 splice 方法删除指定下标的元素
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1)
    return
  }
  const ob = (target: any).__ob__
    // 避免删除 Vue 实例的属性或者 $data 的数据
    // 根数据对象不是响应式的，不会触发更新
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== 'production' && warn(
      'Avoid deleting properties on a Vue instance or its root $data ' +
      '- just set it to null.'
    )
    return
  }
  // 如果属性不存在直接结束
  if (!hasOwn(target, key)) {
    return
  }
  // 通过 delete 运算符删除对象的属性
  delete target[key]
  if (!ob) {
    return
  }
  // 执行依赖通知
  ob.dep.notify()
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
/**
 * 遍历每个数组元素，递归处理数组项为对象的情况，为其添加依赖
 * 因为前面的递归阶段无法为数组中的对象元素添加依赖
 */
function dependArray (value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i]
    e && e.__ob__ && e.__ob__.dep.depend()
    if (Array.isArray(e)) {
      dependArray(e)
    }
  }
}
