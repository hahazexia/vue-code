/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules)

// nodeOps 都是一些 dom 操作的方法
// modules 是一些dom操作和vue指令和ref操作用于钩子函数
// 把和平台相关的 nodeOps 和 modules 作为参数传入 createPatchFunction，利用了函数柯里化，createPatchFunction 返回的函数以后就不用再处理 nodeOps 和 modules 参数了
export const patch: Function = createPatchFunction({ nodeOps, modules })
