# 接待与知识接口

仅公开接口实现和配置示例，不提供公共在线服务或共享密钥。默认地址为 `http://127.0.0.1:4318`。

## 本地接口

先以 `POST /api/login` 登录，正文示例为 `{"tenant":"demo","role":"前台"}`。保留返回的 HttpOnly 会话 Cookie；后续写操作需 `Content-Type: application/json` 和 `X-Demo-Request: 1`。通话接口仅前台或院长可用，数据按医院和门店隔离。

| 方法与路径 | 用途 / 主要参数 |
| --- | --- |
| GET `/api/calls` | 来电列表、案例与知识配置 |
| POST `/api/calls/start` | 创建模拟来电：`branch`、`caller`、`phone`、`question` |
| POST `/api/calls/message` | 继续交流：`id`、`text`；按配置调用 DeepSeek |
| GET `/api/calls/detail?id=…` | 总结、交流、来源快照、采集字段与预约草稿 |
| POST `/api/calls/end` | 结束通话：`id` |
| POST `/api/calls/booking/save` | 保存人工调整的草稿 |
| POST `/api/calls/booking/confirm` | 核对身份、草稿版本及排班后创建预约 |
| POST `/api/calls/knowledge` | 院长维护知识；历史回复保留旧版本快照 |
| GET `/api/calls/ai/status` | 启用状态、模型与接口地址，不返回密钥 |
| POST `/api/pets/update` | 前台编辑档案；含电话补充时须 `profileVerified: true` |

完整字段与校验逻辑见 `calls.js`、`server.js`；调用示例见 `tests/reception.test.js` 和 `tests/api.test.js`。

## 外部模型适配

`ai-provider.js` 使用服务端 fetch 请求配置的 Chat Completions 地址，包含 Bearer 认证、JSON 输出、15 秒超时与结构校验。接待模式要求返回候选短句序号和引用，服务端验证引用确为知识条目原文；失败时使用规则短句。电话号码、邮箱及已知宠主 / 宠物姓名在上下文中作基础替换，不将其描述为完备匿名化方案。

知识条目包含标题、正文、来源 URL、版本、整理日期；回复保存当时快照及哈希。详见 `knowledge/reception.json`。

## 语音播放接口

- GET `/voice/manifest.json`：固定短句到本地音频路径的映射。
- GET `/voice/{phrase}-{index}.mp3`：预合成自然语音，如 `/voice/weight-0.mp3`。
- Web Audio 生成振铃；SpeechSynthesis 为未匹配文字提供本机朗读。

没有可直接调用的商业实时语音生成 API；演示语音已包含在项目内。后续可在 `public/phone.js` 播放层接入服务端 TTS 代理，密钥仍应保留在服务端。
