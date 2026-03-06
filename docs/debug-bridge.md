# 调试桥

DesignEcho Agent 现在提供本地调试桥，供外部智能体、脚本或调试工具把对话和 trace 写入 Agent。

## 地址

- `http://127.0.0.1:8767`

## 接口

### 健康检查

`GET /health`

### 创建会话

`POST /sessions`

```json
{
  "id": "agent-debug-001",
  "title": "外部智能体联调",
  "metadata": {
    "agent": "my-agent"
  }
}
```

### 追加消息

`POST /sessions/:id/messages`

```json
{
  "role": "assistant",
  "direction": "inbound",
  "agent": "my-agent",
  "content": "remove-background 失败，错误来自选区为空",
  "metadata": {
    "stage": "tool-call"
  },
  "trace": {
    "skills": ["debug-skill"],
    "toolCalls": ["remove-background"]
  },
  "toolCalls": [
    {
      "name": "remove-background",
      "success": false
    }
  ],
  "errors": [
    {
      "message": "No active selection"
    }
  ]
}
```

### 快速写入

`POST /message`

如果不传 `sessionId`，服务会自动创建新会话。

```json
{
  "sessionId": "agent-debug-001",
  "role": "user",
  "direction": "outbound",
  "content": "请继续检查 enhanced-shape-morph",
  "agent": "codex"
}
```

### 查询会话列表

`GET /sessions`

### 查询单个会话

`GET /sessions/:id`

## 落盘位置

调试桥会把数据写到 Electron `userData` 目录下：

- `debug-bridge/sessions/*.json`
- `debug-bridge/latest-session.json`
- `debug-bridge/latest-message.json`

## 约定

- `direction`
  - `inbound`: 外部智能体发进来的消息
  - `outbound`: Agent 或调试端发出去的消息
  - `event`: 中间状态、工具事件、系统广播
- `role`
  - `user`
  - `assistant`
  - `system`
  - `tool`
