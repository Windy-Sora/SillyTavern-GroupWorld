# 脚本、消息前端与事件

核对日期2026-10-08，JS-Slash-Runner manifest 4.8.13；源文件src/panel/script/Iframe.vue、src/panel/render/Iframe.vue、src/iframe/predefine.js、src/store/iframe_runtimes。仅静态核对组件，不复制角色卡或预设代码。

## 两种主要运行位置

脚本库可包含全局、角色、预设等范围的脚本，是否运行要核对所属范围、实际开关与当前选择。脚本iframe可以隐藏运行，并不需要消息中有HTML。存在导出脚本不证明启用；本地副本关闭而远程入口开启时，不能把副本当当前版本。

消息HTML前端由渲染机制把代码内容放入iframe，可能使用srcdoc或Blob URL。需要核对渲染开关、楼层／深度、代码块、正则、流式与重建行为。单纯CSS美化与交互iframe不是同一种执行方式；正则替换出HTML也不单独证明渲染器已承载它。

## API与上下文

该基线向iframe注入父窗口的TavernHelper等辅助对象，并绑定依赖iframe身份的函数；还提供SillyTavern上下文。消息前端与脚本的身份影响消息选择器、脚本数据和合成变量读取。

基线的两类iframe模板没有sandbox属性，辅助代码也能接触父窗口对象；不是不可信代码的隔离承诺。不要建议为安全而“放进酒馆助手iframe即可”。远程import会加载可执行代码，不是只读知识导入。

## 事件和生命周期

消息iframe的render started／ended表示渲染生命周期，不证明业务模型、MVU解析或保存完成。pagehide会清理通过助手事件机制注册的监听，但这不证明任意原生DOM监听、定时器或后台请求都被取消。

重复操作先核对重复挂载、监听、按钮回调和异步完成顺序。切聊天、swipe、重建后回调仍引用旧对象也是待核对因素；在没有相关代码或日志前不认定原因。前端需要MVU时以实际初始化等待与更新结束事件为准，不以页面load替代框架就绪。

Mvu在父窗口存在时可兼容转发给iframe；这不负责安装MVU。接口是否存在、版本和初始化成功要分别确认。目录只显示扩展安装／配置概况时，保持runtimeActive未知，不补成“已运行正常”。
