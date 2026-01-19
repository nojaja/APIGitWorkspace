# Browser API-based Git クライアント 詳細設計書

## 1. 目的

本設計書は、Git CLI を使用せず **GitHub / GitLab API のみ**で Git リポジトリ操作を実現する
**Browser ベース Git クライアント**の詳細設計を定義する。
ライブラリ名は`ApiGitWorkspace`とする。

特に以下を重視する：

- ブラウザ制約下（OPFS / IndexedDB / Fetch API）での安全な Git 操作
- 差分ベース・冪等・再試行可能な push / pull
- 大規模リポジトリへの対応

---

## 2. 前提・設計方針

### 2.1 非目標

- Git CLI 完全互換
- rebase / stash / submodule

### 2.2 採用方針

| 項目 | 方針 |
|----|----|
| Git 操作 | API 抽象（GitHub / GitLab） |
| 差分管理 | OverlayFS + index.json |
| delete / rename | tombstone 方式 |
| 衝突検出 | baseSha 比較 |
| 同期方式 | 楽観ロック |

---

## 3. 全体アーキテクチャ

```
┌───────────────┐
│ Remote Git API │
└───────▲───────┘
        │
┌───────┴──────────┐
│ Git API Adapter │  ← GitHub / GitLab 抽象
└───────▲──────────┘
        │
┌───────┴──────────┐
│ Git Engine Core │
│  - pull / push  │
│  - diff         │
│  - conflict     │
└───────▲──────────┘
        │
┌───────┴──────────┐
│ VirtualFS       │
│  - base         │
│  - workspace    │
│  - tombstone    │
│  - index.json   │
└──────────────────┘
```

---

## 4. VirtualFS 厳密型定義

### 4.1 ファイル状態

```ts
export type FileState = 'base' | 'modified' | 'added' | 'deleted' | 'conflict'
```

### 4.2 index.json

```ts
export interface IndexEntry {
  path: string
  state: FileState
  baseSha?: string
  workspaceSha?: string
  updatedAt: number
}

export interface IndexFile {
  head: string
  entries: Record<string, IndexEntry>
}
```

---

## 5. Tombstone 設計（delete / rename）

### 5.1 Tombstone 定義

```ts
export interface TombstoneEntry {
  path: string
  baseSha: string
  deletedAt: number
}
```

- delete は即時 base 反映しない
- rename は delete + create の合成操作

---

## 6. pull（base 更新）アルゴリズム

### 6.1 入力

- remote HEAD
- base snapshot
- workspace
- tombstone

### 6.2 判定マトリクス

| 状態 | 処理 |
|----|----|
| base と一致 | noop |
| workspace 未変更 | base 更新 |
| workspace 変更あり | conflict |

### 6.3 conflict 定義

```ts
export interface ConflictEntry {
  path: string
  baseSha: string
  remoteSha: string
  workspaceSha: string
}
```

---

## 7. push（commit 作成 → API 反映）

### 7.1 push 定義

- workspace + tombstone から差分抽出
- remote HEAD を親に commit を生成
- API 経由で ref を更新

---

### 7.2 事前チェック

```ts
if (remoteHead !== index.head) {
  throw new Error('HEAD changed. pull required')
}
```

---

### 7.3 ChangeSet 定義

```ts
export type Change =
  | { type: 'create'; path: string; content: string }
  | { type: 'update'; path: string; content: string; baseSha: string }
  | { type: 'delete'; path: string; baseSha: string }
```

---

### 7.4 CommitInput

```ts
export interface CommitInput {
  message: string
  parentSha: string
  changes: Change[]
}
```

---

### 7.5 API 反映手順

#### GitHub

1. blob 作成（並列・制限付き）
2. tree 作成（差分適用）
3. commit 作成
4. ref 更新

#### GitLab

- commits API を使用
- Change[] を actions に直接変換

---

### 7.6 冪等性設計

```ts
commitKey = hash(parentSha + JSON.stringify(changes))
```

- metadata に埋め込む
- retry 時の重複 commit 防止

---

### 7.7 push 成功後処理

- base snapshot 更新
- index.head 更新
- workspace / tombstone cleanup

---

## 8. パフォーマンス設計（大規模 repo）

- pull 時は tree 一括取得禁止
- 差分パスのみ API 呼び出し
- blob キャッシュ
- 並列数制御（例：5〜10）

---

## 9. エラーハンドリング / retry

| 失敗箇所 | 方針 |
|----|----|
| blob | retry |
| commit | retry |
| ref | HEAD 再確認 |

---

## 10. セキュリティ・権限

| サービス | Scope |
|----|----|
| GitHub | repo |
| GitLab | write_repository |

---

## 11. 未対応・拡張余地

- branch 切替
- merge UI
- conflict 解消 UI
- history 表示

---

## 12. 実装ルール（Copilot 指示）

- API は必ず Adapter 経由
- index.json を唯一の真実とする
- base を直接変更しない
- 差分なし commit を禁止

---

## 13. 最終原則

> **壊さない / 重くしない / 再実行できる**

この原則を破る実装は禁止とする。

