/* @flow */

import { mergeOptions } from '../util/index'

export function initMixin (Vue: GlobalAPI) {
  Vue.mixin = function (mixin: Object) {
    this.options = mergeOptions(this.options, mixin) // mergeOptions 把 mixin 传入的参数合并到 Vue.options
    return this
  }
}
