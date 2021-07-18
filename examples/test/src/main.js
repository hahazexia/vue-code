import Vue from 'vue'
import App from './App.vue'
import ComponentA from './ComponentA.vue'

Vue.component('ComponentA', ComponentA)

new Vue({
  ...App
}).$mount('#app')
