# 0001 — Telegram 虚拟群友（Virtual Group Member）

> 状态：Spec（需求已锁定）
> 关联：`apps/telegram-bot`，基于 `arbetslag` 框架

## Problem Statement

当前 `apps/telegram-bot` 是一个**纯被动、1:1 助手型**的 Telegram bot：每个 chat 一个
`Agent`，来一条 `message` 事件就回一条，人设是泛泛的 "helpful assistant"。它无法在
**群聊**中像一个真实的群友那样自然参与对话——不会挑话题插话、没有鲜明人设、不会主动记忆
群内上下文。用户希望这个 bot 在群聊中作为**虚拟群友**工作。

## Solution

在群聊中为 bot 赋予一个**具体的人设角色**，让它：

- 被 @ 或回复时一定回应；
- 没被 @ 时**选择性接话**——仅当话题落在其领域/兴趣内、且确有非重复内容可说时才插嘴；
- 以口语化、有性格的方式参与，同时坦诚自己是 AI、守住行为底线；
- 通过每日清空的 context window + 一份全局 `MEMORY.md` 形成长期记忆；
- 私聊走另一套更聚焦、更专注的行为模式。

人设本身通过 `arbetslag.yaml` 中 template 的 `systemPrompt` 定义（不硬编码、不造新抽象），
便于日后新增/替换角色。

## User Stories

### 人设与身份

1. As a group member, I want the bot to have a distinct personality, so that it feels like a real person in the group rather than a generic assistant.
2. As a group member, I want the bot to be honest that it is an AI and never pretend to be a human, so that the group stays trustworthy.
3. As a group member, I want the bot to stay on-topic and personal-attack-free even when it disagrees or argues, so that debates stay healthy.
4. As a group member, I want the bot to avoid sensitive politics and pornographic topics, so that it doesn't poison the group atmosphere.
5. As a group admin, I want the persona to be defined in a config file (`arbetslag.yaml` template `systemPrompt`) rather than hardcoded, so that I can add or swap characters without code changes.
6. As a group admin, I want to be able to add a second persona by simply adding another template entry, so that multiple characters can coexist in the future.

### 发言时机（群聊）

7. As a group member, I want the bot to always reply when it is @-mentioned or directly replied to, so that I know it heard me.
8. As a group member, I want the bot to only chime in on topics it genuinely has something useful to say, so that it doesn't spam or derail conversations.
9. As a group member, I want the bot to stay silent on pure small talk or off-topic noise it can't add value to, so that its messages feel intentional.
10. As a group member, I want the bot to join a debate or correct a factual error when it has non-redundant input, so that it contributes meaningfully.
11. As a group admin, I want the bot to never spam (send messages at a high, uncontrolled rate), so that it remains welcome rather than mute-worthy.
12. As a group admin, I want scheduled/proactive "spontaneous" posting to be deferred and driven by an external information-gathering system, so that the initial release stays simple and predictable.

### 私聊模式

13. As a direct-message user, I want the bot to apply the group's "should I even speak" filter less aggressively, so that 1:1 conversations feel natural.
14. As a direct-message user, I want the bot to focus on helping me with real questions in private, so that DMs are productive rather than chatty.
15. As a direct-message user, I want the same persona in private as in the group, so that the experience is consistent.

### 未知与越界处理

16. As a group member, when the bot is asked something outside its knowledge, I want it to first try web search (or similar tools) to find real data, so that it answers with facts rather than guessing.
17. As a group member, I want the bot to honestly say "I don't know" only when it truly cannot find an answer, so that I trust its claims.
18. As a group member, when a sensitive topic comes up, I want the bot to be straight with me about why it won't engage, so that it's transparent rather than evasive.

### 记忆

