/* @flow */

import config from '../config'
import Watcher from '../observer/watcher'
import { mark, measure } from '../util/perf'
import { createEmptyVNode } from '../vdom/vnode'
import { updateComponentListeners } from './events'
import { resolveSlots } from './render-helpers/resolve-slots'
import { toggleObserving } from '../observer/index'
import { pushTarget, popTarget } from '../observer/dep'

import {
  warn,
  noop,
  remove,
  emptyObject,
  validateProp,
  invokeWithErrorHandling
} from '../util/index'

export let activeInstance: any = null // 定义了全局变量 activeInstance
export let isUpdatingChildComponent: boolean = false

export function setActiveInstance(vm: Component) { // 为全局变量 activeInstance 赋值
  const prevActiveInstance = activeInstance // 存下上一个 activeInstance
  activeInstance = vm // 赋值当前 vm 为 activeInstance
  return () => {
    activeInstance = prevActiveInstance
  }
}

// Vue 给我们提供了 parent 选项，使得我们可以手动指定一个组件的父实例，但在一般情况下我们并不会手动指定 parent 选项，但是子组件依然能够正确地找到它的父实例，这说明 Vue 在寻找父实例的时候是自动检测的。
export function initLifecycle (vm: Component) {
  // 定义 options，它是 vm.$options 的引用，后面的代码使用的都是 options 常量
  const options = vm.$options

  // locate first non-abstract parent (查找第一个非抽象的父组件)
// 定义 parent，它引用当前实例的父实例
  let parent = options.parent
  // 如果当前实例有父组件，且当前实例不是抽象的
  // 抽象组件就是不渲染 dom 的组件：例如 keep-alive 或者 transition，他们也不会出现在父子关系的路径上
  // 这里下面循环去找上层的真正父级实例（非抽象的）的原因是要将当前实例添加到父级的 $children 属性里
  if (parent && !options.abstract) {
    // 使用 while 循环查找第一个非抽象的父组件
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent
    }
    // 经过上面的 while 循环后，parent 应该是一个非抽象的组件，将它作为当前实例的父级，所以将当前实例 vm 添加到父级的 $children 属性里
    parent.$children.push(vm)
  }

// 设置当前实例的 $parent 属性，指向父级
  vm.$parent = parent
  // 设置 $root 属性，有父级就是用父级的 $root，否则 $root 指向自身
  vm.$root = parent ? parent.$root : vm
  // 上面代码的作用：将当前实例添加到父实例的 $children 属性里，并设置当前实例的 $parent 指向父实例


  vm.$children = []
  vm.$refs = {}

  vm._watcher = null
  vm._inactive = null
  vm._directInactive = false
  vm._isMounted = false
  vm._isDestroyed = false
  vm._isBeingDestroyed = false
}

