# zzy 3.3：预约代填、AI 接口与电话语音演示

## 直接体验

打开 http://127.0.0.1:4318 ，选择前台或院长，进入“电话智能接待”。

1. 点击“☎ 模拟电话拨入”，看到来电动画并听到振铃，点击“接听电话”。
2. 输入客户说话内容，例如“团子想预约明天下午三点半找林医生做体检”。这里用文字模拟转写，不采集麦克风。
3. 系统回复并朗读，页面同时显示询问、回复总结、逐轮原文和依据。语音使用浏览器可用的本机中文声音；也可展开“固定中文语音示例”试听。本机没有中文语音时会提示，不把固定示例冒充当前回复。
4. 预约草稿自动代填宠物、日期、具体时间、医生、项目；未说清的信息留空，显示提取依据。草稿不占号，也不表示预约成功。
5. 结束来电，前台核对身份、联系方式及档案，补充缺失信息后点击“人工确认并创建预约”。正式创建时检查排班、请假与连续时段冲突；重复点击不会重复预约。

交流原文、来源快照、总结和草稿按来电创建时间保留三个自然月，到期自动清理。人工确认后的正式预约独立保留。服务商如接收了文本，其留存政策不受本地清理控制。

## 配置实际 AI 服务

已实现 OpenAI 兼容的 Chat Completions 接口适配。现已在本机配置 DeepSeek，并实测 deepseek-chat 成功回复，来源原文校验通过。密钥仅存于被 Git 忽略的 .env。

在项目目录复制 `.env.example` 为 `.env`，本机填写：

```dotenv
AI_ENABLED=true
AI_CHAT_URL=https://api.deepseek.com/chat/completions
AI_MODEL=填写服务商提供的可用模型名称
AI_API_KEY=填写自己的密钥
```

使用其他兼容服务时换成该服务的完整 Chat Completions 地址和模型。OpenAI 的地址为 `https://api.openai.com/v1/chat/completions`。不要把密钥发到聊天或上传 Git；`.env` 已排除提交。

重启服务，在电话接待的自由问答框输入新问题。顶部显示配置状态，每条回复展示实际使用模型还是规则、失败原因。配置完整只代表可以发起请求，需以具体回复的“模型回复 · 引用已校验”判断该次调用成功。

模型仅从已检索资料中选择原文，后端逐段校验引用，不接受新增事实；超时、接口错误、来源不匹配回到规则。医疗、高风险咨询保留规则分流。发出的最近六条客户文本会遮盖手机号和邮箱，不发送客户资料对象；自由文本仍可能包含姓名等个人信息，使用真实客户数据前需按所选服务的条款配置。

接口依据：[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)、[DeepSeek Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)、[DeepSeek JSON Mode](https://api-docs.deepseek.com/guides/json_mode/)。

## 本次交付边界

- 电话振铃、接听、文字模拟转写和声音回复可在本机演示；没有接入真实电话号码、SIP/PBX 或语音识别。
- 已验证接口适配及来源校验，测试调用的是本机模拟服务；本机 DeepSeek 真实模型调用现已验证通过。
- 固定语音示例在 `public/voice-demo.wav`，为 Windows 本机合成，内容不含客户信息。
- 运行 `npm test`，17 项测试通过。启动方式仍为 `npm start` 或双击“启动Demo.cmd”。
