/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from '../util/index'

const arrayProto = Array.prototype
export const arrayMethods = Object.create(arrayProto) // 继承 Array.prototype 的对象

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
methodsToPatch.forEach(function (method) {
  // cache original method
  const original = arrayProto[method] // 原生数组方法
  def(arrayMethods, method, function mutator (...args) { // 给 arrayMethods 对象上添加变异后的方法
    const result = original.apply(this, args)
    const ob = this.__ob__
    let inserted
    switch (method) { // 监听 push unshift splice 三个方法，inserted 是往数组中新加入的元素
      case 'push':
      case 'unshift':
        inserted = args
        break
      case 'splice':
        inserted = args.slice(2)
        break
    }
    if (inserted) ob.observeArray(inserted) // 将数组新加入的值也变成响应式的
    // notify change
    ob.dep.notify() // 手动触发更新
    return result
  })
})