export function lifecycleMixin (Vue: Class<Component>) {

  /**
 * 负责更新页面，页面首次渲染和后续更新的入口位置，也是 patch 的入口位置
 */
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this
    const prevEl = vm.$el
    const prevVnode = vm._vnode
    const restoreActiveInstance = setActiveInstance(vm)
    vm._vnode = vnode
    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.
    if (!prevVnode) {
      // initial render
      // 首次渲染，即初始化页面时走这里
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */)
    } else {
      // updates
    // 响应式数据更新时，即更新页面时走这里
      vm.$el = vm.__patch__(prevVnode, vnode)
    }
    restoreActiveInstance()
    // update __vue__ reference
    if (prevEl) {
      prevEl.__vue__ = null
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm
    }
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  }

  /**
 * 直接调用 watcher.update 方法，迫使组件重新渲染。
 * 它仅仅影响实例本身和插入插槽内容的子组件，而不是所有子组件
 */
  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this
    if (vm._watcher) {
      vm._watcher.update() // 调用实例的渲染 watcher 的 update 方法强制去重新渲染一次
    }
  }

  /**
 * 完全销毁一个实例。清理它与其它实例的连接，解绑它的全部指令及事件监听器。
 */
  Vue.prototype.$destroy = function () {
    const vm: Component = this
    if (vm._isBeingDestroyed) {
      // 表示实例已经销毁
      return
    }
    // 调用 beforeDestroy 钩子
    callHook(vm, 'beforeDestroy')
    // 标识实例已经销毁
    vm._isBeingDestroyed = true
    // remove self from parent
  // 把自己从老爹（$parent)的肚子里（$children）移除
    const parent = vm.$parent
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm)
    }
    // teardown watchers
  // 移除依赖监听
    if (vm._watcher) {
      vm._watcher.teardown()
    }
    let i = vm._watchers.length
    while (i--) {
      vm._watchers[i].teardown()
    }
    // remove reference from data ob
    // frozen object may not have observer.
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--
    }
    // call the last hook...
    vm._isDestroyed = true
    // invoke destroy hooks on current rendered tree
  // 调用 __patch__，销毁节点
    vm.__patch__(vm._vnode, null)
    // fire destroyed hook
  // 调用 destroyed 钩子
    callHook(vm, 'destroyed')
    // turn off all instance listeners.
  // 关闭实例的所有事件监听
    vm.$off()
    // remove __vue__ reference
    if (vm.$el) {
      vm.$el.__vue__ = null
    }
    // release circular reference (#6759)
    if (vm.$vnode) {
      vm.$vnode.parent = null
    }
  }
}

