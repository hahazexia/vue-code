/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'
// 复写增强数组原型方法，使其具有依赖通知更新的能力
// 数组 原型对象
const arrayProto = Array.prototype
// 通过继承的方式创建新的 arrayMethods
export const arrayMethods = Object.create(arrayProto)

// 操作数组的七个方法，这七个方法可以改变数组自身
const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse'
]

/**
 * Intercept mutating methods and emit events
 */
/**
 * 拦截变异方法并触发事件
 */
methodsToPatch.forEach(function (method) {
  // cache original method
  const original = arrayProto[method]

  // def 就是 Object.defineProperty，拦截 arrayMethods.method 的访问
  def(arrayMethods, method, function mutator (...args) {
    // 先执行原生方法拿到结果，比如 push.apply(this, args)
    const result = original.apply(this, args)
    const ob = this.__ob__
    let inserted
    // 如果 method 是以下三个之一 push unshift splice，说明是新插入了元素
    switch (method) {
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    // 如果新增了元素，对新插入的元素做响应式处理
    if (inserted) ob.observeArray(inserted)
    // notify change
    ob.dep.notify() // 手动触发更新
    return result
  })
})
