/* @flow */

import {
  warn,
  once,
  isDef,
  isUndef,
  isTrue,
  isObject,
  hasSymbol,
  isPromise,
  remove
} from 'core/util/index'

import { createEmptyVNode } from 'core/vdom/vnode'
import { currentRenderingInstance } from 'core/instance/render'

function ensureCtor (comp: any, base) { // 从工厂函数调用 resolve 传回的 res 中提取出组件对象，因为 res 可能是 commonjs 引入也有可能是 import 引入
  if (
    comp.__esModule ||
    (hasSymbol && comp[Symbol.toStringTag] === 'Module')
  ) { // es6 模块语法
    comp = comp.default
  }
  return isObject(comp)
    ? base.extend(comp)
    : comp
    // 如果是个对象，直接调用 Vue.extend 生成子组件 Sub 构造函数返回，否则直接返回
}

export function createAsyncPlaceholder (
  factory: Function,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag: ?string
): VNode { // 创建一个空 vnode 保存工厂函数和一些元信息
  const node = createEmptyVNode()
  node.asyncFactory = factory
  node.asyncMeta = { data, context, children, tag }
  return node
}

export function resolveAsyncComponent (
  factory: Function,
  baseCtor: Class<Component>
): Class<Component> | void {
  if (isTrue(factory.error) && isDef(factory.errorComp)) { // 如果 factory.error 标记开启了，并且有 error 组件，那么返回 error 组件去渲染
    return factory.errorComp
  }

  if (isDef(factory.resolved)) { // forceRender 后第二次走到这里已经有 factory.resolved 了，直接返回
    return factory.resolved
  }

  const owner = currentRenderingInstance
  if (owner && isDef(factory.owners) && factory.owners.indexOf(owner) === -1) {
    // already pending
    factory.owners.push(owner)
  }

  if (isTrue(factory.loading) && isDef(factory.loadingComp)) { // 如果 loading 标记开启，返回 loading 组件去渲染
    return factory.loadingComp
  }

  if (owner && !isDef(factory.owners)) {
    const owners = factory.owners = [owner]
    let sync = true
    let timerLoading = null
    let timerTimeout = null

    ;(owner: any).$on('hook:destroyed', () => remove(owners, owner))

    const forceRender = (renderCompleted: boolean) => {
      for (let i = 0, l = owners.length; i < l; i++) {
        //遍历 owners ，调用实例的 $forceUpdate 强制重新渲染当前实例，然后就又会走到 _render ==> createElement ==> createComponent, 然后走到 resolveAsyncComponent 方法，这时候第二次就已经有 factory.resolved 了，直接返回，作为这个异步组件的构造器去生成对应的 vnode，然后当 vnode patch 的时候生成实例，然后生成 dom
        (owners[i]: any).$forceUpdate()
      }

      if (renderCompleted) {
        owners.length = 0
        if (timerLoading !== null) {
          clearTimeout(timerLoading)
          timerLoading = null
        }
        if (timerTimeout !== null) {
          clearTimeout(timerTimeout)
          timerTimeout = null
        }
      }
    }

    const resolve = once((res: Object | Class<Component>) => {
      // 当工厂函数被调用后，过了一段时间（因为是异步的）resolve会被触发

      // cache resolved
      factory.resolved = ensureCtor(res, baseCtor)
      // res 就是工厂函数里调用 resolve 传入的组件对象，利用 ensureCtor 处理一下，拿到组件的构造函数，存到 factory.resolved 上
      // invoke callbacks only if this is not a synchronous resolve
      // (async resolves are shimmed as synchronous during SSR)
      if (!sync) { // 这里开关已经变成 false 了，因为下面的同步代码已经改变这个变量了
        // 调用 forceRender
        forceRender(true)
      } else {
        owners.length = 0
      }
    })

    const reject = once(reason => {
      process.env.NODE_ENV !== 'production' && warn(
        `Failed to resolve async component: ${String(factory)}` +
        (reason ? `\nReason: ${reason}` : '')
      )
      if (isDef(factory.errorComp)) { // 如果定义了 error 组件，factory.error 开启，然后调用 forceRender 重新渲染
        factory.error = true
        forceRender(true)
      }
    })

    // resolve 和 reject 都用 once 处理过，once 使用闭包保证这个被处理的函数只能被调用一次
    // 工厂函数中的 resolve 和 reject 只能被调用一次
    const res = factory(resolve, reject)
    // 调用 factory ，也就是用 Vue.component 注册异步组件时传入的 工厂函数

    // 如果使用的是返回一个 promise 的形式，就回来处理 res 返回值
    if (isObject(res)) {
      if (isPromise(res)) {
        // 如果 res 是个 promise，那么调用它的 then，传入 resolve 和 reject 处理，之后 resolve 逻辑和工厂函数模式一样
        // () => Promise
        if (isUndef(factory.resolved)) {
          res.then(resolve, reject)
        }
      } else if (isPromise(res.component)) { // 高级异步组件返回的对象中的 componnet 属性是import()引入的组件，是个 promise
        res.component.then(resolve, reject) // 调用它的then，传入 resolve 和 reject 处理，之后 resolve 逻辑和工厂函数模式一样

        if (isDef(res.error)) { // 如果传递了 error 组件，就调用 ensureCtor 将其转化成一个构造器，然后存在 factory.errorComp 上
          factory.errorComp = ensureCtor(res.error, baseCtor)
        }

        if (isDef(res.loading)) {
          factory.loadingComp = ensureCtor(res.loading, baseCtor)
          // 如果传递了 loading 组件，调用 ensureCtor 将其转化成构造器，存在 factory.loadingComp 上
          if (res.delay === 0) { // 如果 loading 组件延迟显示时间为 0，就把  factory.loading 标记改成 true
            factory.loading = true
          } else { // 否则就存下一个定时器，时间为传入的 delay 参数，等到 delay 时间过去后，修改 factory.loading 标记，然后触发 forceRender
            timerLoading = setTimeout(() => {
              timerLoading = null
              if (isUndef(factory.resolved) && isUndef(factory.error)) {
                factory.loading = true
                forceRender(false)
              }
            }, res.delay || 200)
          }
        }

        if (isDef(res.timeout)) { // 如果提供了超时时间 timeout，存下超时时间定时器，timeout 时间过去后，如果factory.resolved 缓存的组件构造器还没有生成，调用 reject 方法
          timerTimeout = setTimeout(() => {
            timerTimeout = null
            if (isUndef(factory.resolved)) {
              reject(
                process.env.NODE_ENV !== 'production'
                  ? `timeout (${res.timeout}ms)`
                  : null
              )
            }
          }, res.timeout)
        }
      }
    }

    sync = false
    // return in case resolved synchronously
    // 第一次同步代码返回了 undefined
    // 如果loading 状态开启了，直接返回 loading 组件去渲染
    return factory.loading
      ? factory.loadingComp
      : factory.resolved
  }
}
