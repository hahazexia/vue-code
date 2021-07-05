/* not type checking this file because flow doesn't play well with Proxy */

import config from 'core/config'
import { warn, makeMap, isNative } from '../util/index'

let initProxy

if (process.env.NODE_ENV !== 'production') {
  const allowedGlobals = makeMap(
    'Infinity,undefined,NaN,isFinite,isNaN,' +
    'parseFloat,parseInt,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,' +
    'Math,Number,Date,Array,Object,Boolean,String,RegExp,Map,Set,JSON,Intl,' +
    'require' // for Webpack/Browserify
  )

  // 警告信息：在渲染的时候引用了 key，但是在实例对象上并没有定义 key 这个属性或方法
  const warnNonPresent = (target, key) => {
    warn(
      `Property or method "${key}" is not defined on the instance but ` +
      'referenced during render. Make sure that this property is reactive, ' +
      'either in the data option, or for class-based components, by ' +
      'initializing the property. ' +
      'See: https://vuejs.org/v2/guide/reactivity.html#Declaring-Reactive-Properties.',
      target
    )
  }

  const warnReservedPrefix = (target, key) => {
    warn(
      `Property "${key}" must be accessed with "$data.${key}" because ` +
      'properties starting with "$" or "_" are not proxied in the Vue instance to ' +
      'prevent conflicts with Vue internals. ' +
      'See: https://vuejs.org/v2/api/#data',
      target
    )
  }

  const hasProxy =
    typeof Proxy !== 'undefined' && isNative(Proxy)

  if (hasProxy) {
    // 检测给定的值是否是内置的事件修饰符
    const isBuiltInModifier = makeMap('stop,prevent,self,ctrl,shift,alt,meta,exact')
    config.keyCodes = new Proxy(config.keyCodes, {
      // 给 config.keyCodes 设置了 set 代理，其目的是防止开发者在自定义键位别名的时候，覆盖了内置的修饰符
      set (target, key, value) {
        if (isBuiltInModifier(key)) {
          warn(`Avoid overwriting built-in modifier in config.keyCodes: .${key}`)
          return false
        } else {
          target[key] = value
          return true
        }
      }
    })
  }

  // Proxy 的 has 可以处理以下操作：
  // 属性查询: foo in proxy
  // 继承属性查询: foo in Object.create(proxy)
  // with 检查: with(proxy) { (foo); }
  // Reflect.has()

  const hasHandler = {
    has (target, key) {
      // has 常量是真实经过 in 运算符得来的结果
      const has = key in target
      // 如果 key 在 allowedGlobals 之内，或者 key 是以下划线 _ 开头的字符串，则为真
      const isAllowed = allowedGlobals(key) ||
        (typeof key === 'string' && key.charAt(0) === '_' && !(key in target.$data))
      // if 语句的判断条件是 (!has && !isAllowed)，其中 !has 我们可以理解为你访问了一个没有定义在实例对象上(或原型链上)的属性，所以这个时候提示错误信息是合理，但是即便 !has 成立也不一定要提示错误信息，因为必须要满足 !isAllowed，也就是说当你访问了一个虽然不在实例对象上(或原型链上)的属性，但如果你访问的是全局对象那么也是被允许的。这样我们就可以在模板中使用全局对象了
      /**
       * 例如这样使用了全局的 Number
       *<template>
          {{Number(b) + 2}}
        </template>
       */
      // 除了允许使用全局对象之外，还允许以 _ 开头的属性，这么做是由于渲染函数中会包含很多以 _ 开头的内部方法，如之前我们查看渲染函数时遇到的 _c、_v 等等

      if (!has && !isAllowed) {
        // Proxy 拦截 如果 key 不存在，并且也不是全局属性，并且不是_开头的内部属性
        // 如果属性在 $data 上存在，说明这是个 $ 或者 _ 开头的属性，需要使用 $data.key 方式获取
        // 否则说明这个属性不存在，忘记定义了
        if (key in target.$data) warnReservedPrefix(target, key)
        else warnNonPresent(target, key)
      }
      return has || !isAllowed
    }
  }

  // 其实 _withStripped 只在 test/unit/features/instance/render-proxy.spec.js 文件中出现过
  /**
   * it('should warn missing property in render fns without `with`', () => {
        const render = function (h) {
            // 这里访问了 a
            return h('div', [this.a])
        }
        // 在这里将 render._withStripped 设置为 true
        render._withStripped = true
        new Vue({
            render
        }).$mount()
        // 应该得到警告
        expect(`Property or method "a" is not defined`).toHaveBeenWarned()
    })
   */
  // 其最终实现的效果无非就是检测到访问的属性不存在就给你一个警告。但我们也提到了，只有当 render 函数的 _withStripped 为真的时候，才会给出警告，但是 render._withStripped 又只有写测试的时候出现过，也就是说需要我们手动设置其为 true 才会得到提示，否则是得不到的
  // 上面的代码由于 render 函数是我们手动书写的，所以 render 函数并不会被包裹在 with 语句块内，当然也就触发不了 has 拦截，但是由于 render._withStripped 也未定义，所以也不会被 get 拦截，那这个时候我们虽然访问了不存在的 this.a，但是却得不到警告，想要得到警告我们需要手动设置 render._withStripped 为 true

  // 为什么会这么设计呢？因为在使用 webpack 配合 vue-loader 的环境中， vue-loader 会借助 vuejs@component-compiler-utils 将 template 编译为不使用 with 语句包裹的遵循严格模式的 JavaScript，并为编译后的 render 方法设置 render._withStripped = true。在不使用 with 语句的 render 方法中，模板内的变量都是通过属性访问操作 vm['a'] 或 vm.a 的形式访问的，从前文中我们了解到 Proxy 的 has 无法拦截属性访问操作，所以这里需要使用 Proxy 中可以拦截到属性访问的 get，同时也省去了 has 中的全局变量检查(全局变量的访问不会被 get 拦截)。

  // 现在，我们基本知道了 initProxy 的目的，就是设置渲染函数的作用域代理，其目的是为我们提供更好的提示信息。

  const getHandler = {
    get (target, key) {
      if (typeof key === 'string' && !(key in target)) {
        if (key in target.$data) warnReservedPrefix(target, key)
        else warnNonPresent(target, key)
      }
      return target[key]
    }
  }

  // 开发环境下为添加 vm._renderProxy 属性
  // 打开 core/instance/render.js 文件，找到 Vue.prototype._render 方法，里面有这样的代码：
  // vnode = render.call(vm._renderProxy, vm.$createElement)
  // 可以看到调用 render 函数的时候，使用 call 方法指定了函数的执行环境为 vm._renderProxy
  // 而 render 函数长下面这个样子：
  /**
   * vm.$options.render = function () {
          // render 函数的 this 指向实例的 _renderProxy
          with(this){
              return _c('div', [_v(_s(a))])   // 在这里访问 a，相当于访问 vm._renderProxy.a
          }
      }
   */

  // 显然函数使用 with 语句块指定了内部代码的执行环境为 this，由于 render 函数调用的时候使用 call 指定了其 this 指向为 vm._renderProxy，所以 with 语句块内代码的执行环境就是 vm._renderProxy，所以在 with 语句块内访问 a 就相当于访问 vm._renderProxy 的 a 属性，前面我们提到过 with 语句块内访问变量将会被 Proxy 的 has 代理所拦截，所以自然就执行了 has 函数内的代码。最终通过 warnNonPresent 打印警告信息给我们，所以这个代理的作用就是为了在开发阶段给我们一个友好而准确的提示。


  initProxy = function initProxy (vm) {
    if (hasProxy) { // 判断浏览器是否原生支持 Proxy 对象
      // determine which proxy handler to use
        // options 就是 vm.$options 的引用
      const options = vm.$options
      // handlers 可能是 getHandler 也可能是 hasHandler
      // options.render._withStripped 只在测试代码中出现过，所以 handlers 会使用 hasHandler
      const handlers = options.render && options.render._withStripped
        ? getHandler
        : hasHandler
      // 代理 vm 对象
      vm._renderProxy = new Proxy(vm, handlers)
    } else {
      vm._renderProxy = vm
    }
  }
}

export { initProxy }
