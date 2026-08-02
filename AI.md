# AI

> 見出しのみの空テンプレートだった状態から書き起こしたもの
> （`brushup-plan.md` 6章 次アクション item 2 対応）。**このドキュメントが
> 扱う内容はコード上ほぼ未実装**であり、README.mdの`Participant Model`・
> `Future Features`が定義するビジョンと現状の実装状況の差分を明記する
> 位置づけとする（他の`API.md`・`SECURITY.md`のような「実装済みの記述」
> ではない点に注意）。

## Philosophy

README.mdの`Participant Model`は「AIはParticipantである」と定義している。

```
Participant
├── Human
├── AI
└── Bot
```

AIを特別扱いせず、Human/AI/Botを同じ`Participant`概念として扱うことで、
AI通訳・AI議事録・AIサポート・AIファシリテーターなどを自然に追加できる
設計を目指す、というのがREADME.mdの意図である。

**現状の実装との差分**：`rooms/{roomId}/members/{uid}`（`DATA_MODEL.md`
「Participant」参照）は`role`(`owner`/`moderator`/`member`/`guest`)のみを
持ち、Participantの種別（Human/AI/Bot）を表すフィールドは存在しない。
`uid`はFirebase Authが発行するものに限定されており、AI/Botを人間の
ユーザーと同じ`members`ドキュメントとして自然に表現できるかどうかは、
`brushup-plan.md`が「早めに一度レビューしておくとよい」と記録したまま
未着手である。

---

## Features

README.mdの`Communication Model`は`Event`種別の1つとして`AI Message`を、
`Future Features`として以下を挙げている。いずれも本リポジトリには
対応する実装(サーバー側ルート・クライアントUI)が存在しない。

| 機能 | README.mdでの位置づけ | 実装状況 |
|---|---|---|
| Live Translation(AI通訳) | Future Features | 未実装 |
| AI Summary(AI議事録) | Future Features | 未実装 |
| AI Moderation | Future Features | 未実装 |
| AI Participants | Future Features | 未実装 |
| Automatic Transcription | Future Features | 未実装。前提となる音声のテキスト化自体が無い |
| AI Message(Event種別) | Communication Model | 未実装。Text Eventのみ実装済み(`token-server/routes/messages.js`)で、AI Messageという別種別のEventは無い |

現時点で実装済みなのは、Communication Modelが定義する複数`Event`種別の
うちVoice(PTT本体)とText(テキストチャット)のみ。Image/File/Location/
Reaction/System/AI Messageはいずれも未着手であり、「全てを`Event`として
扱う」という設計思想が最低限2種類で実証されている段階にとどまる。

---

## Prompt Strategy

未実装。上記いずれの機能もサーバー側でLLM/AI APIを呼び出す実装が存在せず、
プロンプト設計そのものが着手されていない。

---

## Memory

未実装。Room解散後もGuestの参加記録・IDは削除しない方針（`brushup-plan.md`
5.1）はあるが、これはAI機能の文脈での「記憶」ではなく、通常のParticipant
データ保持ポリシーの一部。AI Participant向けの会話履歴・文脈保持の設計は
存在しない。

---

## Future Ideas

着手する場合、以下の順序が現実的と考えられる（未着手・検討段階のメモ）。

- まず`Participant`種別(Human/AI/Bot)を`members`ドキュメントのスキーマに
  追加できるかをレビューする（「Philosophy」節参照）
- Text Event(既存の`token-server/routes/messages.js`)の設計パターン
  （書き込みをtoken-server経由に一本化し、Firestoreをリアルタイム配信元と
  する、BAN即時反映と同じモデレーション強制パターン）を、AI Messageや
  AI Summary等の新しいEvent種別にもそのまま踏襲できるかを確認する
  （`brushup-plan.md`「F. Future Featuresとの距離」で示唆されている方向性）
- 業界ラベリング層（Phase15）と同様、実需要（Phase2以降の具体的な
  ユースケース）が固まってから設計する方が手戻りが少ないと判断される