19. As the group, I want the bot to retain long-term memory across daily context-window resets via a persistent `MEMORY.md` file, so that it remembers who's who and what we've discussed.
20. As a group member, I want the bot to remember member identities, relationships, and speaking styles, so that it addresses people correctly over time.
21. As a group, I want the bot to remember ongoing topics and unresolved debates, so that it can follow up rather than repeating itself.
22. As a group member, I want the bot to recall inside jokes and group jargon ("上次那事"), so that it feels like a long-standing member.
23. As a group member, I want the bot to remember my personal topic preferences, so that it engages me on things I care about.
24. As the bot owner, I want the bot to remember my long-term preferences, so that private and group interactions are tailored to me.
25. As a group member, I want the bot to NOT remember one-off chit-chat, throwaway memes, sensitive privacy, and emotional outbursts, so that its memory stays clean and respectful.
26. As the bot owner, I want the initial `MEMORY.md` to be a single global file with clear sections (e.g. `## 关于用户`, `## 群A`, `## 群B`), so that it's simple to start and can be split later if sections start leaking across groups.

### 与其他 bot / agent 的互动

27. As a group member, when another bot or agent posts, I want its content to be available to 老岩's context but NOT directly responded to, so that 老岩 only reacts to real people.
28. As a group admin, I want  to avoid talking to itself in reply to other bots, so that the conversation doesn't degenerate into bot-to-bot chatter.

### 语气与风格

29. As a group member, I want 老岩's messages to usually be 1–3 short sentences, expanding only when it gets deep into a technical topic, so that it reads like a real chatty group member.
30. As a group member, I want the bot to match the dominant language of the group/message, so that it fits in naturally.

## Testing Plans

- **Trigger gating**: verify @-mention / reply always produces a response; verify non-mention messages only produce a response when the topic is in-domain AND there is non-redundant content; verify pure small talk / off-topic noise produces no response.
- **Spam control**: verify the bot does not emit an uncontrolled burst of messages in a busy group.
- **Proactive posting (deferred)**: verify the current release contains NO scheduled spontaneous posting path; confirm this is captured as backlog to be driven by an external system later.
- **Private vs group mode**: verify DM behavior uses the open-engagement mode (no group selection gate) while group behavior uses the selective-react filter.
- **Unknown / sensitive handling**: verify an out-of-domain question triggers a web-search attempt before any "I don't know"; verify a sensitive topic yields a straight, honest refusal rather than evasion or fabrication.
- **Memory persistence**: verify `MEMORY.md` is read to restore long-term context at session start and written per the agreed inclusion/exclusion rules; verify daily context-window reset behavior; verify no sensitive privacy or emotional outbursts are written.
- **Cross-bot context**: verify messages from other bots/agents are observable in context but never selected as a response target.
- **Multi-role config**: verify a second template entry in `arbetslag.yaml` yields a distinct, independently-loadable persona (future-proofing the config-driven design).

## Out of Scope

- Scheduled / spontaneous proactive posting (A2). Deferred; to be driven by a future external information-gathering system.
- A dedicated multi-persona management system, menu/selector, or A/B testing harness. Right now there is one persona; adding roles is done by appending a template to the config file.
- Structured persona schema beyond the free-form `systemPrompt`. Persona attributes live in the template's `systemPrompt`.
- Bot admin duties (moderation, kick/mute handling, join/leave handling), DM-initiated outreach, or cross-group memory splitting (kept global for now).
- Any change to the `arbetslag` framework core (this spec only consumes the existing Agent / Template / Chat / Event / Input Adopter / Tool abstractions).

## Further Notes

- **Config-driven persona (decision)**: the persona is defined entirely in `arbetslag.yaml` template `systemPrompt`. Adding a character = adding a template; swapping = editing `systemPrompt`. No new abstraction is built now (YAGNI); this is revisited only if a second live persona appears.
- **Memory model**: context window is cleared daily; a single global `MEMORY.md` provides long-term memory, sectioned by user/group. Split into per-group files only if cross-group leakage becomes a problem.
- **Domain vocabulary** throughout follows `CONTEXT.md` (Agent, Template, Chat, Event, Input Adopter, Tool, Context, Orchestrator).
