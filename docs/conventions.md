# 命名约定

不是领域决定（那些在 `docs/adr/`），也不是术语（那些在 `CONTEXT.md`），只是代码里几个容易混用的词的用法。

## `type` 与 `kind`

1. **`type` 只表示消息类别。** 只用于 `Message.type` 与端口名（端口名就是沿它发出的消息的类别，ADR-0005）。
2. **`kind` 只表示宿主注册表里的键。** 即效果种类、触发器种类。它总是和一份 schema 配对，并带一个载荷字段（`config` 或 `input`）。节点没有 kind（ADR-0004）。
3. **其它内部的判别联合不用这两个词。** 按领域选更具体的词：违规、停住原因、错误用 `code`。改图操作用 `op`（`spawn`、`retire`、`connect`、`disconnect`、`addTrigger`、`removeTrigger`）。其余的（history 内容块等）在实现到时再定，定了补进这里。
4. **新增注册表时沿用 `kind`**，并在 `CONTEXT.md` 里给它起一个对应的术语。
