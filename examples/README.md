examples サブプロジェクト — ライブラリ利用例

概要
- このサブプロジェクトはリポジトリ内ライブラリの簡易利用例を示します。

実行手順（PowerShell）


1. 例のディレクトリへ移動して依存をインストール

```powershell
cd examples ; npm install
```

2. ビルドしてローカルサーバを起動

```powershell
cd examples ; npm run build ; npm run start
```

ブラウザで http://localhost:8080 にアクセスしてください。

注意
- Node.js v22 など ESM をサポートする環境で実行してください。
- `build` で `esbuild` を使って `dist/bundle.js` を生成します。
