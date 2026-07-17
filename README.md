# Real-Time Communication Platform

> **Connect to a place, not to a person.**

## Vision

既存のSNSは「人と人をつなぐ」ことを目的としている。

しかし現実には、

* イベント
* 現場
* サークル
* ボランティア
* 学校
* プロジェクト
* ゲーム
* 趣味

など、多くのコミュニケーションは

**「同じ目的を持った人が一定期間だけ集まる」**

という形で成り立っている。

本プロジェクトは、

**「人ではなく、場（Room）につながるリアルタイムコミュニケーション基盤」**

を目指す。

---

# Why

## 現在のSNSの課題

既存SNSでは、

* LINE交換
* フォロー
* フレンド登録
* 電話番号交換

など、

**個人アカウント同士を結び付けること**

が前提となっている。

しかし、

* 一日だけのイベント
* ボランティア
* 学会
* 展示会
* オフ会
* 学園祭
* プロジェクト

では、

> LINEを交換するほどではない

というケースが多い。

つまり必要なのは

**「人との永続的な関係」ではなく「場への一時的な参加」**

である。

---

# Concept

## Connect to Rooms

本サービスでは、

```
Friend
```

ではなく

```
Room
```

が中心となる。

参加者は

* 今日だけ
* このイベントだけ
* この現場だけ
* このプロジェクトだけ

という感覚で参加し、

終了後は自然に解散できる。

---

# Core Principles

## 1. Room First

すべてのコミュニケーションは Room を中心に構成する。

```
Room
 ├── Voice
 ├── Text
 ├── Images
 ├── Files
 ├── Location
 ├── Reactions
 └── AI
```

---

## 2. Temporary Relationships

長期的な友達関係を作ることよりも

**目的が終われば解散できること**

を重視する。

---

## 3. Privacy First

個人情報を最小限にする。

理想としては

* 電話番号不要
* LINE交換不要
* メールアドレス非公開
* 本名不要
* ニックネーム可

で利用できること。

---

## 4. Real-Time First

コミュニケーションの中心はリアルタイム。

* PTT
* Voice
* Live Audio
* Text

をシームレスに切り替えられること。

---

# Communication Model

通信手段ではなく、

すべてを **Event** として扱う。

```
User

↓

Identity

↓

Room

↓

Participant

↓

Event
```

Event の例

* Voice
* Text
* Image
* File
* Location
* Reaction
* System
* AI Message

これにより将来的な拡張が容易になる。

---

# Participant Model

参加者はすべて同じ概念とする。

```
Participant

├── Human
├── AI
└── Bot
```

AIを特別な存在として実装しない。

これにより

* AI通訳
* AI議事録
* AIサポート
* AIファシリテーター

などを自然に追加できる。

---

# Permission Model

できるだけシンプルに保つ。

```
Owner

Moderator

Member

Guest
```

業界ごとの名称はUIだけ変更する。

---

# Target Roadmap

## Phase 1

### Security Industry

まずは警備業向けとして完成度を高める。

目的

* 安定性
* 音質
* 低遅延
* 権限管理
* ログ管理

---

## Phase 2

### Business Teams

対象

* イベント運営
* 展示会
* 自治体
* ボランティア
* 店舗
* 学校

---

## Phase 3

### Consumer

対象

* 趣味コミュニティ
* ゲーム
* 勉強部屋
* 推し活
* サークル
* オフ会

---

# Long-Term Architecture

実装は業界に依存させない。

警備業では

```
Company

↓

Branch

↓

Site

↓

Room
```

一般利用では

```
Community

↓

Group

↓

Room
```

UIだけ変わり、

内部構造は同じである。

---

# Future Features

設計段階から追加可能にしておく。

* Public Rooms
* Temporary Rooms
* QR Join
* NFC Join
* Nearby Join
* AI Participants
* Live Translation
* Voice Effects
* Live Streaming
* Spatial Audio
* Automatic Transcription
* AI Summary
* AI Moderation

---

# UX Philosophy

目指すのは

**電話ではない。**

電話は

```
Person → Person
```

である。

本サービスは

```
Person → Room
```

である。

つまり、

相手を呼び出すのではなく、

**部屋に話しかける**

という体験を提供する。

---

# What Makes This Different

このサービスは

「友達を増やすSNS」

ではない。

目指すのは、

**目的を共有する人たちが、必要な期間だけ自然につながれるコミュニケーション基盤**

である。

開始は簡単。

終了も自然。

個人情報の交換も不要。

「今、この場、この目的」を共有することに価値を置く。

---

# Mission

> **Connect to a place, not to a person.**

人と人を結び付けるのではなく、

**同じ時間、同じ目的、同じ場所を共有する人たちが、安全かつ自然につながれる世界を実現する。**
