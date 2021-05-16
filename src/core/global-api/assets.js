/* @flow */

import { ASSET_TYPES } from 'shared/constants'
import { isPlainObject, validateComponentName } from '../util/index'

export function initAssetRegisters (Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   */
  ASSET_TYPES.forEach(type => {
    Vue[type] = function (
      id: string,
      definition: Function | Object
    ): Function | Object | void {
      if (!definition) {
        return this.options[type + 's'][id]
      } else {
        /* istanbul ignore if */
        if (process.env.NODE_ENV !== 'production' && type === 'component') { // 开发环境下对组件名做校验
          validateComponentName(id)
        }
        if (type === 'component' && isPlainObject(definition)) { // 如果调用的是 Vue.component 组件注册，并且 definition 是对象
          definition.name = definition.name || id // 如果定义没有 name ，就取 id
          definition = this.options._base.extend(definition) // 调用 Vue.extend 生成子组件构造函数
        }
        if (type === 'directive' && typeof definition === 'function') {
          definition = { bind: definition, update: definition }
        }
        this.options[type + 's'][id] = definition // 在 Vue.options 上加入对应的定义
        return definition
      }
    }
  })
}