export function mountComponent (
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  vm.$el = el // el 挂到实例的 $el 上
  if (!vm.$options.render) { // 如果经过解析后还是没有 render 方法
    vm.$options.render = createEmptyVNode // 就让 render 方法是生成空节点的方法
    if (process.env.NODE_ENV !== 'production') { // 然后报错误信息
      /* istanbul ignore if */
      if ((vm.$options.template && vm.$options.template.charAt(0) !== '#') ||
        vm.$options.el || el) { // 如果提供了 template 或者 el 参数，却没有生成 render 方法，说明是 runtime only 的版本
        warn(
          'You are using the runtime-only build of Vue where the template ' +
          'compiler is not available. Either pre-compile the templates into ' +
          'render functions, or use the compiler-included build.',
          vm
        )
      } else {
        warn(
          'Failed to mount component: template or render function not defined.',
          vm
        )
      }
    }
  }
  callHook(vm, 'beforeMount')

  let updateComponent
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
    updateComponent = () => {// 如果开启了 performance 性能追踪模式
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`

      mark(startTag)
      const vnode = vm._render() // 调用 _render 生成 vnode
      mark(endTag)
      measure(`vue ${name} render`, startTag, endTag)

      mark(startTag)
      vm._update(vnode, hydrating) // 调用 _update 将 vnode 变成真正的 dom
      mark(endTag)
      measure(`vue ${name} patch`, startTag, endTag)
    }
  } else {
    updateComponent = () => {
      vm._update(vm._render(), hydrating) // 调用 _update 将 vnode 变成真正的 dom
    }
  }

  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined
  // 将 updateComponent 传递给 Watcher 构造函数，每次数据改变视图需要更新的时候都会被 wacher 发现然后调用 updateComponent ，然后调用 _render() 生成新的 vnode，然后 _update 更新视图
  new Watcher(vm, updateComponent, noop, {
    before () {
      if (vm._isMounted && !vm._isDestroyed) {
        callHook(vm, 'beforeUpdate')
      }
    }
  }, true /* isRenderWatcher */) // 渲染 watcher
  hydrating = false

  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook
  if (vm.$vnode == null) {
    vm._isMounted = true
    callHook(vm, 'mounted')
  }
  return vm
}

export function updateChildComponent (
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  if (process.env.NODE_ENV !== 'production') {
    isUpdatingChildComponent = true
  }

  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren.

  // check if there are dynamic scopedSlots (hand-written or compiled but with
  // dynamic slot names). Static scoped slots compiled from template has the
  // "$stable" marker.
  const newScopedSlots = parentVnode.data.scopedSlots
  const oldScopedSlots = vm.$scopedSlots
  const hasDynamicScopedSlot = !!(
    (newScopedSlots && !newScopedSlots.$stable) ||
    (oldScopedSlots !== emptyObject && !oldScopedSlots.$stable) ||
    (newScopedSlots && vm.$scopedSlots.$key !== newScopedSlots.$key)
  )

  // Any static slot children from the parent may have changed during parent's
  // update. Dynamic scoped slots may also have changed. In such cases, a forced
  // update is necessary to ensure correctness.
  const needsForceUpdate = !!(
    renderChildren ||               // has new static slots
    vm.$options._renderChildren ||  // has old static slots
    hasDynamicScopedSlot
  )

  vm.$options._parentVnode = parentVnode
  vm.$vnode = parentVnode // update vm's placeholder node without re-render

  if (vm._vnode) { // update child tree's parent
    vm._vnode.parent = parentVnode
  }
  vm.$options._renderChildren = renderChildren

  // update $attrs and $listeners hash
  // these are also reactive so they may trigger child update if the child
  // used them during render
  vm.$attrs = parentVnode.data.attrs || emptyObject
  vm.$listeners = listeners || emptyObject

  // update props
  if (propsData && vm.$options.props) {
    toggleObserving(false)
    const props = vm._props
    const propKeys = vm.$options._propKeys || []
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i]
      const propOptions: any = vm.$options.props // wtf flow?
      props[key] = validateProp(key, propOptions, propsData, vm)
    }
    toggleObserving(true)
    // keep a copy of raw propsData
    vm.$options.propsData = propsData
  }

  // update listeners
  listeners = listeners || emptyObject
  const oldListeners = vm.$options._parentListeners
  vm.$options._parentListeners = listeners
  updateComponentListeners(vm, listeners, oldListeners)

  // resolve slots + force update if has children
  if (needsForceUpdate) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context)
    vm.$forceUpdate()
  }

  if (process.env.NODE_ENV !== 'production') {
    isUpdatingChildComponent = false
  }
}

function isInInactiveTree (vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true
  }
  return false
}

export function activateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false
    if (isInInactiveTree(vm)) {
      return
    }
  } else if (vm._directInactive) {
    return
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i])
    }
    callHook(vm, 'activated')
  }
}

export function deactivateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true
    if (isInInactiveTree(vm)) {
      return
    }
  }
  if (!vm._inactive) {
    vm._inactive = true
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i])
    }
    callHook(vm, 'deactivated')
  }
}

/**
 * callHook(vm, 'mounted')
 * 执行实例指定的生命周期钩子函数
 * 如果实例设置有对应的 Hook Event，比如：<comp @hook:mounted="method" />，执行完生命周期函数之后，触发该事件的执行
 * @param {*} vm 组件实例
 * @param {*} hook 生命周期钩子函数
 */
export function callHook (vm: Component, hook: string) {
  // 在执行生命周期钩子函数期间禁止依赖收集
  // #7573 disable dep collection when invoking lifecycle hooks
  pushTarget()
  // 从实例配置对象中获取指定钩子函数，比如 mounted
  const handlers = vm.$options[hook]
  const info = `${hook} hook`
  if (handlers) {
    // 通过 invokeWithErrorHandler 执行生命周期钩子
    for (let i = 0, j = handlers.length; i < j; i++) {
      invokeWithErrorHandling(handlers[i], vm, null, vm, info)
    }
  }
   // Hook Event，如果设置了 Hook Event，比如 <comp @hook:mounted="method" />，则通过 $emit 触发该事件
  // vm._hasHookEvent 标识组件是否有 hook event，这是在 vm.$on 中处理组件自定义事件时设置的
  /**
   * <child
        @hook:beforeCreate="handleChildBeforeCreate"
        @hook:created="handleChildCreated"
        @hook:mounted="handleChildMounted"
        @hook:生命周期钩子
      />
   */
  if (vm._hasHookEvent) {
    vm.$emit('hook:' + hook)
  }
  // 恢复依赖收集
  popTarget()
}
